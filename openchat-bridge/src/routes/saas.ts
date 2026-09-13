import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../crypto.ts";
import { config } from "../config.ts";
import { getTenantByAccountId, recordEvent, setBillingCustomer, setTenantStatus } from "../services/tenants.ts";
import { OpenClawGatewayClient } from "../services/openclaw.ts";
import { listEvents } from "../services/tenants.ts";

export async function registerSaasRoutes(app: FastifyInstance) {
  app.post("/billing/stripe/webhook", async (request, reply) => {
    const event = request.body as {
      type?: string;
      data?: { object?: { customer?: string; metadata?: { chatwoot_account_id?: string } } };
    };
    const accountId = Number(event.data?.object?.metadata?.chatwoot_account_id ?? 0);
    const customerId = event.data?.object?.customer;
    if (!accountId) {
      return { received: true };
    }
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    if (customerId) {
      await setBillingCustomer(tenant.id, customerId);
    }
    if (event.type === "invoice.payment_failed") {
      await setTenantStatus(tenant.id, "past_due");
    }
    if (event.type === "invoice.paid" || event.type === "customer.subscription.created") {
      await setTenantStatus(tenant.id, "active");
    }
    if (event.type === "customer.subscription.deleted") {
      await setTenantStatus(tenant.id, "suspended");
    }
    await recordEvent({ tenantId: tenant.id, kind: "billing.stripe", payload: { type: event.type } });
    return { received: true, mode: config.stripeWebhookSecret ? "signed" : "unsigned" };
  });

  app.post("/tenants/:accountId/models/auth/start", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const body = request.body as { provider?: string };
    const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
    const result = await gateway.startModelAuth(body.provider ?? "openai");
    return result;
  });

  app.get("/observability/events", async (request) => {
    const query = request.query as { limit?: string };
    const events = await listEvents(Number(query.limit ?? 100));
    return { events };
  });
}
