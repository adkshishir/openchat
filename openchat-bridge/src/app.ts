import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { handleAdminMcpRequest, handleCommerceMcpRequest } from "./mcp/server.ts";
import { registerAdminChatRoutes } from "./routes/admin-chat.ts";
import { registerChannelRoutes } from "./routes/channels.ts";
import { registerKnowledgeRoutes } from "./routes/knowledge.ts";
import { registerOpenClawAgentRoutes } from "./routes/openclaw-agent.ts";
import { registerOpenClawChannelRoutes } from "./routes/openclaw-channels.ts";
import { registerOrderRoutes } from "./routes/orders.ts";
import { registerProvisionRoutes } from "./routes/provision.ts";
import { registerSaasRoutes } from "./routes/saas.ts";
import { registerSettingsRoutes } from "./routes/settings.ts";
import { registerWebhookRoutes } from "./routes/webhooks.ts";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(multipart);
  app.get("/health", async () => ({ ok: true, service: "openchat-bridge" }));
  await registerProvisionRoutes(app);
  await registerWebhookRoutes(app);
  await registerChannelRoutes(app);
  await registerOpenClawChannelRoutes(app);
  await registerOpenClawAgentRoutes(app);
  await registerSettingsRoutes(app);
  await registerKnowledgeRoutes(app);
  await registerOrderRoutes(app);
  await registerSaasRoutes(app);
  await registerAdminChatRoutes(app);
  // The only MCP endpoint the "openchat-admin" OpenClaw agent persona is configured
  // to reach (see OpenClawGatewayClient#ensureAdminAgentConfigured) — never exposed
  // to the customer-facing agent's mcp.servers config.
  app.post("/mcp/admin", handleAdminMcpRequest);
  // The only MCP endpoint any tenant's customer-facing agent is configured to reach
  // (see OpenClawGatewayClient#ensureTenantAgentConfigured) — never exposed to the
  // "openchat-admin" persona's mcp.servers config.
  app.post("/mcp/commerce", handleCommerceMcpRequest);
  return app;
}
