import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { decryptSecret } from "../crypto.ts";
import { getTenantByAccountId } from "../services/tenants.ts";
import { fleetCellStateDir } from "../services/gateway-pool.ts";
import { OpenClawGatewayClient } from "../services/openclaw.ts";
import type { Tenant } from "../types.ts";

const TRAINABLE_FILES = new Set([
  "SOUL.md",
  "IDENTITY.md",
  "AGENTS.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
]);

/** In fleet mode each tenant's workspace/config lives under its own cell's state dir —
 * falling back to the bridge-global root would read/write the wrong tenant's files. */
function stateRoot(tenant: Tenant | null): string {
  if (config.gatewayPoolMode === "fleet" && tenant) {
    return fleetCellStateDir(tenant.openclawTenantId);
  }
  return config.openclawStateDir?.trim() || path.join(process.env.HOME || "/home/shishir", ".openclaw");
}

function workspaceDir(tenant: Tenant | null): string {
  return path.join(stateRoot(tenant), "workspace");
}

function resolveTrainFile(tenant: Tenant | null, name: string): string | null {
  const base = path.basename(String(name || ""));
  if (!TRAINABLE_FILES.has(base)) return null;
  const dir = workspaceDir(tenant);
  const full = path.join(dir, base);
  if (!full.startsWith(dir)) return null;
  return full;
}

async function probe(url: string, timeoutMs = 2500): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* plain text */
    }
    // /readyz may return non-2xx when channels are failing — still useful JSON.
    const useful = res.ok || (typeof body === "object" && body !== null);
    return { ok: useful, status: res.status, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function readDiscordHints(tenant: Tenant | null): Record<string, unknown> {
  try {
    const cfgPath = path.join(stateRoot(tenant), "openclaw.json");
    const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as {
      channels?: { discord?: Record<string, unknown> };
      agents?: { defaults?: { model?: unknown } };
    };
    const d = raw.channels?.discord || {};
    const guilds = d.guilds && typeof d.guilds === "object" ? Object.keys(d.guilds as object) : [];
    return {
      enabled: Boolean(d.enabled),
      hasToken: Boolean(d.token),
      dmPolicy: d.dmPolicy ?? null,
      groupPolicy: d.groupPolicy ?? null,
      guildCount: guilds.length,
      guildIds: guilds,
      model: raw.agents?.defaults?.model ?? null,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function registerOpenClawAgentRoutes(app: FastifyInstance) {
  app.get("/tenants/:accountId/openclaw/status", async (request) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    const gatewayBase = (tenant?.gatewayUrl || config.openclawGatewayUrl).replace(/\/$/, "");

    const [live, ready, bridge] = await Promise.all([
      probe(`${gatewayBase}/healthz`),
      probe(`${gatewayBase}/readyz`),
      probe(`http://127.0.0.1:${config.port}/health`),
    ]);

    let channels: unknown = null;
    let channelsError: string | null = null;
    if (tenant) {
      try {
        const gateway = new OpenClawGatewayClient(
          tenant.gatewayUrl,
          decryptSecret(tenant.gatewayTokenEnc),
        );
        channels = await gateway.channelStatus();
      } catch (err) {
        channelsError = err instanceof Error ? err.message : String(err);
      }
    }

    const discord = readDiscordHints(tenant);
    const workspace = workspaceDir(tenant);
    const files = [...TRAINABLE_FILES].map((name) => {
      const full = path.join(workspace, name);
      const exists = fs.existsSync(full);
      let bytes = 0;
      let updatedAt: string | null = null;
      if (exists) {
        const st = fs.statSync(full);
        bytes = st.size;
        updatedAt = st.mtime.toISOString();
      }
      return { name, exists, bytes, updatedAt };
    });

    const gatewayOk = Boolean(live.ok);
    const readyBody = (ready.body || {}) as { ready?: boolean; failing?: string[] };
    const issues: string[] = [];
    if (!gatewayOk) issues.push("OpenClaw gateway is not reachable on :18789");
    if (ready.ok && readyBody.ready === false) {
      issues.push(`Gateway not fully ready (failing: ${(readyBody.failing || []).join(", ") || "unknown"})`);
    }
    if (!bridge.ok) issues.push("OpenChat bridge health check failed");
    if (discord.enabled && discord.hasToken === false) issues.push("Discord enabled but token missing");
    if (discord.enabled && discord.groupPolicy === "allowlist" && Number(discord.guildCount) === 0) {
      issues.push("Discord server messages blocked: no guilds allowlisted");
    }

    // Surface Discord 4014 / intent issues from channel status when present.
    const channelText = JSON.stringify(channels || channelsError || "");
    if (/4014|Message Content Intent|privileged gateway intents/i.test(channelText)) {
      issues.push("Discord needs Message Content Intent in the Discord Developer Portal");
    }

    return {
      ok: gatewayOk && bridge.ok && issues.length === 0,
      checkedAt: new Date().toISOString(),
      gateway: {
        url: gatewayBase,
        live: live.ok,
        liveBody: live.body ?? null,
        ready: ready.ok ? readyBody : { ok: false, error: ready.error },
      },
      bridge: { ok: bridge.ok, body: bridge.body ?? null, error: bridge.error ?? null },
      tenant: tenant
        ? { id: tenant.id, chatwootAccountId: tenant.chatwootAccountId, aiEnabled: tenant.aiEnabled }
        : null,
      discord,
      channels,
      channelsError,
      workspace: { dir: workspace, files },
      issues,
      controlUi: gatewayBase.replace(/\/$/, "") + "/",
    };
  });

  app.get("/tenants/:accountId/openclaw/workspace", async (request) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    const dir = workspaceDir(tenant);
    const files = [...TRAINABLE_FILES].map((name) => {
      const full = path.join(dir, name);
      const exists = fs.existsSync(full);
      return {
        name,
        exists,
        content: exists ? fs.readFileSync(full, "utf8") : "",
        updatedAt: exists ? fs.statSync(full).mtime.toISOString() : null,
      };
    });
    return { dir, files };
  });

  app.get("/tenants/:accountId/openclaw/workspace/:file", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    const fileName = (request.params as { file: string }).file;
    const full = resolveTrainFile(tenant, fileName);
    if (!full) return reply.code(400).send({ error: "file_not_allowed" });
    if (!fs.existsSync(full)) return reply.code(404).send({ error: "not_found", name: path.basename(full) });
    return {
      name: path.basename(full),
      content: fs.readFileSync(full, "utf8"),
      updatedAt: fs.statSync(full).mtime.toISOString(),
    };
  });

  app.put("/tenants/:accountId/openclaw/workspace/:file", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    const fileName = (request.params as { file: string }).file;
    const full = resolveTrainFile(tenant, fileName);
    if (!full) return reply.code(400).send({ error: "file_not_allowed" });
    const body = request.body as { content?: string };
    if (typeof body.content !== "string") {
      return reply.code(400).send({ error: "content_required" });
    }
    if (body.content.length > 200_000) {
      return reply.code(400).send({ error: "content_too_large" });
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body.content, "utf8");
    return {
      ok: true,
      name: path.basename(full),
      bytes: Buffer.byteLength(body.content, "utf8"),
      updatedAt: fs.statSync(full).mtime.toISOString(),
    };
  });
}
