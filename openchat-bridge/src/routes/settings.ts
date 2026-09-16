import type { FastifyInstance } from "fastify";
import { getTenantByAccountId, setTenantAiEnabled, setTenantCustomPrompt } from "../services/tenants.ts";

const MAX_CUSTOM_PROMPT_LENGTH = 4000;

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/tenants/:accountId/settings", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    return { ai_enabled: tenant.aiEnabled, custom_prompt: tenant.customPrompt, status: tenant.status };
  });

  app.patch("/tenants/:accountId/settings", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const body = request.body as { ai_enabled?: boolean; custom_prompt?: string };
    if (typeof body.ai_enabled === "boolean") {
      await setTenantAiEnabled(tenant.id, body.ai_enabled);
    }
    let customPrompt = tenant.customPrompt;
    if (typeof body.custom_prompt === "string") {
      if (body.custom_prompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
        return reply.code(400).send({ error: "custom_prompt_too_long", max_length: MAX_CUSTOM_PROMPT_LENGTH });
      }
      customPrompt = body.custom_prompt;
      await setTenantCustomPrompt(tenant.id, customPrompt);
    }
    return {
      ok: true,
      ai_enabled: body.ai_enabled ?? tenant.aiEnabled,
      custom_prompt: customPrompt,
    };
  });
}
