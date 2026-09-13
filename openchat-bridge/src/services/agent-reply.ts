import { decryptSecret, hmacSha256 } from "../crypto.ts";
import { config } from "../config.ts";
import type { ChatwootMessageWebhook, Tenant } from "../types.ts";
import { OPENCLAW_NATIVE_CHANNELS } from "./channel-types.ts";
import { ChatwootClient } from "./chatwoot.ts";
import { decideHandoff } from "./handoff.ts";
import { searchKnowledge } from "./knowledge.ts";
import { OpenClawGatewayClient } from "./openclaw.ts";
import { allowRequest } from "./rate-limit.ts";
import { getAgentBot, getChannelLinkByInbox, getConversationMapByChatwootId, recordEvent, upsertConversationMap } from "./tenants.ts";

export function verifyChatwootSignature(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  body: string;
}): boolean {
  if (!input.timestamp || !input.signature) {
    return false;
  }
  const expected = `sha256=${hmacSha256(input.secret, `${input.timestamp}.${input.body}`)}`;
  return expected === input.signature;
}

function conversationId(payload: ChatwootMessageWebhook): number | null {
  return payload.conversation?.display_id ?? payload.conversation?.id ?? null;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    const user = trimmed.split("@")[0] ?? trimmed;
    const digits = user.replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

/** Resolve the WhatsApp destination strictly from this conversation — never from model output. */
async function resolveWhatsAppDestination(input: {
  tenantId: string;
  convId: number;
  payload: ChatwootMessageWebhook;
}): Promise<string | null> {
  const mapped = await getConversationMapByChatwootId(input.tenantId, input.convId);
  const fromMap = normalizePhone(mapped?.externalContactId);
  if (fromMap) return fromMap;

  const fromMeta = normalizePhone(
    input.payload.conversation?.meta?.sender?.identifier ??
      input.payload.conversation?.meta?.sender?.phone_number ??
      input.payload.sender?.identifier ??
      null,
  );
  return fromMeta;
}

/** Account webhook + OpenClaw AgentBot both hit the same URL — dedupe by Chatwoot message id. */
const inflightReplies = new Map<string, number>();

function claimReplyOnce(tenantId: string, messageId: number | string | null | undefined): boolean {
  if (messageId == null || messageId === "") return true;
  const key = `${tenantId}:${messageId}`;
  const now = Date.now();
  const prev = inflightReplies.get(key);
  if (prev && now - prev < 120_000) return false;
  inflightReplies.set(key, now);
  if (inflightReplies.size > 500) {
    for (const [k, ts] of inflightReplies) {
      if (now - ts > 120_000) inflightReplies.delete(k);
    }
  }
  return true;
}

export async function handleAgentBotWebhook(input: {
  tenant: Tenant;
  payload: ChatwootMessageWebhook;
}): Promise<{ ok: true; action: string }> {
  const assignee = input.payload.conversation?.meta?.assignee;
  const assigneeType = input.payload.conversation?.meta?.assignee_type ?? assignee?.type;
  const humanAssignee = Boolean(assignee) && assigneeType !== "agent_bot" && assigneeType !== "AgentBot";
  const decision = decideHandoff({
    event: input.payload.event,
    messageType: input.payload.message_type,
    privateNote: input.payload.private,
    senderType: input.payload.sender?.type,
    humanAssignee,
    aiEnabled: input.tenant.aiEnabled,
    tenantStatus: input.tenant.status,
    content: input.payload.content,
  });

  await recordEvent({
    tenantId: input.tenant.id,
    kind: "webhook.decision",
    payload: { action: decision.action, reason: "reason" in decision ? decision.reason : null },
  });

  const convId = conversationId(input.payload);
  const bot = await getAgentBot(input.tenant.id);
  if (!bot || !convId) {
    return { ok: true, action: decision.action };
  }
  const token = decryptSecret(bot.accessTokenEnc);
  const chatwoot = new ChatwootClient(input.tenant.chatwootAccountId, token);

  if (decision.action === "escalate") {
    await chatwoot.toggleStatus(convId, "open");
    await chatwoot.assignConversation(convId, null);
    await chatwoot.postMessage(convId, "Connecting you with a human agent.", { private: false });
    return { ok: true, action: "escalate" };
  }
  if (decision.action !== "reply") {
    return { ok: true, action: decision.action };
  }
  const messageId = input.payload.id ?? null;
  if (!claimReplyOnce(input.tenant.id, messageId)) {
    return { ok: true, action: "deduped" };
  }
  if (!allowRequest(input.tenant.id, config.rateLimitPerMinute)) {
    await recordEvent({ tenantId: input.tenant.id, kind: "rate_limited", payload: { convId } });
    return { ok: true, action: "rate_limited" };
  }

  const inboxId = input.payload.inbox?.id ?? input.payload.conversation?.inbox_id;
  const phone = await resolveWhatsAppDestination({
    tenantId: input.tenant.id,
    convId,
    payload: input.payload,
  });
  const link = inboxId ? await getChannelLinkByInbox(input.tenant.id, inboxId) : null;

  if (link && OPENCLAW_NATIVE_CHANNELS.has(link.channelType)) {
    return { ok: true, action: "openclaw_native_mirror" };
  }

  const contactKey = phone ?? `conversation:${convId}`;
  const sessionKey = `openclaw:${input.tenant.id}:${inboxId ?? "inbox"}:${contactKey}`;
  if (link && phone) {
    await upsertConversationMap({
      tenantId: input.tenant.id,
      channelLinkId: link.id,
      externalContactId: phone,
      chatwootConversationId: convId,
    });
  }

  const channelLabel = (() => {
    if (link?.channelType === "whatsapp") return "WhatsApp";
    if (link?.channelType === "web_widget") return "website widget";
    const inboxName = input.payload.inbox?.name?.toLowerCase() ?? "";
    if (inboxName.includes("whatsapp")) return "WhatsApp";
    if (inboxName.includes("widget") || inboxName.includes("website")) return "website widget";
    return "chat";
  })();
  const started = Date.now();
  const gateway = new OpenClawGatewayClient(input.tenant.gatewayUrl, decryptSecret(input.tenant.gatewayTokenEnc));

  let knowledgeContext = "";
  try {
    const matches = await searchKnowledge(input.tenant.id, input.payload.content ?? "");
    if (matches.length) {
      const snippets = matches.map((m) => `- ${m.content}`).join("\n");
      knowledgeContext =
        `Relevant product/knowledge base info (only mention what's actually relevant to the customer's message):\n${snippets}\n\n`;
    }
  } catch (error) {
    await recordEvent({
      tenantId: input.tenant.id,
      kind: "knowledge.search_failed",
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
  }

  let reply = "";
  let agentError: string | null = null;
  try {
    // OpenClaw is the agent — Chatwoot only delivers the conversation.
    reply = await gateway.invokeAgent({
      sessionKey,
      message:
        `You are the OpenClaw agent for this ${channelLabel} conversation (${contactKey}). ` +
        `Reply to the customer in plain text only. Do not invent other channels or phone numbers.\n\n` +
        `${knowledgeContext}${input.payload.content ?? ""}`,
    });
  } catch (error) {
    agentError = error instanceof Error ? error.message : String(error);
    await recordEvent({
      tenantId: input.tenant.id,
      kind: "agent.reply_failed",
      payload: { convId, error: agentError, sessionKey },
    });
  }

  const rateLimited =
    Boolean(agentError) &&
    /rate limit|quota|429/i.test(agentError ?? "");
  const text = reply.trim()
    ? reply.trim()
    : rateLimited
      ? "Our AI is temporarily rate-limited. A human will follow up shortly."
      : agentError
        ? "Sorry, I could not generate a reply right now."
        : "Sorry, I could not generate a reply.";
  await chatwoot.postMessage(convId, text);

  if (link?.channelType === "whatsapp" && phone) {
    try {
      await gateway.sendWhatsApp(phone, text, link.openclawAccountId ?? input.tenant.openclawTenantId);
      await recordEvent({
        tenantId: input.tenant.id,
        kind: "whatsapp.outbound.agent",
        payload: { convId, to: phone },
      });
    } catch (error) {
      await recordEvent({
        tenantId: input.tenant.id,
        kind: "whatsapp.outbound.agent_failed",
        payload: { convId, to: phone, error: String(error) },
      });
    }
  } else if (link?.channelType === "whatsapp" && !phone) {
    await recordEvent({
      tenantId: input.tenant.id,
      kind: "whatsapp.outbound.skipped_no_phone",
      payload: { convId },
    });
  }

  await recordEvent({
    tenantId: input.tenant.id,
    kind: "agent.reply",
    payload: { convId, latencyMs: Date.now() - started, sessionKey, to: phone },
  });
  return { ok: true, action: "reply" };
}
