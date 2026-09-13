import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../crypto.ts";
import { getTenantByAccountId, upsertChannelLink } from "../services/tenants.ts";
import { OpenClawGatewayClient } from "../services/openclaw.ts";
import { query } from "../db.ts";
import {
  getChannelDef,
  listChannelCatalogPublic,
} from "../services/channel-catalog.ts";

export async function registerOpenClawChannelRoutes(app: FastifyInstance) {
  app.get("/channels/catalog", async () => ({
    channels: listChannelCatalogPublic(),
  }));

  app.get("/tenants/:accountId/channels", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

    const links = await query(
      "SELECT channel_type, chatwoot_inbox_id, openclaw_account_id, metadata FROM channel_links WHERE tenant_id = $1",
      [tenant.id],
    );

    let status: Record<string, unknown> | null = null;
    try {
      const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
      status = await gateway.channelStatus();
    } catch (err) {
      status = {
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      catalog: listChannelCatalogPublic(),
      linked: links.map((row) => ({
        channel_type: row.channel_type,
        inbox_id: Number(row.chatwoot_inbox_id),
        openclaw_account_id: row.openclaw_account_id,
        metadata: row.metadata,
      })),
      gateway_status: status,
    };
  });

  /**
   * Connect a token-based OpenClaw channel (Telegram, Discord, Slack, …).
   * WhatsApp QR uses /channels/whatsapp/setup/* instead.
   */
  app.post("/tenants/:accountId/channels/:channel/connect", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const channel = String((request.params as { channel: string }).channel).toLowerCase();
    const def = getChannelDef(channel);
    if (!def) return reply.code(404).send({ error: "unknown_channel" });
    if (def.auth === "qr") {
      return reply.code(400).send({
        error: "qr_channel",
        message: "Use WhatsApp QR setup endpoints for this channel.",
      });
    }

    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

    const body = (request.body ?? {}) as { fields?: Record<string, string> };
    const fields = body.fields ?? {};

    let channelConfig: Record<string, unknown>;
    try {
      channelConfig = def.buildConfig(fields);
    } catch (err) {
      return reply.code(400).send({
        error: "invalid_fields",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
    const result = await gateway.connectTokenChannel(channel, channelConfig);

    const existing = await query(
      "SELECT chatwoot_inbox_id FROM channel_links WHERE tenant_id = $1 AND channel_type = $2 LIMIT 1",
      [tenant.id, channel],
    );

    return {
      ok: true,
      channel,
      label: def.label,
      connected: true,
      message: `OpenClaw ${def.label} configured.`,
      inbox_id: existing[0] ? Number(existing[0].chatwoot_inbox_id) : null,
      start: result.started,
      start_note: result.message ?? null,
    };
  });

  app.post("/tenants/:accountId/channels/:channel/register", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const channel = String((request.params as { channel: string }).channel).toLowerCase();
    const def = getChannelDef(channel);
    if (!def) return reply.code(404).send({ error: "unknown_channel" });

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
      channelType: channel,
      chatwootInboxId: body.inbox_id,
      openclawAccountId: body.openclaw_account_id ?? "default",
      metadata: {
        inboxIdentifier: body.inbox_identifier,
        provider: "openclaw",
        channel,
        label: def.label,
      },
    });

    return { channel_link_id: link.id, inbox_id: link.chatwootInboxId, channel };
  });
}
