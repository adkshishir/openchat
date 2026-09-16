import crypto from "node:crypto";
import { query } from "../db.ts";
import type { Order, OrderStatus } from "../types.ts";

function mapOrder(row: Record<string, unknown>): Order {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    chatwootConversationId: Number(row.chatwoot_conversation_id),
    productName: String(row.product_name),
    productPrice: row.product_price != null ? String(row.product_price) : null,
    variant: row.variant != null ? String(row.variant) : null,
    customerName: String(row.customer_name),
    customerPhone: String(row.customer_phone),
    customerAddress: String(row.customer_address),
    status: row.status as OrderStatus,
    createdAt: new Date(String(row.created_at)),
  };
}

export async function createOrder(input: {
  tenantId: string;
  chatwootConversationId: number;
  productName: string;
  productPrice?: string | null;
  variant?: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
}): Promise<Order> {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO orders
       (id, tenant_id, chatwoot_conversation_id, product_name, product_price, variant, customer_name, customer_phone, customer_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      id,
      input.tenantId,
      input.chatwootConversationId,
      input.productName,
      input.productPrice ?? null,
      input.variant ?? null,
      input.customerName,
      input.customerPhone,
      input.customerAddress,
    ],
  );
  return mapOrder(rows[0]);
}

export async function listOrders(tenantId: string, limit = 200): Promise<Order[]> {
  const rows = await query("SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2", [
    tenantId,
    limit,
  ]);
  return rows.map(mapOrder);
}

export async function updateOrderStatus(
  tenantId: string,
  orderId: string,
  status: OrderStatus,
): Promise<Order | null> {
  const rows = await query(
    "UPDATE orders SET status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *",
    [tenantId, orderId, status],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
}
