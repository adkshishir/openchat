import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { migrate } from "./db.ts";
import { decryptSecret } from "./crypto.ts";
import { OpenClawGatewayClient } from "./services/openclaw.ts";
import { listActiveTenants } from "./services/tenants.ts";
import { attachWhatsAppSetupWebSocket } from "./whatsapp-setup-ws.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * WhatsApp accounts default to OpenClaw's dmPolicy:"pairing" (only the number that
 * scanned the QR gets replies) until OpenClawGatewayClient#openWhatsAppDmPolicy patches
 * them open — but that patch only fires from the interactive QR-login RPC path. A bridge
 * or gateway restart with WhatsApp already linked never re-runs that path, so already-linked
 * tenants would silently sit on dmPolicy:"pairing" until someone reopens the setup UI.
 * Re-open it for every already-linked tenant once per boot instead.
 */
async function reconcileWhatsAppDmPolicies(): Promise<void> {
  const tenants = await listActiveTenants();
  let reconciled = 0;
  for (const tenant of tenants) {
    try {
      const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
      if (gateway.isWhatsAppLinked(tenant.openclawTenantId)) {
        await gateway.openWhatsAppDmPolicy(tenant.openclawTenantId);
        reconciled += 1;
      }
    } catch (error) {
      console.warn(
        `[openchat-bridge] WhatsApp dmPolicy reconciliation failed for tenant ${tenant.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  console.log(`[openchat-bridge] WhatsApp dmPolicy reconciliation done: ${reconciled}/${tenants.length} tenant(s).`);
}

if (config.openclawStateDir) {
  process.env.OPENCLAW_STATE_DIR = config.openclawStateDir;
}

const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
const identityPath = path.join(stateDir, "identity", "device.json");
if (!fs.existsSync(identityPath)) {
  console.warn(
    `[openchat-bridge] OpenClaw device identity not found at ${identityPath}. ` +
      "WhatsApp QR via gateway will fail with missing scope: operator.admin. " +
      "Set OPENCLAW_STATE_DIR and run as the user that paired the gateway (not root).",
  );
}
if (typeof process.getuid === "function" && process.getuid() === 0) {
  console.warn(
    "[openchat-bridge] Running as root. Prefer the same non-root user as openclaw-gateway so device pairing and WhatsApp creds resolve correctly.",
  );
}

const app = await buildApp();
await migrate();
await app.listen({ port: config.port, host: "0.0.0.0" });
attachWhatsAppSetupWebSocket(app.server);
app.log.info(`openchat-bridge listening on ${config.port} (WhatsApp setup WebSocket enabled)`);

reconcileWhatsAppDmPolicies().catch((error) => {
  console.warn("[openchat-bridge] WhatsApp dmPolicy reconciliation pass failed:", error instanceof Error ? error.message : error);
});
