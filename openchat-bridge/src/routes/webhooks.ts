import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../crypto.ts";
import type { ChatwootMessageWebhook } from "../types.ts";
import { handleAgentBotWebhook, normalizePhone, verifyChatwootSignature } from "../services/agent-reply.ts";
import { getAgentBot, getTenantByAccountId, getTenantByOpenclawAccountId, recordEvent } from "../services/tenants.ts";
import { syncChannelInbound, syncHumanReplyToChannel, syncWhatsAppInbound } from "../services/sync.ts";
import { OPENCLAW_NATIVE_CHANNELS } from "../services/channel-types.ts";

/**
 * OpenClaw's native per-channel retry paths (its own auto-reply resolver failing
 * and retrying with backoff) re-notify this webhook for the exact same inbound
 * message, repeatedly, for as long as the upstream failure persists. Each replay
 * would otherwise become another Chatwoot message and another AI reply — the
 * customer sees the bot answer the same message over and over.
 *
 * Keyed by message id when the gateway sends one; gateways running an older
 * build don't, so fall back to the sender + exact text, which is what a replay
 * actually looks like.
 *
 * The fallback window is deliberately short. A replay storm re-fires within
 * seconds, so a tight window still collapses the burst the customer would see;
 * a long one starts swallowing real messages ("Hi" twice in a conversation is
 * ordinary), and silently ignoring a customer is a worse failure than answering
 * them twice. Only the id-keyed path can safely dedupe over minutes.
 */
const INBOUND_DEDUPE_WINDOW_MS = 20_000;
const INBOUND_ID_DEDUPE_WINDOW_MS = 600_000;
const seenInboundMessages = new Map<string, number>();

function claimInboundMessageOnce(input: {
  accountId?: string;
  messageId?: string;
  from?: string;
  text?: string;
}): boolean {
  const window = input.messageId ? INBOUND_ID_DEDUPE_WINDOW_MS : INBOUND_DEDUPE_WINDOW_MS;
  const identity = input.messageId ? `id:${input.messageId}` : `msg:${input.from ?? ""}:${input.text ?? ""}`;
  const key = `${input.accountId ?? ""}:${identity}`;
  const now = Date.now();
  const prev = seenInboundMessages.get(key);
  if (prev && now - prev < window) return false;
  seenInboundMessages.set(key, now);
  if (seenInboundMessages.size > 500) {
    for (const [k, ts] of seenInboundMessages) {
      if (now - ts > INBOUND_ID_DEDUPE_WINDOW_MS) seenInboundMessages.delete(k);
    }
  }
  return true;
}

export async function registerWebhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/chatwoot/:accountId", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const bot = await getAgentBot(tenant.id);
    const raw = JSON.stringify(request.body ?? {});
    if (bot?.secretEnc) {
      const secret = decryptSecret(bot.secretEnc);
      if (secret) {
        const ok = verifyChatwootSignature({
          secret,
          timestamp: String(request.headers["x-chatwoot-timestamp"] ?? ""),
          signature: String(request.headers["x-chatwoot-signature"] ?? ""),
          body: raw,
        });
        if (!ok && request.headers["x-chatwoot-signature"]) {
          return reply.code(401).send({ error: "invalid_signature" });
        }
      }
    }
    const payload = request.body as ChatwootMessageWebhook & {
      content_attributes?: { openchat_outbound_synced?: boolean };
    };
    if (
      payload.event === "message_created" &&
      String(payload.message_type) === "outgoing" &&
      payload.sender?.type !== "agent_bot" &&
      !payload.content_attributes?.openchat_outbound_synced
    ) {
      const inboxId = payload.inbox?.id ?? payload.conversation?.inbox_id;
      const { getChannelLinkByInbox, getConversationMapByChatwootId, upsertConversationMap } =
        await import("../services/tenants.ts");
      const link = inboxId ? await getChannelLinkByInbox(tenant.id, inboxId) : null;
      const convId = payload.conversation?.display_id ?? payload.conversation?.id ?? 0;
      const mapped = convId ? await getConversationMapByChatwootId(tenant.id, convId) : null;
      const rawTo =
        mapped?.externalContactId ??
        payload.conversation?.meta?.sender?.identifier ??
        payload.conversation?.meta?.sender?.phone_number ??
        null;
      // WhatsApp destinations are phone numbers (or a privacy-mode "@lid" address) and
      // need normalizing; other channels (Discord snowflake IDs, etc.) use their raw
      // identifier as-is — reformatting would corrupt them (e.g. a Discord id is all
      // digits and would get a bogus "+" prepended).
      const to = link?.channelType === "whatsapp" ? normalizePhone(rawTo) : rawTo;
      const needsRelay =
        link && (link.channelType === "whatsapp" || OPENCLAW_NATIVE_CHANNELS.has(link.channelType));
      if (needsRelay && link && to && payload.content?.trim()) {
        try {
          await syncHumanReplyToChannel({
            tenantId: tenant.id,
            channel: link.channelType,
            conversationId: convId,
            content: payload.content ?? "",
            to,
            accountId: link.openclawAccountId ?? undefined,
          });
          if (convId) {
            await upsertConversationMap({
              tenantId: tenant.id,
              channelLinkId: link.id,
              externalContactId: to,
              chatwootConversationId: convId,
            });
          }
        } catch (error) {
          request.log.warn({ err: error, channel: link.channelType }, "channel human sync failed");
        }
      }
    }
    try {
      const result = await handleAgentBotWebhook({ tenant, payload });
      return result;
    } catch (error) {
      request.log.error({ err: error }, "agent webhook failed");
      return reply.code(500).send({ error: "agent_webhook_failed" });
    }
  });

  app.post("/webhooks/openclaw/inbound", async (request) => {
    const body = request.body as {
      tenant_id?: string;
      chatwoot_account_id?: number;
      channel?: string;
      from?: string;
      text?: string;
      account_id?: string;
      message_id?: string;
    };

    // Resolve tenant primarily by which OpenClaw account slot actually received the
    // message (channel_links.openclaw_account_id) — in shared-gateway mode OpenClaw
    // sends the same chatwoot_account_id on every webhook regardless of which
    // tenant's channel account the message came in on, so that field alone
    // misroutes every tenant but the first onto tenant 1. Fall back to it only
    // when no channel_link matches (e.g. body.account_id missing/unrecognized).
    const byAccountId = body.account_id ? await getTenantByOpenclawAccountId(body.account_id) : null;
    const accountId =
      byAccountId?.chatwootAccountId ??
      (typeof body.chatwoot_account_id === "number" && body.chatwoot_account_id > 0
        ? body.chatwoot_account_id
        : 1);
    const tenant = byAccountId ?? (await getTenantByAccountId(accountId));

    const fresh =
      Boolean(body.channel && body.from && body.text) &&
      claimInboundMessageOnce({
        accountId: body.account_id,
        messageId: body.message_id,
        from: body.from,
        text: body.text,
      });
    if (fresh) {
      const channel = String(body.channel).toLowerCase();
      try {
        if (channel === "whatsapp") {
          await syncWhatsAppInbound({
            tenantId: tenant?.id,
            tenantAccountId: accountId,
            from: body.from,
            text: body.text,
            accountId: body.account_id,
          });
        } else {
          await syncChannelInbound({
            channel,
            tenantId: tenant?.id,
            tenantAccountId: accountId,
            from: body.from,
            text: body.text,
            accountId: body.account_id,
          });
        }
      } catch (error) {
        request.log.warn({ err: error, channel }, "openclaw inbound sync failed");
      }
    }

    await recordEvent({
      tenantId: tenant?.id ?? null,
      kind: "openclaw.inbound",
      payload: body,
    });
    return { ok: true };
  });
}
