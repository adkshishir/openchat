CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  chatwoot_account_id INTEGER NOT NULL UNIQUE,
  openclaw_tenant_id TEXT NOT NULL UNIQUE,
  gateway_url TEXT NOT NULL,
  gateway_token_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  billing_customer_id TEXT,
  custom_prompt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Column added after the initial release; existing tenants rows predate it.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_prompt TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS channel_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  openclaw_account_id TEXT,
  chatwoot_inbox_id INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- One link per channel per tenant: re-registering (e.g. after the Chatwoot
  -- inbox was deleted and recreated) must replace it, not leave a stale row
  -- that inbound-message lookups (by tenant + channel only) could still hit.
  UNIQUE (tenant_id, channel_type)
);

-- Older deployments created this table with a three-column unique constraint
-- (tenant_id, channel_type, chatwoot_inbox_id); upsertChannelLink's
-- ON CONFLICT (tenant_id, channel_type) target only matches the two-column
-- form declared above. Idempotently repair pre-existing tables to match.
ALTER TABLE channel_links DROP CONSTRAINT IF EXISTS channel_links_tenant_id_channel_type_chatwoot_inbox_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'channel_links'::regclass AND conname = 'channel_links_tenant_id_channel_type_key'
  ) THEN
    ALTER TABLE channel_links ADD CONSTRAINT channel_links_tenant_id_channel_type_key UNIQUE (tenant_id, channel_type);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS conversation_map (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_link_id TEXT NOT NULL REFERENCES channel_links(id) ON DELETE CASCADE,
  external_contact_id TEXT NOT NULL,
  chatwoot_conversation_id INTEGER NOT NULL,
  UNIQUE (tenant_id, channel_link_id, external_contact_id)
);

CREATE TABLE IF NOT EXISTS agent_bots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  chatwoot_agent_bot_id INTEGER NOT NULL,
  access_token_enc TEXT NOT NULL,
  secret_enc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observability_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS observability_events_created_at_idx ON observability_events (created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'document' | 'catalog'
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_sources_tenant_idx ON knowledge_sources (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL, -- 'document' | 'product'
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_idx ON knowledge_chunks (tenant_id);

-- Orders the agent places autonomously via the create_order commerce tool
-- (mcp/commerce-tools.ts) after collecting product + customer details in chat.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chatwoot_conversation_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  product_price TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- new | fulfilled | cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_tenant_idx ON orders (tenant_id, created_at DESC);

-- Which option the customer picked when the product has variants (e.g. "Switch: Brown").
-- Without it an order for a multi-variant product is unfulfillable — the catalog says
-- Red/Blue/Brown and the order row just says "Bluetooth Mechanical Keyboard".
ALTER TABLE orders ADD COLUMN IF NOT EXISTS variant TEXT;
