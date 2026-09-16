import { query } from "../db.ts";
import { decryptSecret } from "../crypto.ts";
import { config } from "../config.ts";
import { ChatwootClient, createPublicIncomingMessage } from "./chatwoot.ts";
import { OpenClawGatewayClient } from "./openclaw.ts";
import { getAgentBot, getTenantByAccountId, recordEvent, upsertConversationMap } from "./tenants.ts";

async function resolveTenant(input: { tenantId?: string; tenantAccountId?: number }) {
  if (input.tenantAccountId) {
    const byAccount = await getTenantByAccountId(Number(input.tenantAccountId));
    if (byAccount) return byAccount;
  }
  if (input.tenantId) {
    const byUuid = await query("SELECT * FROM tenants WHERE id = $1", [input.tenantId]);
    if (byUuid[0]) {
      return {
        id: String(byUuid[0].id),
        chatwootAccountId: Number(byUuid[0].chatwoot_account_id),
        openclawTenantId: String(byUuid[0].openclaw_tenant_id),
        gatewayUrl: String(byUuid[0].gateway_url),
        gatewayTokenEnc: String(byUuid[0].gateway_token_enc),
        status: byUuid[0].status as "provisioning" | "active" | "suspended" | "deleted",
        aiEnabled: Boolean(byUuid[0].ai_enabled),
        billingCustomerId: byUuid[0].billing_customer_id ? String(byUuid[0].billing_customer_id) : null,
        createdAt: new Date(String(byUuid[0].created_at)),
      };
    }
    const byOpenclaw = await query("SELECT * FROM tenants WHERE openclaw_tenant_id = $1", [input.tenantId]);
    if (byOpenclaw[0]) {
      return {
        id: String(byOpenclaw[0].id),
        chatwootAccountId: Number(byOpenclaw[0].chatwoot_account_id),
        openclawTenantId: String(byOpenclaw[0].openclaw_tenant_id),
        gatewayUrl: String(byOpenclaw[0].gateway_url),
        gatewayTokenEnc: String(byOpenclaw[0].gateway_token_enc),
        status: byOpenclaw[0].status as "provisioning" | "active" | "suspended" | "deleted",
        aiEnabled: Boolean(byOpenclaw[0].ai_enabled),
        billingCustomerId: byOpenclaw[0].billing_customer_id
          ? String(byOpenclaw[0].billing_customer_id)
          : null,
        createdAt: new Date(String(byOpenclaw[0].created_at)),
      };
    }
  }
  // Shared local gateway often has a single tenant.
  const fallback = await query("SELECT * FROM tenants ORDER BY created_at ASC LIMIT 1");
  if (fallback[0] && !input.tenantId && !input.tenantAccountId) {
    return getTenantByAccountId(Number(fallback[0].chatwoot_account_id));
  }
  if (fallback[0] && (input.tenantId || input.tenantAccountId)) {
    // Still prefer account-scoped when only one tenant exists in shared mode.
    const only = await query("SELECT COUNT(*)::int AS c FROM tenants");
    if (Number(only[0]?.c) === 1) {
      return getTenantByAccountId(Number(fallback[0].chatwoot_account_id));
    }
  }
  return null;
}

export async function syncWhatsAppInbound(input: {
  tenantAccountId?: number;
  tenantId?: string;
  from: string;
  text: string;
  accountId?: string;
}) {
  return syncChannelInbound({
    ...input,
    channel: "whatsapp",
  });
}

/** Sync an OpenClaw channel message into the matching Chatwoot API inbox. */
export async function syncChannelInbound(input: {
  channel: string;
  tenantAccountId?: number;
  tenantId?: string;
  from: string;
  text: string;
  accountId?: string;
}) {
  const channel = String(input.channel || "").toLowerCase();
  if (!channel) throw new Error("channel required");
  const tenant = await resolveTenant({
    tenantId: input.tenantId,
    tenantAccountId: input.tenantAccountId,
  });
  if (!tenant) {
    throw new Error("tenant not found");
  }
  const tenantId = tenant.id;
  const links = await query(
    "SELECT * FROM channel_links WHERE tenant_id = $1 AND channel_type = $2",
    [tenantId, channel],
  );
  const link = links[0];
  if (!link) {
    throw new Error(`${channel} channel not linked`);
  }
  const identifier = (link.metadata as { inboxIdentifier?: string } | null)?.inboxIdentifier;
  if (!identifier) {
    throw new Error(`${channel} inbox identifier missing`);
  }

  const created = await createPublicIncomingMessage({
    inboxIdentifier: identifier,
    contactIdentifier: input.from,
    content: input.text,
    channel,
  });

  await upsertConversationMap({
    tenantId,
    channelLinkId: String(link.id),
    externalContactId: created.sourceId,
    chatwootConversationId: created.conversationId,
  });

  // Bot-owned inboxes put new chats in "Pending" — open them so they appear in Open.
  try {
    const bot = await getAgentBot(tenantId);
    if (bot) {
      const chatwoot = new ChatwootClient(tenant.chatwootAccountId, decryptSecret(bot.accessTokenEnc));
      await chatwoot.toggleStatus(created.conversationId, "open");
    }
  } catch {
    // Non-fatal: message is already in Chatwoot.
  }

  await recordEvent({
    tenantId,
    kind: `${channel}.inbound`,
    payload: {
      from: input.from,
      sourceId: created.sourceId,
      conversationId: created.conversationId,
      accountId: input.accountId ?? null,
    },
  });
  return created;
}

export async function syncHumanReplyToWhatsApp(input: {
  tenantId: string;
  conversationId: number;
  content: string;
  to: string;
}) {
  return syncHumanReplyToChannel({ ...input, channel: "whatsapp" });
}

/** Relay a reply typed in Chatwoot out to any OpenClaw channel (WhatsApp, Discord, ...). */
export async function syncHumanReplyToChannel(input: {
  tenantId: string;
  channel: string;
  conversationId: number;
  content: string;
  to: string;
  accountId?: string;
}) {
  const tenantRows = await query("SELECT * FROM tenants WHERE id = $1", [input.tenantId]);
  const tenant = tenantRows[0];
  if (!tenant) return;
  const gateway = new OpenClawGatewayClient(
    String(tenant.gateway_url),
    decryptSecret(String(tenant.gateway_token_enc)),
  );
  // agentId disambiguates the send's session owner once multiple agents are
  // configured (see OpenClawGatewayClient#sendMessage) — this tenant's own agent.
  await gateway.sendMessage(input.channel, input.to, input.content, input.accountId, String(tenant.openclaw_tenant_id));
  await recordEvent({
    tenantId: input.tenantId,
    kind: `${input.channel}.outbound.human`,
    payload: { conversationId: input.conversationId, to: input.to },
  });
}

export async function ensureWhatsAppApiInbox(input: {
  tenantId: string;
  accountId: number;
  agentBotId: number;
  accessToken: string;
  accountIdOpenclaw?: string;
}) {
  const existing = await query(
    "SELECT * FROM channel_links WHERE tenant_id = $1 AND channel_type = 'whatsapp' LIMIT 1",
    [input.tenantId],
  );
  if (existing[0]) {
    return {
      id: Number(existing[0].chatwoot_inbox_id),
      channel: {
        identifier: (existing[0].metadata as { inboxIdentifier?: string } | null)?.inboxIdentifier,
      },
      reused: true,
    };
  }

  const chatwoot = new ChatwootClient(input.accountId, input.accessToken);
  const inbox = await chatwoot.createApiInbox(
    "WhatsApp (OpenClaw)",
    `${config.bridgePublicUrl}/webhooks/chatwoot/${input.accountId}`,
  );
  await chatwoot.setAgentBot(inbox.id, input.agentBotId);
  const { upsertChannelLink } = await import("./tenants.ts");
  await upsertChannelLink({
    tenantId: input.tenantId,
    channelType: "whatsapp",
    chatwootInboxId: inbox.id,
    openclawAccountId: input.accountIdOpenclaw ?? "default",
    metadata: { inboxIdentifier: inbox.channel?.identifier, provider: "openclaw" },
  });
  return { ...inbox, reused: false };
}

export async function getBotForAccount(accountId: number) {
  const tenant = await getTenantByAccountId(accountId);
  if (!tenant) return null;
  return { tenant, bot: await getAgentBot(tenant.id) };
}
