import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../crypto.ts";
import type { ChatwootMessageWebhook } from "../types.ts";
import { handleAgentBotWebhook, verifyChatwootSignature } from "../services/agent-reply.ts";
import { getAgentBot, getTenantByAccountId, recordEvent } from "../services/tenants.ts";
import { syncChannelInbound, syncHumanReplyToChannel, syncWhatsAppInbound } from "../services/sync.ts";
import { OPENCLAW_NATIVE_CHANNELS } from "../services/channel-types.ts";

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
      // WhatsApp destinations are phone numbers and need E.164 formatting; other channels
      // (Discord snowflake IDs, etc.) use their raw identifier as-is — reformatting would
      // corrupt them (e.g. a Discord id is all digits and would get a bogus "+" prepended).
      const to =
        link?.channelType === "whatsapp"
          ? rawTo
            ? rawTo.startsWith("+")
              ? rawTo
              : rawTo.replace(/\D/g, "").length === 10 && rawTo.replace(/\D/g, "").startsWith("9")
                ? `+977${rawTo.replace(/\D/g, "")}`
                : `+${rawTo.replace(/\D/g, "")}`
            : null
          : rawTo;
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
    };

    // Resolve Chatwoot tenant before observability insert — OpenClaw may send
    // OPENCLAW_TENANT_ID=shared-dev which is not a tenants.id UUID.
    const accountId =
      typeof body.chatwoot_account_id === "number" && body.chatwoot_account_id > 0
        ? body.chatwoot_account_id
        : 1;
    const tenant = await getTenantByAccountId(accountId);

    if (body.channel && body.from && body.text) {
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
