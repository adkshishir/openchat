import type { FastifyInstance } from "fastify";
import { getTenantByAccountId, setTenantAiEnabled } from "../services/tenants.ts";

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/tenants/:accountId/settings", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    return { ai_enabled: tenant.aiEnabled, status: tenant.status };
  });

  app.patch("/tenants/:accountId/settings", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const body = request.body as { ai_enabled?: boolean };
    if (typeof body.ai_enabled === "boolean") {
      await setTenantAiEnabled(tenant.id, body.ai_enabled);
    }
    return { ok: true, ai_enabled: body.ai_enabled ?? tenant.aiEnabled };
  });
}
