import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../crypto.ts";
import {
  deleteChannelLinkByInbox,
  getChannelLinkByInbox,
  getTenantByAccountId,
  teardownTenant,
  upsertChannelLink,
  upsertConversationMap,
} from "../services/tenants.ts";
import { OPENCLAW_NATIVE_CHANNELS } from "../services/channel-types.ts";
import { OpenClawGatewayClient } from "../services/openclaw.ts";
import { teardownGateway } from "../services/gateway-pool.ts";
import { query } from "../db.ts";
import { syncHumanReplyToChannel } from "../services/sync.ts";

const loginSessions = new Map<string, { accountId?: string }>();
/** Last QR shown per Chatwoot account — avoids round-tripping huge PNGs every poll. */
const lastQrByAccount = new Map<number, string>();
/** One in-flight wait per account so 2s UI polls don't pile up on the gateway. */
const waitInFlight = new Map<number, Promise<{
  qr_data_url: string | null;
  connected: boolean;
  inbox_id: number | null;
  message: string | null;
}>>();

function normalizeWhatsAppTo(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  // Nepal local mobiles often omit country code (98… → +97798…)
  if (digits.length === 10 && digits.startsWith("9")) return `+977${digits}`;
  if (digits.length >= 8) return `+${digits}`;
  return trimmed;
}

export async function registerChannelRoutes(app: FastifyInstance) {
  app.post("/tenants/:accountId/channels/whatsapp/setup/start", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
    const force =
      (request.query as { force?: string }).force === "1" ||
      Boolean((request.body as { force?: boolean } | null)?.force);
    // Drop any queued wait so a fresh start isn't blocked behind a stale poll.
    waitInFlight.delete(accountId);
    // Per-tenant OpenClaw WhatsApp account slot — using "default" for every tenant here
    // made a second tenant's QR login fight the first tenant's already-linked number for
    // the same account slot ("connection failed unable to connect").
    const started = await gateway.startWhatsAppLogin(tenant.openclawTenantId, force);
    if (started.qrDataUrl) {
      lastQrByAccount.set(accountId, started.qrDataUrl);
    } else {
      lastQrByAccount.delete(accountId);
    }
    const sessionId = `wa-${accountId}-${Date.now()}`;
    loginSessions.set(sessionId, {});
    return {
      session_id: sessionId,
      qr_data_url: started.qrDataUrl ?? null,
      connected: Boolean(started.connected),
      message: started.message ?? null,
    };
  });

  async function waitWhatsAppSetup(request: {
    params: unknown;
    query: unknown;
    body: unknown;
  }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

    const existingFlight = waitInFlight.get(accountId);
    if (existingFlight) {
      return existingFlight;
    }

    const flight = (async () => {
      // Prefer server-cached QR (client PNG round-trips stall Chatwoot HTTP).
      const bodyQr = (request.body as { current_qr?: string } | null)?.current_qr;
      const queryQr = (request.query as { current_qr?: string }).current_qr;
      const clientQr =
        typeof bodyQr === "string" && bodyQr.length > 0
          ? bodyQr
          : typeof queryQr === "string" && queryQr.length > 0
            ? queryQr
            : undefined;
      const currentQr = lastQrByAccount.get(accountId) ?? clientQr;

      const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
      // Only trust gateway web.login.wait connected=true (socket + persisted auth).
      const waited = await gateway.waitWhatsAppLogin(tenant.openclawTenantId, currentQr);

      if (waited.qrDataUrl) {
        lastQrByAccount.set(accountId, waited.qrDataUrl);
      }
      if (waited.connected) {
        lastQrByAccount.delete(accountId);
      }

      const existing = await query(
        "SELECT chatwoot_inbox_id FROM channel_links WHERE tenant_id = $1 AND channel_type = 'whatsapp' LIMIT 1",
        [tenant.id],
      );
      const inboxId = existing[0] ? Number(existing[0].chatwoot_inbox_id) : null;

      return {
        qr_data_url: waited.qrDataUrl ?? null,
        connected: Boolean(waited.connected),
        inbox_id: inboxId,
        message: waited.message ?? null,
      };
    })();

    waitInFlight.set(accountId, flight);
    try {
      return await flight;
    } finally {
      if (waitInFlight.get(accountId) === flight) {
        waitInFlight.delete(accountId);
      }
    }
  }

  app.get("/tenants/:accountId/channels/whatsapp/setup/wait", waitWhatsAppSetup);
  app.post("/tenants/:accountId/channels/whatsapp/setup/wait", waitWhatsAppSetup);

  app.post("/tenants/:accountId/channels/whatsapp", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const body = request.body as {
      inbox_id?: number;
      inbox_identifier?: string;
      openclaw_account_id?: string;
    };
    if (!body.inbox_id) return reply.code(400).send({ error: "inbox_id_required" });
    const link = await upsertChannelLink({
      tenantId: tenant.id,
      channelType: "whatsapp",
      chatwootInboxId: body.inbox_id,
      openclawAccountId: body.openclaw_account_id ?? tenant.openclawTenantId,
      metadata: {
        inboxIdentifier: body.inbox_identifier,
        provider: "openclaw",
      },
    });
    return {
      channel_link_id: link.id,
      inbox_id: link.chatwootInboxId,
    };
  });

  /** Remove OpenClaw's record of a channel after its Chatwoot inbox is deleted. */
  app.delete("/tenants/:accountId/channels/:inboxId", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const inboxId = Number((request.params as { inboxId: string }).inboxId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    if (!Number.isInteger(inboxId) || inboxId <= 0) {
      return reply.code(400).send({ error: "invalid_inbox_id" });
    }
    // Fetch before deleting: removing the row loses the channel type we need
    // to tell OpenClaw which channel to actually disconnect.
    const link = await getChannelLinkByInbox(tenant.id, inboxId);
    const removed = await deleteChannelLinkByInbox(tenant.id, inboxId);

    let openclawDisconnected = false;
    let openclawDisconnectError: string | null = null;
    if (link && link.channelType !== "web_widget") {
      try {
        const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
        await gateway.disconnectChannel(link.channelType, link.openclawAccountId ?? undefined);
        openclawDisconnected = true;
      } catch (error) {
        openclawDisconnectError = error instanceof Error ? error.message : String(error);
      }
    }

    return { ok: true, ...removed, openclaw_disconnected: openclawDisconnected, openclaw_disconnect_error: openclawDisconnectError };
  });

  /** Full OpenClaw teardown for a deleted Chatwoot account. */
  app.delete("/tenants/:accountId", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const removed = await teardownTenant(tenant.id);
    let gatewayTornDown = true;
    let gatewayTeardownError: string | null = null;
    try {
      await teardownGateway(tenant.openclawTenantId, true);
    } catch (error) {
      gatewayTornDown = false;
      gatewayTeardownError = error instanceof Error ? error.message : String(error);
    }
    return { ok: true, ...removed, gateway_torn_down: gatewayTornDown, gateway_teardown_error: gatewayTeardownError };
  });

  /** Send WhatsApp text to a phone and bind it to a Chatwoot conversation id. */
  app.post("/tenants/:accountId/channels/whatsapp/send", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const body = request.body as {
      to?: string;
      text?: string;
      conversation_id?: number;
    };
    if (!body.to || !body.text?.trim()) {
      return reply.code(400).send({ error: "to_and_text_required" });
    }
    const to = normalizeWhatsAppTo(body.to);
    const links = await query(
      "SELECT * FROM channel_links WHERE tenant_id = $1 AND channel_type = 'whatsapp' LIMIT 1",
      [tenant.id],
    );
    const link = links[0];
    if (!link) return reply.code(404).send({ error: "whatsapp_channel_not_linked" });

    await syncHumanReplyToChannel({
      tenantId: tenant.id,
      channel: "whatsapp",
      conversationId: Number(body.conversation_id ?? 0),
      content: body.text.trim(),
      to,
      accountId: link.openclaw_account_id ? String(link.openclaw_account_id) : tenant.openclawTenantId,
    });

    if (body.conversation_id) {
      await upsertConversationMap({
        tenantId: tenant.id,
        channelLinkId: String(link.id),
        externalContactId: to,
        chatwootConversationId: Number(body.conversation_id),
      });
    }

    return { ok: true, to, conversation_id: body.conversation_id ?? null };
  });
}
