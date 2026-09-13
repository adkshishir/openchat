import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { encryptSecret, decryptSecret } from "../crypto.ts";
import { provisionGateway } from "../services/gateway-pool.ts";
import {
  createTenant,
  getTenantByAccountId,
  openclawTenantIdFor,
  recordEvent,
  setTenantStatus,
  upsertAgentBot,
  upsertChannelLink,
} from "../services/tenants.ts";

export async function registerProvisionRoutes(app: FastifyInstance) {
  app.post("/provision", async (request, reply) => {
    const body = request.body as {
      chatwoot_account_id?: number;
      admin_user_id?: number;
      agent_bot_id?: number;
      agent_bot_access_token?: string;
      agent_bot_secret?: string;
      website_url?: string;
    };
    const headerSecret = String(request.headers["x-openchat-provision-secret"] ?? "");
    if (headerSecret !== config.provisionSharedSecret) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (!body.chatwoot_account_id || !body.agent_bot_id || !body.agent_bot_access_token) {
      return reply.code(400).send({ error: "missing_fields" });
    }
    const gateway = await provisionGateway(
      body.chatwoot_account_id,
      openclawTenantIdFor(body.chatwoot_account_id),
    );
    const tenant = await createTenant({
      chatwootAccountId: body.chatwoot_account_id,
      gatewayUrl: gateway.url,
      gatewayTokenEnc: encryptSecret(gateway.token),
    });
    await upsertAgentBot({
      tenantId: tenant.id,
      chatwootAgentBotId: body.agent_bot_id,
      accessTokenEnc: encryptSecret(body.agent_bot_access_token),
      secretEnc: encryptSecret(body.agent_bot_secret ?? ""),
    });
    await setTenantStatus(tenant.id, "active");
    await recordEvent({
      tenantId: tenant.id,
      kind: "tenant.provisioned",
      payload: { chatwootAccountId: body.chatwoot_account_id, adminUserId: body.admin_user_id ?? null },
    });
    return {
      tenant_id: tenant.id,
      gateway_url: gateway.url,
      webhook_url: `${config.bridgePublicUrl}/webhooks/chatwoot/${body.chatwoot_account_id}`,
    };
  });

  app.post("/tenants/:accountId/channels/web_widget", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const body = request.body as { inbox_id?: number };
    if (!body.inbox_id) return reply.code(400).send({ error: "inbox_id_required" });
    const link = await upsertChannelLink({
      tenantId: tenant.id,
      channelType: "web_widget",
      chatwootInboxId: body.inbox_id,
    });
    return { channel_link_id: link.id };
  });

  app.get("/tenants/:accountId", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    return {
      tenant_id: tenant.id,
      status: tenant.status,
      ai_enabled: tenant.aiEnabled,
      gateway_url: tenant.gatewayUrl,
    };
  });
}
