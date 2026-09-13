import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import os from "node:os";

type RpcResult = { ok: boolean; payload?: unknown; error?: { message?: string } };
type LoginResult = { qrDataUrl?: string; connected?: boolean; message?: string };
type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

const OPERATOR_SCOPES = [
  "operator.admin",
  "operator.write",
  "operator.read",
  "operator.approvals",
  "operator.pairing",
] as const;

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Finds every array field inside a config subtree, as dot-paths — mirrors OpenClaw's own
 * gateway-side scan so a full-subtree delete can declare every array it touches upfront. */
function collectArrayPaths(value: unknown, path: string): string[] {
  if (Array.isArray(value)) {
    return [path];
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    paths.push(...collectArrayPaths(child, `${path}.${key}`));
  }
  return paths;
}

/** OpenClaw state dir. Prefer OPENCLAW_STATE_DIR so root/mismatched HOME still finds paired devices. */
function resolveOpenClawStateDir(): string {
  const fromEnv = process.env.OPENCLAW_STATE_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".openclaw");
}

function loadDeviceIdentity(): DeviceIdentity | null {
  const filePath = path.join(resolveOpenClawStateDir(), "identity", "device.json");
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DeviceIdentity> & {
      version?: number;
    };
    if (
      parsed?.version === 1 &&
      typeof parsed.deviceId === "string" &&
      typeof parsed.publicKeyPem === "string" &&
      typeof parsed.privateKeyPem === "string"
    ) {
      return {
        deviceId: parsed.deviceId,
        publicKeyPem: parsed.publicKeyPem,
        privateKeyPem: parsed.privateKeyPem,
      };
    }
  } catch {
    // ignore malformed identity
  }
  return null;
}

/** Paired operator device token — shared gateway tokens alone clear unbound scopes (incl. admin). */
function loadPairedOperatorDeviceToken(deviceId: string): string | null {
  const filePath = path.join(resolveOpenClawStateDir(), "devices", "paired.json");
  try {
    if (!fs.existsSync(filePath)) return null;
    const paired = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      { tokens?: { operator?: { token?: string } } }
    >;
    const token = paired[deviceId]?.tokens?.operator?.token;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  return base64UrlEncode(spki.subarray(spki.length - 32));
}

function extractAssistantText(message: { content?: unknown; text?: string }): string | null {
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text;
  }
  const content = message.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (part && typeof part === "object") {
        const record = part as { type?: string; text?: string };
        if (typeof record.text === "string") parts.push(record.text);
      }
    }
    const joined = parts.join("\n").trim();
    return joined || null;
  }
  return null;
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  platform: string;
  deviceFamily?: string;
}): string {
  const normalize = (value?: string) =>
    typeof value === "string" ? value.trim().toLowerCase() : "";
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalize(params.platform),
    normalize(params.deviceFamily),
  ].join("|");
}

type LoginQrModule = {
  startWebLoginWithQr: (opts?: {
    force?: boolean;
    timeoutMs?: number;
    verbose?: boolean;
    accountId?: string;
  }) => Promise<LoginResult>;
  waitForWebLogin: (opts?: {
    timeoutMs?: number;
    accountId?: string;
    currentQrDataUrl?: string;
  }) => Promise<LoginResult>;
};

let loginQrModulePromise: Promise<LoginQrModule> | null = null;

function resolveOpenClawLoginQrPath(): string | null {
  const candidates = [
    process.env.OPENCLAW_LOGIN_QR_MODULE,
    "/home/shishir/.npm-global/lib/node_modules/openclaw/dist",
    path.join(os.homedir(), ".npm-global/lib/node_modules/openclaw/dist"),
  ].filter(Boolean) as string[];

  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("openclaw/package.json");
    candidates.unshift(path.join(path.dirname(pkgJson), "dist"));
  } catch {
    // openclaw may only be installed globally
  }

  for (const candidate of candidates) {
    if (candidate.endsWith(".js") && fs.existsSync(candidate)) {
      return candidate;
    }
    if (!fs.existsSync(candidate)) continue;
    const match = fs
      .readdirSync(candidate)
      .find((name) => name.startsWith("login-qr-") && name.endsWith(".js"));
    if (match) return path.join(candidate, match);
  }
  return null;
}

async function loadLoginQrModule(): Promise<LoginQrModule | null> {
  if (!loginQrModulePromise) {
    loginQrModulePromise = (async () => {
      const modulePath = resolveOpenClawLoginQrPath();
      if (!modulePath) {
        throw new Error("OpenClaw login-qr module not found");
      }
      return (await import(pathToFileURL(modulePath).href)) as LoginQrModule;
    })().catch((error) => {
      loginQrModulePromise = null;
      throw error;
    });
  }
  try {
    return await loginQrModulePromise;
  } catch {
    return null;
  }
}

export class OpenClawGatewayClient {
  private readonly gatewayUrl: string;
  private readonly token: string;

  constructor(gatewayUrl: string, token: string) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
  }

  private httpBase(): string {
    return this.gatewayUrl.replace(/\/$/, "");
  }

  private wsUrl(): string {
    return this.httpBase().replace(/^http/, "ws");
  }

  private connectParams(nonce: string) {
    const identity = loadDeviceIdentity();
    const deviceToken = identity ? loadPairedOperatorDeviceToken(identity.deviceId) : null;
    // Prefer paired device token: shared gateway tokens alone clear unbound scopes (no operator.admin).
    const token = (deviceToken || this.token)?.trim() || "";
    const auth = token ? { token } : undefined;
    const clientId = "cli";
    const clientMode = "cli";
    const role = "operator";
    const platform = os.platform();
    const scopes = [...OPERATOR_SCOPES];
    let device:
      | {
          id: string;
          publicKey: string;
          signature: string;
          signedAt: number;
          nonce: string;
        }
      | undefined;

    // Device identity keeps write/admin; required for web.login.* / WhatsApp QR via gateway RPC.
    if (identity && nonce) {
      const signedAtMs = Date.now();
      const payload = buildDeviceAuthPayloadV3({
        deviceId: identity.deviceId,
        clientId,
        clientMode,
        role,
        scopes,
        signedAtMs,
        token: token || null,
        nonce,
        platform,
      });
      device = {
        id: identity.deviceId,
        publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
        signature: signDevicePayload(identity.privateKeyPem, payload),
        signedAt: signedAtMs,
        nonce,
      };
    }

    return {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: clientId,
        displayName: "OpenChat Bridge",
        version: "0.1.0",
        platform,
        mode: clientMode,
      },
      role,
      scopes,
      ...(auth ? { auth } : {}),
      ...(device ? { device } : {}),
    };
  }

  private connectAndRequest(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<RpcResult> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl());
      const requestId = `rpc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      let settled = false;
      const finish = (err: Error | null, result?: RpcResult) => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        if (err) reject(err);
        else resolve(result ?? { ok: false });
      };

      ws.on("error", (err) => finish(err));
      ws.on("close", (code, reason) => {
        if (!settled) {
          finish(new Error(`OpenClaw WS closed (${code}): ${String(reason || "no reason")}`));
        }
      });
      ws.on("message", (raw) => {
        let frame: {
          type?: string;
          id?: string;
          ok?: boolean;
          payload?: { nonce?: string } & Record<string, unknown>;
          error?: { message?: string };
          event?: string;
        };
        try {
          frame = JSON.parse(String(raw));
        } catch {
          return;
        }

        // Only connect after challenge (nonce required for device identity signature).
        if (frame.type === "event" && frame.event === "connect.challenge") {
          ws.send(
            JSON.stringify({
              type: "req",
              id: "connect",
              method: "connect",
              params: this.connectParams(String(frame.payload?.nonce ?? "")),
            }),
          );
          return;
        }

        if (frame.type === "res" && frame.id === "connect") {
          if (frame.ok === false) {
            finish(new Error(frame.error?.message ?? "OpenClaw connect failed"));
            return;
          }
          ws.send(JSON.stringify({ type: "req", id: requestId, method, params }));
          return;
        }

        if (frame.type === "res" && frame.id === requestId) {
          finish(null, { ok: frame.ok !== false, payload: frame.payload, error: frame.error });
        }
      });

      setTimeout(() => finish(new Error(`${method} timed out`)), timeoutMs);
    });
  }

  async invokeAgent(input: { sessionKey: string; message: string; history?: string }): Promise<string> {
    const httpResult = await this.invokeAgentHttp(input);
    if (httpResult != null && httpResult.trim()) {
      return httpResult.trim();
    }

    const idempotencyKey = `openchat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const accepted = await this.connectAndRequest(
      "agent",
      {
        sessionKey: input.sessionKey,
        message: input.history ? `${input.history}\n\n${input.message}` : input.message,
        idempotencyKey,
        deliver: false,
      },
      30_000,
    );
    if (!accepted.ok) {
      throw new Error(accepted.error?.message ?? "agent failed");
    }

    const acceptedPayload = (accepted.payload ?? {}) as {
      runId?: string;
      status?: string;
      summary?: string;
      text?: string;
    };
    const immediate = acceptedPayload.summary ?? acceptedPayload.text;
    if (immediate?.trim()) {
      return immediate.trim();
    }

    const runId = acceptedPayload.runId || idempotencyKey;
    if (acceptedPayload.status === "accepted" || acceptedPayload.runId) {
      // Local Ollama models (esp. first load) often need >90s.
      const wait = await this.connectAndRequest(
        "agent.wait",
        { runId, timeoutMs: 180_000 },
        185_000,
      );
      if (!wait.ok) {
        throw new Error(wait.error?.message ?? "agent.wait failed");
      }
      const waitPayload = (wait.payload ?? {}) as { status?: string; error?: string };
      if (waitPayload.status === "error") {
        throw new Error(waitPayload.error ?? "agent run failed");
      }
      if (waitPayload.status === "timeout") {
        throw new Error("agent run timed out");
      }
    }

    const history = await this.connectAndRequest(
      "chat.history",
      { sessionKey: input.sessionKey, limit: 40 },
      30_000,
    );
    if (!history.ok) {
      throw new Error(history.error?.message ?? "chat.history failed");
    }
    const historyPayload = (history.payload ?? {}) as {
      messages?: Array<{ role?: string; content?: unknown; text?: string }>;
    };
    const messages = Array.isArray(historyPayload.messages) ? historyPayload.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (!msg || msg.role !== "assistant") continue;
      const text = extractAssistantText(msg);
      if (text?.trim()) return text.trim();
    }
    return "";
  }

  private async invokeAgentHttp(input: { sessionKey: string; message: string; history?: string }) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const response = await fetch(`${this.httpBase()}/openchat/agent`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { text?: string };
      const text = body.text?.trim() ?? "";
      return text || null;
    } catch {
      return null;
    }
  }

  async rpc(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<RpcResult> {
    return this.connectAndRequest(method, params, timeoutMs);
  }

  async sendWhatsApp(to: string, text: string, accountId?: string) {
    return this.sendMessage("whatsapp", to, text, accountId);
  }

  /** Generic channel send — same "send" RPC WhatsApp uses, for any OpenClaw channel. */
  async sendMessage(channel: string, to: string, text: string, accountId?: string) {
    const rpc = await this.rpc("send", {
      channel,
      to,
      message: text,
      idempotencyKey: `openchat-${channel}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      ...(accountId ? { accountId } : {}),
    });
    if (!rpc.ok) {
      throw new Error(rpc.error?.message ?? `${channel} send failed`);
    }
    return rpc;
  }

  /**
   * Historically this asserted a legacy `identity/device.json` existed before any
   * admin RPC, on the theory that operator.admin required a paired device. OpenClaw
   * migrated device identity into its SQLite state store and those legacy JSON files
   * are never written anymore, so the assertion always failed here. It's not needed:
   * this client connects over loopback (same host/network namespace as the gateway)
   * as client id/mode "cli" with the shared gateway token and no `device` block, which
   * the gateway's connect-locality handling (shared-secret loopback CLI client) grants
   * its requested scopes as-is, including operator.admin — see
   * shouldPreserveLocalCliSharedAuthScopes in openclaw's handshake-auth-helpers.ts.
   */

  /**
   * Prefer gateway RPC for WhatsApp QR. In-process login-qr fights the native
   * gateway over the same auth dir and often times out waiting for a QR.
   */
  async startWhatsAppLogin(accountId?: string, force = false) {
    // Keep under Chatwoot's WhatsApp rack timeout (60s) with headroom.
    const timeoutMs = 45_000;

    if (force) {
      // Clean logout via gateway so the channel listener releases the session
      // before Baileys asks for a fresh QR (avoids "Timed out waiting for WhatsApp QR").
      const logout = await this.rpc("channels.logout", {
        channel: "whatsapp",
        ...(accountId ? { accountId } : {}),
      });
      if (!logout.ok) {
        // Continue — web.login.start(force) also stops the channel; logout helps when creds are sticky.
        console.warn("[openchat-bridge] channels.logout before QR failed:", logout.error?.message);
      }
    }

    // Older gateways reject unknown `channel`; omit it for WhatsApp (legacy default).
    const rpc = await this.rpc("web.login.start", {
      ...(accountId ? { accountId } : {}),
      force,
      timeoutMs,
    });
    if (!rpc.ok) {
      throw new Error(rpc.error?.message ?? "web.login.start failed");
    }
    const payload = (rpc.payload ?? {}) as LoginResult;
    if (payload.qrDataUrl || payload.connected) {
      return payload;
    }

    // Fallback only when gateway returned no QR (plugin missing / offline).
    const loginQr = await loadLoginQrModule();
    if (!loginQr) {
      return payload;
    }
    const result = await loginQr.startWebLoginWithQr({
      force,
      timeoutMs,
      accountId,
    });
    return {
      qrDataUrl: result.qrDataUrl,
      connected: Boolean(result.connected),
      message: result.message ?? payload.message,
    };
  }

  isWhatsAppLinked(accountId = "default"): boolean {
    const authDir = path.join(resolveOpenClawStateDir(), "credentials", "whatsapp", accountId);
    return fs.existsSync(path.join(authDir, "creds.json"));
  }

  async waitWhatsAppLogin(
    accountId?: string,
    currentQrDataUrl?: string,
    opts?: { timeoutMs?: number; clientTimeoutMs?: number },
  ) {
    // Short default for legacy HTTP poll; socket stream passes long slices so
    // WhatsApp's post-scan "verifying" (515) handshake can finish.
    const timeoutMs = opts?.timeoutMs ?? 2_500;
    const clientTimeoutMs = opts?.clientTimeoutMs ?? Math.max(timeoutMs + 3_500, 6_000);

    try {
      // OpenClaw 2026.3.13 rejects currentQrDataUrl (INVALID_REQUEST). QR refresh is
      // handled via lastQrByAccount on the bridge; do not send it on the RPC.
      const rpc = await this.rpc(
        "web.login.wait",
        {
          ...(accountId ? { accountId } : {}),
          timeoutMs,
        },
        clientTimeoutMs,
      );
      if (rpc.ok) {
        return (rpc.payload ?? {}) as LoginResult;
      }

      const errMsg = rpc.error?.message ?? "web.login.wait failed";
      // Never fall back to in-process login-qr on schema/param errors — that fights
      // the native gateway over the same auth dir and hangs until ReadTimeout.
      if (/invalid|unexpected property|unknown/i.test(errMsg)) {
        return {
          connected: false,
          message: errMsg,
          qrDataUrl: currentQrDataUrl,
        };
      }

      const loginQr = await loadLoginQrModule();
      if (loginQr) {
        const result = await loginQr.waitForWebLogin({
          timeoutMs,
          accountId,
          currentQrDataUrl,
        });
        return {
          qrDataUrl: result.qrDataUrl,
          connected: Boolean(result.connected),
          message: result.message,
        };
      }
      throw new Error(errMsg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/timed out/i.test(message)) {
        return {
          connected: false,
          message: "Still finishing WhatsApp handshake… keep both devices open.",
          qrDataUrl: currentQrDataUrl,
        };
      }
      throw err;
    }
  }

  async startModelAuth(provider: string) {
    return this.rpc("users.authConnect.start", { provider });
  }

  /** Read OpenClaw config snapshot (includes optimistic-concurrency hash). */
  async configGet() {
    const rpc = await this.rpc("config.get", {}, 15_000);
    if (!rpc.ok) {
      throw new Error(rpc.error?.message ?? "config.get failed");
    }
    return (rpc.payload ?? {}) as {
      hash?: string;
      raw?: string;
      exists?: boolean;
    };
  }

  /**
   * Merge-patch OpenClaw config (JSON object serialized as raw string).
   * OpenClaw requires baseHash from config.get when a config file already exists.
   */
  async configPatch(patch: Record<string, unknown>, replacePaths?: string[]) {
    const raw = JSON.stringify(patch);
    const attempt = async () => {
      const snapshot = await this.configGet();
      const baseHash =
        typeof snapshot.hash === "string" && snapshot.hash.trim()
          ? snapshot.hash.trim()
          : undefined;
      if (snapshot.exists !== false && !baseHash) {
        throw new Error("config base hash unavailable; re-run config.get and retry");
      }
      return this.rpc(
        "config.patch",
        {
          raw,
          ...(baseHash ? { baseHash } : {}),
          ...(replacePaths?.length ? { replacePaths } : {}),
        },
        30_000,
      );
    };

    let rpc = await attempt();
    // One retry on concurrent config writers.
    if (
      !rpc.ok &&
      /config changed since last load|base hash required|base hash unavailable/i.test(
        rpc.error?.message ?? "",
      )
    ) {
      rpc = await attempt();
    }
    if (!rpc.ok) {
      throw new Error(rpc.error?.message ?? "config.patch failed");
    }
    return rpc.payload;
  }

  /**
   * Fully remove a channel from OpenClaw: stop its running listener, clear any
   * logged-in session, and delete its config so it doesn't restart on reload.
   * Best-effort at each step — a channel that's already stopped/logged-out
   * must not block config removal (which is what actually makes it "gone").
   */
  async disconnectChannel(channel: string, accountId?: string) {
    const params = { channel, ...(accountId ? { accountId } : {}) };
    try {
      await this.rpc("channels.stop", params);
    } catch {
      // Channel may already be stopped.
    }
    try {
      await this.rpc("channels.logout", params);
    } catch {
      // Channel may not have a logged-in session (token-auth channels).
    }
    // Deleting a whole channel subtree drops any array fields inside it (e.g.
    // allowFrom) — config.patch requires each exact array path to be listed
    // in replacePaths before it allows that.
    const snapshot = await this.configGet();
    let replacePaths: string[] = [`channels.${channel}`];
    try {
      const current = snapshot.raw ? (JSON.parse(snapshot.raw) as Record<string, unknown>) : {};
      const channelConfig = (current.channels as Record<string, unknown> | undefined)?.[channel];
      replacePaths = [`channels.${channel}`, ...collectArrayPaths(channelConfig, `channels.${channel}`)];
    } catch {
      // Fall back to just the top-level path if the config can't be parsed.
    }
    await this.configPatch({ channels: { [channel]: null } }, replacePaths);
  }

  async startChannel(channel: string, accountId?: string) {
    const rpc = await this.rpc(
      "channels.start",
      { channel, ...(accountId ? { accountId } : {}) },
      60_000,
    );
    if (!rpc.ok) {
      throw new Error(rpc.error?.message ?? "channels.start failed");
    }
    return rpc.payload as Record<string, unknown>;
  }

  async channelStatus(channel?: string) {
    const rpc = await this.rpc(
      "channels.status",
      { ...(channel ? { channel } : {}), probe: true, timeoutMs: 8_000 },
      15_000,
    );
    if (!rpc.ok) {
      throw new Error(rpc.error?.message ?? "channels.status failed");
    }
    return rpc.payload as Record<string, unknown>;
  }

  /**
   * Write channel config into the shared gateway and start the channel monitor.
   */
  async connectTokenChannel(channelId: string, channelConfig: Record<string, unknown>) {
    await this.configPatch({
      channels: {
        [channelId]: channelConfig,
      },
      // External channel plugins (Discord, Slack, ...) stay disconnected until explicitly
      // trusted — writing channels.<id> alone leaves the gateway logging "external plugin
      // is installed without explicit trust" and never actually connecting.
      plugins: {
        entries: {
          [channelId]: { enabled: true },
        },
      },
    });
    // Give hot-reload a moment before start (some channels need config applied).
    await new Promise((r) => setTimeout(r, 750));
    try {
      const started = await this.startChannel(channelId);
      return { ok: true as const, started };
    } catch (err) {
      // Config may already auto-start the channel on reload.
      return {
        ok: true as const,
        started: null,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
