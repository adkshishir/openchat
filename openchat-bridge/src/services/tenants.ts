import crypto from "node:crypto";
import { query } from "../db.ts";
import type { AgentBotRecord, ChannelLink, ConversationMap, ObservabilityEvent, Tenant } from "../types.ts";

function mapTenant(row: Record<string, unknown>): Tenant {
  return {
    id: String(row.id),
    chatwootAccountId: Number(row.chatwoot_account_id),
    openclawTenantId: String(row.openclaw_tenant_id),
    gatewayUrl: String(row.gateway_url),
    gatewayTokenEnc: String(row.gateway_token_enc),
    status: row.status as Tenant["status"],
    aiEnabled: Boolean(row.ai_enabled),
    billingCustomerId: row.billing_customer_id ? String(row.billing_customer_id) : null,
    customPrompt: row.custom_prompt != null ? String(row.custom_prompt) : "",
    createdAt: new Date(String(row.created_at)),
  };
}

/** Fleet tenant ids must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$ — "oc-<accountId>" always does. */
export function openclawTenantIdFor(chatwootAccountId: number): string {
  return `oc-${chatwootAccountId}`;
}

export async function createTenant(input: {
  chatwootAccountId: number;
  gatewayUrl: string;
  gatewayTokenEnc: string;
}): Promise<Tenant> {
  const id = crypto.randomUUID();
  const openclawTenantId = openclawTenantIdFor(input.chatwootAccountId);
  const rows = await query(
    `INSERT INTO tenants (id, chatwoot_account_id, openclaw_tenant_id, gateway_url, gateway_token_enc, status)
     VALUES ($1, $2, $3, $4, $5, 'provisioning')
     ON CONFLICT (chatwoot_account_id) DO UPDATE SET
       gateway_url = EXCLUDED.gateway_url,
       gateway_token_enc = EXCLUDED.gateway_token_enc,
       status = 'provisioning'
     RETURNING *`,
    [id, input.chatwootAccountId, openclawTenantId, input.gatewayUrl, input.gatewayTokenEnc],
  );
  return mapTenant(rows[0]);
}

export async function getTenantByAccountId(accountId: number): Promise<Tenant | null> {
  const rows = await query("SELECT * FROM tenants WHERE chatwoot_account_id = $1", [accountId]);
  return rows[0] ? mapTenant(rows[0]) : null;
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const rows = await query("SELECT * FROM tenants WHERE id = $1", [id]);
  return rows[0] ? mapTenant(rows[0]) : null;
}

export async function listActiveTenants(): Promise<Tenant[]> {
  const rows = await query("SELECT * FROM tenants WHERE status = 'active'");
  return rows.map(mapTenant);
}

/**
 * Resolve a tenant by the OpenClaw channel account id that actually received a
 * message (channel_links.openclaw_account_id — the bridge's own source of truth
 * for which tenant owns which OpenClaw account slot). In shared-gateway mode every
 * inbound webhook's `chatwoot_account_id` field is unreliable (OpenClaw sends the
 * same value regardless of which tenant's account/number the message came in on),
 * so this is the correct primary way to resolve inbound webhooks — not chatwoot_account_id.
 */
export async function getTenantByOpenclawAccountId(openclawAccountId: string): Promise<Tenant | null> {
  const rows = await query(
    `SELECT t.* FROM tenants t
     JOIN channel_links cl ON cl.tenant_id = t.id
     WHERE cl.openclaw_account_id = $1
     LIMIT 1`,
    [openclawAccountId],
  );
  return rows[0] ? mapTenant(rows[0]) : null;
}

export async function setTenantStatus(id: string, status: Tenant["status"]): Promise<void> {
  await query("UPDATE tenants SET status = $2 WHERE id = $1", [id, status]);
}

export async function setTenantAiEnabled(id: string, enabled: boolean): Promise<void> {
  await query("UPDATE tenants SET ai_enabled = $2 WHERE id = $1", [id, enabled]);
}

export async function setBillingCustomer(id: string, customerId: string): Promise<void> {
  await query("UPDATE tenants SET billing_customer_id = $2 WHERE id = $1", [id, customerId]);
}

export async function setTenantCustomPrompt(id: string, prompt: string): Promise<void> {
  await query("UPDATE tenants SET custom_prompt = $2 WHERE id = $1", [id, prompt]);
}

export async function upsertAgentBot(input: {
  tenantId: string;
  chatwootAgentBotId: number;
  accessTokenEnc: string;
  secretEnc: string;
}): Promise<AgentBotRecord> {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO agent_bots (id, tenant_id, chatwoot_agent_bot_id, access_token_enc, secret_enc)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id) DO UPDATE SET
       chatwoot_agent_bot_id = EXCLUDED.chatwoot_agent_bot_id,
       access_token_enc = EXCLUDED.access_token_enc,
       secret_enc = EXCLUDED.secret_enc
     RETURNING *`,
    [id, input.tenantId, input.chatwootAgentBotId, input.accessTokenEnc, input.secretEnc],
  );
  const row = rows[0];
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    chatwootAgentBotId: Number(row.chatwoot_agent_bot_id),
    accessTokenEnc: String(row.access_token_enc),
    secretEnc: String(row.secret_enc),
  };
}

export async function getAgentBot(tenantId: string): Promise<AgentBotRecord | null> {
  const rows = await query("SELECT * FROM agent_bots WHERE tenant_id = $1", [tenantId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    chatwootAgentBotId: Number(row.chatwoot_agent_bot_id),
    accessTokenEnc: String(row.access_token_enc),
    secretEnc: String(row.secret_enc),
  };
}

export async function upsertChannelLink(input: {
  tenantId: string;
  channelType: ChannelLink["channelType"];
  chatwootInboxId: number;
  openclawAccountId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ChannelLink> {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO channel_links (id, tenant_id, channel_type, openclaw_account_id, chatwoot_inbox_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (tenant_id, channel_type) DO UPDATE SET
       openclaw_account_id = EXCLUDED.openclaw_account_id,
       chatwoot_inbox_id = EXCLUDED.chatwoot_inbox_id,
       metadata = EXCLUDED.metadata
     RETURNING *`,
    [
      id,
      input.tenantId,
      input.channelType,
      input.openclawAccountId ?? null,
      input.chatwootInboxId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  const row = rows[0];
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    channelType: row.channel_type as ChannelLink["channelType"],
    openclawAccountId: row.openclaw_account_id ? String(row.openclaw_account_id) : null,
    chatwootInboxId: Number(row.chatwoot_inbox_id),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

export async function getChannelLinkByInbox(
  tenantId: string,
  inboxId: number,
): Promise<ChannelLink | null> {
  const rows = await query(
    "SELECT * FROM channel_links WHERE tenant_id = $1 AND chatwoot_inbox_id = $2",
    [tenantId, inboxId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    channelType: row.channel_type as ChannelLink["channelType"],
    openclawAccountId: row.openclaw_account_id ? String(row.openclaw_account_id) : null,
    chatwootInboxId: Number(row.chatwoot_inbox_id),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

/**
 * The tenant already using this WhatsApp number, if any other tenant is.
 * A WhatsApp number belongs to exactly one tenant: two tenants linking the same
 * number means two Baileys sessions racing for the same phone, and WhatsApp kills
 * one of them (401 "Connection Failure") — so the loser silently stops receiving.
 */
export async function findWhatsAppNumberOwner(input: {
  waNumber: string;
  excludeTenantId: string;
}): Promise<{ tenantId: string; chatwootAccountId: number } | null> {
  const rows = await query(
    `SELECT cl.tenant_id, t.chatwoot_account_id
       FROM channel_links cl
       JOIN tenants t ON t.id = cl.tenant_id
      WHERE cl.channel_type = 'whatsapp'
        AND cl.tenant_id <> $2
        AND cl.metadata->>'waNumber' = $1
      LIMIT 1`,
    [input.waNumber, input.excludeTenantId],
  );
  const row = rows[0];
  return row ? { tenantId: String(row.tenant_id), chatwootAccountId: Number(row.chatwoot_account_id) } : null;
}

export async function upsertConversationMap(input: {
  tenantId: string;
  channelLinkId: string;
  externalContactId: string;
  chatwootConversationId: number;
}): Promise<ConversationMap> {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO conversation_map (id, tenant_id, channel_link_id, external_contact_id, chatwoot_conversation_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, channel_link_id, external_contact_id) DO UPDATE SET
       chatwoot_conversation_id = EXCLUDED.chatwoot_conversation_id
     RETURNING *`,
    [id, input.tenantId, input.channelLinkId, input.externalContactId, input.chatwootConversationId],
  );
  const row = rows[0];
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    channelLinkId: String(row.channel_link_id),
    externalContactId: String(row.external_contact_id),
    chatwootConversationId: Number(row.chatwoot_conversation_id),
  };
}

export async function deleteChannelLinkByInbox(
  tenantId: string,
  chatwootInboxId: number,
): Promise<{ deletedLinks: number; deletedMaps: number }> {
  const links = await query("SELECT id FROM channel_links WHERE tenant_id = $1 AND chatwoot_inbox_id = $2", [
    tenantId,
    chatwootInboxId,
  ]);
  if (!links[0]) {
    return { deletedLinks: 0, deletedMaps: 0 };
  }
  const linkIds = links.map((row) => String(row.id));
  const maps = await query(
    "DELETE FROM conversation_map WHERE tenant_id = $1 AND channel_link_id = ANY($2::text[]) RETURNING id",
    [tenantId, linkIds],
  );
  const removed = await query(
    "DELETE FROM channel_links WHERE tenant_id = $1 AND chatwoot_inbox_id = $2 RETURNING id",
    [tenantId, chatwootInboxId],
  );
  return { deletedLinks: removed.length, deletedMaps: maps.length };
}

export async function teardownTenant(tenantId: string): Promise<{
  deletedLinks: number;
  deletedMaps: number;
  deletedBots: number;
}> {
  const links = await query("SELECT id FROM channel_links WHERE tenant_id = $1", [tenantId]);
  const linkIds = links.map((row) => String(row.id));
  const maps = linkIds.length
    ? await query(
        "DELETE FROM conversation_map WHERE tenant_id = $1 AND channel_link_id = ANY($2::text[]) RETURNING id",
        [tenantId, linkIds],
      )
    : [];
  const removedLinks = await query("DELETE FROM channel_links WHERE tenant_id = $1 RETURNING id", [tenantId]);
  const removedBots = await query("DELETE FROM agent_bots WHERE tenant_id = $1 RETURNING id", [tenantId]);
  await setTenantStatus(tenantId, "deleted");
  return {
    deletedLinks: removedLinks.length,
    deletedMaps: maps.length,
    deletedBots: removedBots.length,
  };
}

export async function getConversationMapByChatwootId(
  tenantId: string,
  chatwootConversationId: number,
): Promise<ConversationMap | null> {
  const rows = await query(
    `SELECT * FROM conversation_map
     WHERE tenant_id = $1 AND chatwoot_conversation_id = $2
     ORDER BY id DESC LIMIT 1`,
    [tenantId, chatwootConversationId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    channelLinkId: String(row.channel_link_id),
    externalContactId: String(row.external_contact_id),
    chatwootConversationId: Number(row.chatwoot_conversation_id),
  };
}

export async function recordEvent(input: {
  tenantId?: string | null;
  kind: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  // Only store tenant_id when it is a real tenants.id UUID (OpenClaw may send labels like "shared-dev").
  const raw = input.tenantId?.trim() || null;
  const tenantId =
    raw && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
      ? raw
      : null;
  await query(
    "INSERT INTO observability_events (id, tenant_id, kind, payload) VALUES ($1, $2, $3, $4::jsonb)",
    [crypto.randomUUID(), tenantId, input.kind, JSON.stringify(input.payload)],
  );
}

export async function listEvents(limit = 100): Promise<ObservabilityEvent[]> {
  const rows = await query(
    "SELECT * FROM observability_events ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return rows.map((row) => ({
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
    kind: String(row.kind),
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at)),
  }));
}
