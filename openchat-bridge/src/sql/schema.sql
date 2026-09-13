CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  chatwoot_account_id INTEGER NOT NULL UNIQUE,
  openclaw_tenant_id TEXT NOT NULL UNIQUE,
  gateway_url TEXT NOT NULL,
  gateway_token_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  billing_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
