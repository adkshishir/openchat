import crypto from "node:crypto";
import { config } from "../config.ts";
import { hmacSha256 } from "../crypto.ts";

/**
 * Layer-B admin action tokens (see plan doc "Two independent authorization layers").
 * Minted once per admin-chat HTTP turn (`routes/admin-chat.ts`), embedded into that
 * turn's `extraSystemPrompt`, and required as the `authToken` argument on every
 * openchat-admin MCP tool call (`mcp/admin-tools.ts` / `mcp/server.ts`). This is a
 * config-independent backstop: even if OpenClaw's per-agent tool-profile scoping
 * (Layer A) is ever misapplied, a tool call without a valid token still fails closed.
 *
 * Deliberately NOT bound to any MCP transport/connection/session — the actual session
 * lifecycle behavior of OpenClaw's MCP client is unverified, so this uses a simpler,
 * equally-strong mechanism: a short-lived signed grant carried as a tool argument.
 */
const ADMIN_TOKEN_TTL_MS = 5 * 60 * 1000;

function sign(payload: string): string {
  return hmacSha256(config.secret, payload);
}

export function mintAdminToken(tenantId: string): string {
  const expiresAtMs = Date.now() + ADMIN_TOKEN_TTL_MS;
  const payload = `${tenantId}.${expiresAtMs}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: unknown): { tenantId: string } | null {
  if (typeof token !== "string" || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [tenantId, expiresAtStr, signature] = parts;
  if (!tenantId || !expiresAtStr || !signature) return null;
  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs)) return null;
  if (Date.now() > expiresAtMs) return null;

  const expected = sign(`${tenantId}.${expiresAtStr}`);
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;

  return { tenantId };
}
