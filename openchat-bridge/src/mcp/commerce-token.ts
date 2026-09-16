import crypto from "node:crypto";
import { config } from "../config.ts";
import { hmacSha256 } from "../crypto.ts";

/**
 * Layer-B action token for the customer-facing commerce tools (show_product_cards,
 * create_order — mcp/commerce-tools.ts), same pattern and rationale as
 * mcp/admin-token.ts: minted once per customer agent turn (services/agent-reply.ts),
 * embedded into that turn's extraSystemPrompt, and required as the `authToken`
 * argument on every commerce tool call. Every execute() derives tenant, conversation,
 * and channel ONLY from this verified token — never from an LLM-supplied argument —
 * so a customer chatting on their own tenant's WhatsApp/widget can never place an
 * order or trigger a card message against a different tenant's conversation.
 */
const COMMERCE_TOKEN_TTL_MS = 5 * 60 * 1000;

export type CommerceTokenPayload = {
  tenantId: string;
  conversationId: number;
  channelType: string;
};

function sign(payload: string): string {
  return hmacSha256(config.secret, payload);
}

export function mintCommerceToken(input: CommerceTokenPayload): string {
  const expiresAtMs = Date.now() + COMMERCE_TOKEN_TTL_MS;
  const payload = `${input.tenantId}.${input.conversationId}.${input.channelType}.${expiresAtMs}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyCommerceToken(token: unknown): CommerceTokenPayload | null {
  if (typeof token !== "string" || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [tenantId, conversationIdStr, channelType, expiresAtStr, signature] = parts;
  if (!tenantId || !conversationIdStr || !channelType || !expiresAtStr || !signature) return null;
  const conversationId = Number(conversationIdStr);
  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(conversationId) || !Number.isFinite(expiresAtMs)) return null;
  if (Date.now() > expiresAtMs) return null;

  const expected = sign(`${tenantId}.${conversationIdStr}.${channelType}.${expiresAtStr}`);
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;

  return { tenantId, conversationId, channelType };
}
