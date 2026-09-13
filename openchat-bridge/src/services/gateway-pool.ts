import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { config } from "../config.ts";

/** Numeric GID of the Docker socket's owning group — `--group-add <name>` only resolves
 * names inside the *container's* /etc/group, which won't match the host's docker group. */
function dockerSocketGid(): string {
  try {
    return String(statSync("/var/run/docker.sock").gid);
  } catch {
    return "0";
  }
}

type FleetCreateResult = {
  tenant: string;
  containerName: string;
  port: number;
  token: string;
  url: string;
};

/** Runs `openclaw fleet <args>` inside the fleet-runner image (gateway image + docker CLI),
 * with the Docker socket and OPENCLAW_STATE_DIR bind-mounted at matching host paths so
 * Fleet's own sibling `docker run` calls resolve correctly against the host daemon. */
function runFleetCli(args: string[]): Promise<string> {
  const stateDir = config.openclawStateDir;
  if (!stateDir) {
    return Promise.reject(new Error("OPENCLAW_STATE_DIR is required for GATEWAY_POOL_MODE=fleet"));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "run",
      "--rm",
      "--user",
      `${config.fleetRunnerUid}:${config.fleetRunnerGid}`,
      "--group-add",
      dockerSocketGid(),
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock",
      "-v",
      `${stateDir}:${stateDir}`,
      "-e",
      `OPENCLAW_STATE_DIR=${stateDir}`,
      config.fleetRunnerImage,
      ...args,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`openclaw fleet ${args[0]} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

/** Cell state lives at OPENCLAW_STATE_DIR/fleet/cells/<tenant>/ on the host (mounted into
 * the cell at /home/node/.openclaw) — used to reach a tenant's workspace/config files. */
export function fleetCellStateDir(openclawTenantId: string): string {
  return `${config.openclawStateDir}/fleet/cells/${openclawTenantId}`;
}

export async function provisionGateway(
  accountId: number,
  openclawTenantId: string,
): Promise<{ url: string; token: string }> {
  if (config.gatewayPoolMode !== "fleet") {
    return {
      url: config.openclawGatewayUrl,
      // Shared mode must use the real gateway token — never invent a random one.
      token: config.openclawGatewayToken,
    };
  }
  const stdout = await runFleetCli([
    "fleet",
    "create",
    openclawTenantId,
    "--image",
    config.openclawGatewayImage,
    "--env",
    `OPENCHAT_BRIDGE_INBOUND_URL=${config.bridgePublicUrl}/webhooks/openclaw/inbound`,
    "--json",
  ]);
  const result = JSON.parse(stdout) as FleetCreateResult;
  return { url: result.url, token: result.token };
}

/** No-op outside fleet mode — the shared gateway is never torn down per-tenant. */
export async function teardownGateway(openclawTenantId: string, purgeData: boolean): Promise<void> {
  if (config.gatewayPoolMode !== "fleet") return;
  await runFleetCli([
    "fleet",
    "rm",
    openclawTenantId,
    "--force",
    ...(purgeData ? ["--purge-data"] : []),
  ]);
}
