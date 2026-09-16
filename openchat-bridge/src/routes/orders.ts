import type { FastifyInstance } from "fastify";
import { listOrders, updateOrderStatus } from "../services/orders.ts";
import { getTenantByAccountId } from "../services/tenants.ts";
import type { OrderStatus } from "../types.ts";

const VALID_STATUSES = new Set<OrderStatus>(["new", "fulfilled", "cancelled"]);

export async function registerOrderRoutes(app: FastifyInstance) {
  app.get("/tenants/:accountId/orders", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const orders = await listOrders(tenant.id);
    return {
      orders: orders.map((o) => ({
        id: o.id,
        conversation_id: o.chatwootConversationId,
        product_name: o.productName,
        product_price: o.productPrice,
        variant: o.variant,
        customer_name: o.customerName,
        customer_phone: o.customerPhone,
        customer_address: o.customerAddress,
        status: o.status,
        created_at: o.createdAt.toISOString(),
      })),
    };
  });

  app.patch("/tenants/:accountId/orders/:orderId", async (request, reply) => {
    const { accountId, orderId } = request.params as { accountId: string; orderId: string };
    const tenant = await getTenantByAccountId(Number(accountId));
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const body = request.body as { status?: string };
    if (!body.status || !VALID_STATUSES.has(body.status as OrderStatus)) {
      return reply.code(400).send({ error: "invalid_status" });
    }
    const updated = await updateOrderStatus(tenant.id, orderId, body.status as OrderStatus);
    if (!updated) return reply.code(404).send({ error: "order_not_found" });
    return { ok: true, status: updated.status };
  });
}
