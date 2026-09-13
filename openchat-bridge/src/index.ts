import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { migrate } from "./db.ts";
import { attachWhatsAppSetupWebSocket } from "./whatsapp-setup-ws.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
