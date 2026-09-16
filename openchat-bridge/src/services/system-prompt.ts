import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

/**
 * Platform-wide instructions applied to every tenant's agent turn, on top of
 * that tenant's own custom_prompt/knowledge base. Lives at the OpenClaw global
 * root (not inside any tenant/agent workspace) so it stays out of reach of the
 * per-tenant training UI/API — only the platform operator edits this file directly.
 */
function systemPromptFile(): string {
  const root = config.openclawStateDir?.trim() || path.join(process.env.HOME || "/home/shishir", ".openclaw");
  return path.join(root, "SYSTEM.md");
}

export function getSystemPrompt(): string {
  try {
    return fs.readFileSync(systemPromptFile(), "utf8").trim();
  } catch {
    return "";
  }
}
