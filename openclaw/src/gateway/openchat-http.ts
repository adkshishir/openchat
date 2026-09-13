import type { IncomingMessage, ServerResponse } from "node:http";
import { getReplyFromConfig } from "../auto-reply/reply/get-reply.js";
import type { ReplyPayload } from "../auto-reply/reply-payload.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { readJsonBodyOrError, sendJson, sendMethodNotAllowed } from "./http-common.js";
import {
  authorizeScopedGatewayHttpRequestOrReply,
  resolveOpenAiCompatibleHttpOperatorScopes,
} from "./http-utils.js";

const OPENCHAT_AGENT_PATH = "/openchat/agent";

function payloadText(payload: ReplyPayload | ReplyPayload[] | undefined): string {
  if (!payload) {
    return "";
  }
  const items = Array.isArray(payload) ? payload : [payload];
  return items
    .map((item) => item.text ?? item.fallbackText?.text ?? item.spokenText ?? "")
    .filter(Boolean)
    .join("\n");
}

export async function handleOpenChatHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "bad_request" }));
    return true;
  }
  if (!url.pathname.startsWith("/openchat/")) {
    return false;
  }
  if (url.pathname !== OPENCHAT_AGENT_PATH) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return true;
  }
  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }
  const authResult = await authorizeScopedGatewayHttpRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
    operatorMethod: "agent",
    resolveOperatorScopes: resolveOpenAiCompatibleHttpOperatorScopes,
  });
  if (!authResult) {
    return true;
  }
  const bodyUnknown = await readJsonBodyOrError(req, res, 1024 * 1024);
  if (!bodyUnknown) {
    return true;
  }
  const body = bodyUnknown as { sessionKey?: string; message?: string; history?: string };
  const sessionKey = body.sessionKey?.trim() || "openchat:default";
  const message = [body.history, body.message].filter(Boolean).join("\n\n");
  try {
    const reply = await getReplyFromConfig({
      Body: message,
      RawBody: message,
      SessionKey: sessionKey,
      CommandBody: message,
      From: "openchat",
      To: "openchat",
      OriginatingChannel: "webchat",
      InboundAccessAuthorized: true,
    });
    sendJson(res, 200, { text: payloadText(reply), sessionKey });
  } catch (error) {
    sendJson(res, 500, {
      error: "agent_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}
