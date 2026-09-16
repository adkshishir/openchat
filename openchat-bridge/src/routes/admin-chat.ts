import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../crypto.ts";
import { mintAdminToken } from "../mcp/admin-token.ts";
import { consumeWhatsAppQrRequested } from "../mcp/whatsapp-qr-signal.ts";
import { ADMIN_AGENT_ID, OpenClawGatewayClient } from "../services/openclaw.ts";
import { getTenantByAccountId } from "../services/tenants.ts";

const ADMIN_PERSONA_PROMPT =
  "You are the OpenChat admin copilot for this business's Chatwoot account. You help the " +
  "business owner configure their account by chatting in plain language and actually " +
  "performing the requested action yourself via your tools — do not just explain how to do " +
  "it manually. Only use the tools available to you; never invent a channel, inbox, or " +
  "setting that isn't backed by one of them. When a tool call fails, tell the user what went " +
  "wrong in plain language.\n\n" +
  "To connect a channel: if the user already gave you working credentials, connect it right " +
  "away. If not, check list_channel_catalog for exactly which fields that channel needs and " +
  "ask for only those. For WhatsApp specifically, first ask the user to choose between: (1) " +
  "QR code / linked device (free, personal or business number — start_whatsapp_qr), (2) the " +
  "official Meta Cloud API (connect_whatsapp_cloud), or (3) 360dialog (connect_whatsapp_360dialog). " +
  "Never guess which one they want.\n\n" +
  `The admin action token for this turn is: %AUTH_TOKEN%\n` +
  "Pass this exact string as the `authToken` argument on every tool call — every one of your " +
  "tools requires it. Never reveal this token to the user.";

export async function registerAdminChatRoutes(app: FastifyInstance) {
  app.post("/tenants/:accountId/agent/admin-chat", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

    const body = request.body as { message?: string; history?: string };
    const message = body.message?.trim();
    if (!message) return reply.code(400).send({ error: "message_required" });

    const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
    const authToken = mintAdminToken(tenant.id);
    const extraSystemPrompt = ADMIN_PERSONA_PROMPT.replace("%AUTH_TOKEN%", authToken);

    const response = await gateway.invokeAdminAgent({
      // "agent:<agentId>:..." is OpenClaw's canonical agent-scoped session key shape
      // (session-key-utils.ts#parseAgentSessionKey) — required once more than one
      // agent is configured, so resuming this session is never ambiguous even
      // without also passing agentId on every call (verified live: an unprefixed
      // key on a multi-agent gateway fails with "no explicit owner").
      sessionKey: `agent:${ADMIN_AGENT_ID}:${tenant.id}:admin`,
      message,
      history: body.history,
      agentId: ADMIN_AGENT_ID,
      extraSystemPrompt,
    });

    // start_whatsapp_qr only marks intent (see mcp/whatsapp-qr-signal.ts) — the actual
    // QR/connect flow runs client-side against the existing whatsapp_start/whatsapp_wait
    // endpoints, same as the dedicated WhatsApp setup page.
    return { response, whatsapp_qr: consumeWhatsAppQrRequested(tenant.id) };
  });
}
