import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { decryptSecret } from "./crypto.ts";
import { getTenantById } from "./services/tenants.ts";
import { OpenClawGatewayClient } from "./services/openclaw.ts";
import { query } from "./db.ts";

// Tenant UUID, not Chatwoot's sequential account id — this is the one bridge
// surface the browser talks to directly (not proxied through Chatwoot's own
// authenticated API), so a guessable numeric id here would let any tenant probe
// another tenant's WhatsApp setup stream just by incrementing it.
const STREAM_PATH =
  /^\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/channels\/whatsapp\/setup\/stream\/?$/i;

type SetupEvent = {
  type: "hello" | "qr" | "status" | "connected" | "error" | "expired";
  message?: string | null;
  qr_data_url?: string | null;
  inbox_id?: number | null;
  connected?: boolean;
};

function send(ws: WebSocket, event: SetupEvent) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(event));
}

async function inboxIdForTenant(tenantId: string): Promise<number | null> {
  const existing = await query(
    "SELECT chatwoot_inbox_id FROM channel_links WHERE tenant_id = $1 AND channel_type = 'whatsapp' LIMIT 1",
    [tenantId],
  );
  return existing[0] ? Number(existing[0].chatwoot_inbox_id) : null;
}

/**
 * Long-lived WhatsApp QR setup stream.
 * One gateway wait session at a time with long slices so Baileys 515
 * "verifying" handshake can finish without HTTP poll interrupts.
 */
async function runSetupStream(ws: WebSocket, tenantId: string, force: boolean) {
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    send(ws, { type: "error", message: "tenant_not_found" });
    ws.close();
    return;
  }

  const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
  let closed = false;
  ws.on("close", () => {
    closed = true;
  });

  send(ws, {
    type: "hello",
    message: "Connected to OpenChat bridge. Starting WhatsApp QR…",
  });

  try {
    // Per-tenant OpenClaw WhatsApp account slot — "default" for every tenant made a
    // second tenant's QR login fight the first tenant's linked number for the same slot.
    const started = await gateway.startWhatsAppLogin(tenant.openclawTenantId, force);
    if (closed) return;

    if (started.qrDataUrl) {
      send(ws, {
        type: "qr",
        qr_data_url: started.qrDataUrl,
        message: started.message ?? "Scan this QR in WhatsApp → Linked Devices.",
        connected: false,
      });
    } else if (started.connected) {
      const inboxId = await inboxIdForTenant(tenant.id);
      send(ws, {
        type: "connected",
        connected: true,
        message: started.message ?? "WhatsApp is already linked.",
        inbox_id: inboxId,
      });
      return;
    } else {
      send(ws, {
        type: "error",
        message: started.message ?? "No QR received from OpenClaw.",
      });
      return;
    }

    // Keep waiting until linked, expired, or fatal error. Long slices let the
    // phone finish "verifying" (WhatsApp status 515 restart) without resets.
    const deadline = Date.now() + 6 * 60_000;
    let qrRestarts = 0;
    while (!closed && Date.now() < deadline) {
      const waited = await gateway.waitWhatsAppLogin(tenant.openclawTenantId, undefined, {
        timeoutMs: 45_000,
        clientTimeoutMs: 55_000,
      });
      if (closed) return;

      if (waited.connected) {
        const inboxId = await inboxIdForTenant(tenant.id);
        send(ws, {
          type: "connected",
          connected: true,
          message: waited.message ?? "WhatsApp linked.",
          inbox_id: inboxId,
          qr_data_url: null,
        });
        return;
      }

      if (waited.qrDataUrl) {
        send(ws, {
          type: "qr",
          qr_data_url: waited.qrDataUrl,
          message: waited.message ?? "QR refreshed. Scan the latest code.",
          connected: false,
        });
        continue;
      }

      const message = waited.message ?? "Waiting for scan…";
      const is515 =
        /515|restart required|finishing WhatsApp handshake|Still finishing|creds\.json missing after pairing/i.test(
          message,
        );

      if (/expired|new one/i.test(message) && !is515) {
        send(ws, { type: "expired", message });
        return;
      }

      // Baileys 515 after scan is normal ("verifying"). Credentials are mid-save;
      // force=true would clear them and WhatsApp shows "Couldn't link device".
      if (is515) {
        if (gateway.isWhatsAppLinked(tenant.openclawTenantId)) {
          const inboxId = await inboxIdForTenant(tenant.id);
          send(ws, {
            type: "connected",
            connected: true,
            message: "WhatsApp linked.",
            inbox_id: inboxId,
            qr_data_url: null,
          });
          return;
        }
        send(ws, {
          type: "status",
          message: "Phone is verifying — keep both devices open. Do not close this window.",
          connected: false,
        });
        // Resume the same pairing (preserve creds). Never force-logout on 515.
        if (qrRestarts < 3) {
          qrRestarts += 1;
          try {
            const resumed = await gateway.startWhatsAppLogin(tenant.openclawTenantId, false);
            if (closed) return;
            if (resumed.connected || gateway.isWhatsAppLinked(tenant.openclawTenantId)) {
              const inboxId = await inboxIdForTenant(tenant.id);
              send(ws, {
                type: "connected",
                connected: true,
                message: resumed.message ?? "WhatsApp linked.",
                inbox_id: inboxId,
                qr_data_url: null,
              });
              return;
            }
            if (resumed.qrDataUrl) {
              // Only show a new QR if OpenClaw truly started a fresh unpaired session.
              send(ws, {
                type: "qr",
                qr_data_url: resumed.qrDataUrl,
                message: resumed.message ?? "Scan this QR in WhatsApp → Linked Devices.",
                connected: false,
              });
            }
          } catch (err) {
            send(ws, {
              type: "status",
              message: err instanceof Error ? err.message : String(err),
              connected: false,
            });
          }
        }
        continue;
      }

      if (/login failed/i.test(message)) {
        send(ws, { type: "error", message });
        return;
      }

      send(ws, {
        type: "status",
        message,
        connected: false,
      });
    }

    if (!closed) {
      send(ws, {
        type: "expired",
        message: "WhatsApp login timed out. Click Show QR code to try again.",
      });
    }
  } catch (err) {
    if (closed) return;
    send(ws, {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function attachWhatsAppSetupWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head: Buffer) => {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const match = url.pathname.match(STREAM_PATH);
    if (!match) {
      return;
    }

    const tenantId = match[1];
    const force = url.searchParams.get("force") !== "0";

    wss.handleUpgrade(req, socket, head, (ws) => {
      void runSetupStream(ws, tenantId, force);
    });
  });
}
