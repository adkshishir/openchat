function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8090),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://openchat:openchat@localhost:5432/openchat_bridge",
  secret: required("OPENCHAT_SECRET", "dev-openchat-secret-change-me-32b"),
  chatwootBaseUrl: process.env.CHATWOOT_BASE_URL ?? "http://localhost:3000",
  chatwootPlatformToken: process.env.CHATWOOT_PLATFORM_TOKEN ?? "",
  openclawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789",
  openclawGatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?? "",
  openclawGatewayImage: process.env.OPENCLAW_GATEWAY_IMAGE ?? "openclaw:local",
  /** Must point at the same OpenClaw state that holds the paired operator device (operator.admin). */
  openclawStateDir: process.env.OPENCLAW_STATE_DIR ?? "",
  bridgePublicUrl: process.env.OPENCHAT_BRIDGE_PUBLIC_URL ?? "http://localhost:8090",
  /**
   * "shared": every tenant talks to one OpenClaw gateway (one WhatsApp number, one memory
   * store, shared across all tenants — dev/single-tenant only).
   * "fleet": each tenant gets its own `openclaw fleet` cell (own state, own WhatsApp
   * number, own memory). Requires the bridge to reach each cell's gateway over real
   * host loopback (127.0.0.1) — run the bridge as a native process on the Fleet host,
   * not inside its own container, or `operator.admin` gets stripped on connect.
   */
  gatewayPoolMode: (process.env.GATEWAY_POOL_MODE ?? "shared") as "shared" | "fleet",
  /** Image used to run `openclaw fleet` commands: the gateway image + a `docker` CLI. See deploy/fleet-runner. */
  fleetRunnerImage: process.env.OPENCLAW_FLEET_RUNNER_IMAGE ?? "openclaw-fleet-runner:local",
  /** uid:gid the one-shot fleet-runner container runs as, so bind-mounted cell state isn't root-owned. */
  fleetRunnerUid: process.env.OPENCLAW_FLEET_RUNNER_UID ?? String(process.getuid?.() ?? 1000),
  fleetRunnerGid: process.env.OPENCLAW_FLEET_RUNNER_GID ?? String(process.getgid?.() ?? 1000),
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 30),
  provisionSharedSecret: process.env.OPENCHAT_PROVISION_SECRET ?? "dev-provision-secret",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  embeddingModel: process.env.OPENCHAT_EMBEDDING_MODEL ?? "nomic-embed-text",
  knowledgeMaxUploadBytes: Number(process.env.OPENCHAT_KNOWLEDGE_MAX_UPLOAD_BYTES ?? 5_000_000),
  knowledgeTopK: Number(process.env.OPENCHAT_KNOWLEDGE_TOP_K ?? 4),
};
