/**
 * Bridges the "start_whatsapp_qr" admin tool call (mcp/admin-tools.ts) to the
 * admin-chat HTTP response (routes/admin-chat.ts). invokeAdminAgent only returns
 * the model's final text — a tool's own structured result never reaches this
 * HTTP layer — so this is a small explicit side channel: the tool marks intent,
 * the route consumes it once and folds it into the JSON response so the copilot
 * chat UI knows to render the live QR flow (it drives the actual QR/connect
 * polling itself via the existing whatsapp_start/whatsapp_wait endpoints; no QR
 * image data flows through the model at all).
 */
const requested = new Set<string>();

export function markWhatsAppQrRequested(tenantId: string): void {
  requested.add(tenantId);
}

export function consumeWhatsAppQrRequested(tenantId: string): boolean {
  return requested.delete(tenantId);
}
