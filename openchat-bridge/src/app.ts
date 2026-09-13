import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { registerChannelRoutes } from "./routes/channels.ts";
import { registerKnowledgeRoutes } from "./routes/knowledge.ts";
import { registerOpenClawAgentRoutes } from "./routes/openclaw-agent.ts";
import { registerOpenClawChannelRoutes } from "./routes/openclaw-channels.ts";
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
  await registerSaasRoutes(app);
  return app;
}
