import { z } from "zod";
import { config } from "../config.ts";
import { decryptSecret } from "../crypto.ts";
import { query } from "../db.ts";
import { getChannelDef, listChannelCatalogPublic } from "../services/channel-catalog.ts";
import { OpenClawGatewayClient } from "../services/openclaw.ts";
import { upsertChannelLink } from "../services/tenants.ts";
import type { Tenant } from "../types.ts";
import { markWhatsAppQrRequested } from "./whatsapp-qr-signal.ts";

/**
 * Declarative registry of tools exposed to the "openchat-admin" OpenClaw agent
 * (mounted via mcp/server.ts). Mirrors the shape of services/channel-catalog.ts.
 *
 * Every execute() derives which tenant to act on ONLY from ctx.tenant (resolved
 * server-side from a verified admin action token) — never from any LLM-supplied
 * argument. See the same discipline in services/agent-reply.ts's
 * resolveWhatsAppDestination.
 */

/** Internal Chatwoot endpoint shared by every tool that needs Chatwoot's own
 * ActiveRecord side (inbox creation, native channel setup) — the bridge process
 * has no Chatwoot session, so these go through a shared-secret M2M controller
 * instead of the account-scoped API a browser would use. */
async function postInternalTool(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${config.chatwootBaseUrl}/api/v1/internal/openchat_tools/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Openchat-Bridge-Secret": config.chatwootInternalSecret },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // leave as raw text
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && ("error" in (data as object) || "message" in (data as object))
        ? String((data as Record<string, unknown>).error ?? (data as Record<string, unknown>).message)
        : `Chatwoot returned HTTP ${res.status}.`;
    throw new Error(message);
  }
  return data;
}

export type AdminToolContext = {
  tenant: Tenant;
  adminActionToken: string;
};

export type AdminToolResult = { ok: boolean; message: string; data?: unknown };

export type AdminToolDef = {
  id: string;
  description: string;
  /** Full zod object schema, including the required authToken field. */
  inputSchema: z.ZodTypeAny;
  execute: (input: any, ctx: AdminToolContext) => Promise<AdminToolResult>;
};

const authTokenField = {
  authToken: z
    .string()
    .describe(
      "The admin action token given to you in your system prompt for this session. Required on every call.",
    ),
};

/** Mirrors GET /tenants/:accountId/channels in routes/openclaw-channels.ts. */
async function linkedChannelsAndGatewayStatus(tenant: Tenant) {
  const links = await query(
    "SELECT channel_type, chatwoot_inbox_id, openclaw_account_id, metadata FROM channel_links WHERE tenant_id = $1",
    [tenant.id],
  );

  let gatewayStatus: Record<string, unknown> | null = null;
  try {
    const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
    gatewayStatus = await gateway.channelStatus();
  } catch (err) {
    gatewayStatus = { error: err instanceof Error ? err.message : String(err) };
  }

  return {
    linked: links.map((row) => ({
      channel_type: row.channel_type,
      inbox_id: Number(row.chatwoot_inbox_id),
      openclaw_account_id: row.openclaw_account_id,
      metadata: row.metadata,
    })),
    gateway_status: gatewayStatus,
  };
}

export const ADMIN_TOOLS: AdminToolDef[] = [
  {
    id: "list_channel_catalog",
    description:
      "List every channel type OpenChat/OpenClaw supports (WhatsApp, Telegram, Discord, web widget, ...), " +
      "plus which of them this business already has connected and their live gateway status.",
    inputSchema: z.object(authTokenField),
    execute: async (_input, ctx) => {
      const catalog = listChannelCatalogPublic();
      const { linked, gateway_status } = await linkedChannelsAndGatewayStatus(ctx.tenant);
      return {
        ok: true,
        message: `This business has ${linked.length} connected channel(s) out of ${catalog.length} supported channel types.`,
        data: { catalog, linked, gateway_status },
      };
    },
  },
  {
    id: "get_ai_settings",
    description:
      "Get this business's current AI auto-reply settings: whether it's enabled, its custom instructions, and tenant status.",
    inputSchema: z.object(authTokenField),
    execute: async (_input, ctx) => {
      const { tenant } = ctx;
      return {
        ok: true,
        message: `AI auto-reply is currently ${tenant.aiEnabled ? "enabled" : "disabled"} for this business.`,
        data: { ai_enabled: tenant.aiEnabled, custom_prompt: tenant.customPrompt, status: tenant.status },
      };
    },
  },
  {
    id: "get_openclaw_status",
    description: "Get the live status of this business's OpenClaw agent gateway and its connected channels.",
    inputSchema: z.object(authTokenField),
    execute: async (_input, ctx) => {
      const { tenant } = ctx;
      try {
        const gateway = new OpenClawGatewayClient(tenant.gatewayUrl, decryptSecret(tenant.gatewayTokenEnc));
        const channels = await gateway.channelStatus();
        return {
          ok: true,
          message: "Fetched live OpenClaw gateway status.",
          data: { gateway_url: tenant.gatewayUrl, channels },
        };
      } catch (err) {
        return {
          ok: false,
          message: `Could not reach the OpenClaw gateway: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
  {
    id: "create_web_widget",
    description:
      "Create a new Chatwoot web-widget (website live chat) inbox for this business and wire it up to the AI agent. " +
      "Executes immediately — there is no separate confirmation step.",
    inputSchema: z.object({
      ...authTokenField,
      website_url: z.string().describe("The business's website URL this widget will be embedded on."),
      widget_color: z.string().optional().describe("Hex color for the widget launcher, e.g. #1f93ff."),
      welcome_title: z.string().optional().describe("Widget welcome heading."),
      welcome_tagline: z.string().optional().describe("Widget welcome subtext."),
      name: z.string().optional().describe("Display name for the new Chatwoot inbox."),
    }),
    execute: async (input, ctx) => {
      const body: Record<string, unknown> = {
        account_id: ctx.tenant.chatwootAccountId,
        website_url: input.website_url,
      };
      if (input.widget_color) body.widget_color = input.widget_color;
      if (input.welcome_title) body.welcome_title = input.welcome_title;
      if (input.welcome_tagline) body.welcome_tagline = input.welcome_tagline;
      if (input.name) body.name = input.name;

      const data = await postInternalTool("web_widget", body);
      return {
        ok: true,
        message: `Created a web widget inbox for ${input.website_url}.`,
        data,
      };
    },
  },
  {
    id: "connect_channel",
    description:
      "Connect a token-based messaging channel — Telegram, Discord, Slack, Signal, Google Chat, Matrix, LINE, " +
      "IRC, Mattermost, Feishu, or Microsoft Teams — to this business's AI agent. Call list_channel_catalog " +
      "first to see exactly which fields that channel needs, ask the user for the missing ones, then call this. " +
      "Executes immediately once you have valid fields — no separate confirmation step. Not for WhatsApp: use " +
      "start_whatsapp_qr, connect_whatsapp_cloud, or connect_whatsapp_360dialog instead — ask the user which " +
      "WhatsApp option they want if they haven't said.",
    inputSchema: z.object({
      ...authTokenField,
      channel: z.string().describe("Channel id from list_channel_catalog, e.g. 'telegram', 'discord', 'slack'."),
      fields: z
        .record(z.string(), z.string())
        .describe("Field values keyed by each field's 'key' from list_channel_catalog for this channel."),
    }),
    execute: async (input, ctx) => {
      const def = getChannelDef(input.channel);
      if (!def) return { ok: false, message: `Unknown channel "${input.channel}". Call list_channel_catalog first.` };
      if (def.auth !== "token" || def.delivery !== "openclaw") {
        return {
          ok: false,
          message: `${def.label} isn't connected this way — use start_whatsapp_qr, connect_whatsapp_cloud, or connect_whatsapp_360dialog instead.`,
        };
      }

      let channelConfig: Record<string, unknown>;
      try {
        channelConfig = def.buildConfig(input.fields ?? {});
      } catch (err) {
        return {
          ok: false,
          message: `Missing or invalid field for ${def.label}: ${err instanceof Error ? err.message : String(err)}. Ask the user for it and try again.`,
        };
      }

      const gateway = new OpenClawGatewayClient(ctx.tenant.gatewayUrl, decryptSecret(ctx.tenant.gatewayTokenEnc));
      await gateway.connectTokenChannel(input.channel, channelConfig);

      const existing = await query(
        "SELECT chatwoot_inbox_id FROM channel_links WHERE tenant_id = $1 AND channel_type = $2 LIMIT 1",
        [ctx.tenant.id, input.channel],
      );
      let inboxId = existing[0] ? Number(existing[0].chatwoot_inbox_id) : null;
      if (!inboxId) {
        const data = await postInternalTool("channel_inbox", {
          account_id: ctx.tenant.chatwootAccountId,
          inbox_name: `${def.label} (OpenClaw)`,
        });
        inboxId = Number((data as { inbox_id: number }).inbox_id);
        await upsertChannelLink({
          tenantId: ctx.tenant.id,
          channelType: input.channel,
          chatwootInboxId: inboxId,
          openclawAccountId: "default",
          metadata: { provider: "openclaw", channel: input.channel, label: def.label },
        });
      }

      return { ok: true, message: `Connected ${def.label}.`, data: { inbox_id: inboxId } };
    },
  },
  {
    id: "start_whatsapp_qr",
    description:
      "Start (or restart) the WhatsApp QR-code connection flow for this business — a free personal/business " +
      "WhatsApp number connected via linked devices. Call this when the user wants that option rather than the " +
      "official Cloud API or 360dialog. The QR code appears automatically in the chat right after this call and " +
      "keeps itself fresh — you don't show it yourself; just tell the user to look for it below and scan it with " +
      "WhatsApp on their phone (WhatsApp → Linked devices → Link a device).",
    inputSchema: z.object(authTokenField),
    execute: async (_input, ctx) => {
      markWhatsAppQrRequested(ctx.tenant.id);
      return { ok: true, message: "The QR code is about to appear in the chat for the user to scan." };
    },
  },
  {
    id: "connect_whatsapp_cloud",
    description:
      "Connect WhatsApp via the official Meta WhatsApp Cloud API. Requires a WhatsApp Business Account (WABA) " +
      "ID, a phone number ID, and a permanent access token, all from Meta's developer console. Ask the user for " +
      "all three before calling. Executes immediately once you have them — no separate confirmation step.",
    inputSchema: z.object({
      ...authTokenField,
      waba_id: z.string().describe("WhatsApp Business Account ID."),
      phone_number_id: z.string().describe("Phone number ID."),
      access_token: z.string().describe("Permanent access token."),
    }),
    execute: async (input, ctx) => {
      const data = await postInternalTool("whatsapp_cloud", {
        account_id: ctx.tenant.chatwootAccountId,
        waba_id: input.waba_id,
        phone_number_id: input.phone_number_id,
        access_token: input.access_token,
      });
      const inboxId = Number((data as { inbox_id: number }).inbox_id);
      await upsertChannelLink({
        tenantId: ctx.tenant.id,
        channelType: "whatsapp_cloud",
        chatwootInboxId: inboxId,
        openclawAccountId: null,
        metadata: { provider: "chatwoot_native" },
      });
      const webhookSetup = (data as { webhook_setup?: boolean }).webhook_setup;
      return {
        ok: true,
        message: webhookSetup === false
          ? `WhatsApp Cloud API connected, but the webhook registration failed: ${(data as { webhook_error?: string }).webhook_error}. Messages may not arrive until that's fixed.`
          : "WhatsApp Cloud API connected.",
        data: { inbox_id: inboxId },
      };
    },
  },
  {
    id: "connect_whatsapp_360dialog",
    description:
      "Connect WhatsApp via 360dialog (a WhatsApp Business Solution Provider). Requires the WhatsApp phone " +
      "number in E.164 format and the 360dialog API key from the 360dialog Hub. Ask the user for both before " +
      "calling. Executes immediately once you have them — no separate confirmation step.",
    inputSchema: z.object({
      ...authTokenField,
      phone_number: z.string().describe("WhatsApp number in E.164 format, e.g. +15551234567."),
      api_key: z.string().describe("360dialog API key from the 360dialog Hub."),
    }),
    execute: async (input, ctx) => {
      const data = await postInternalTool("whatsapp_360dialog", {
        account_id: ctx.tenant.chatwootAccountId,
        phone_number: input.phone_number,
        api_key: input.api_key,
      });
      const inboxId = Number((data as { inbox_id: number }).inbox_id);
      await upsertChannelLink({
        tenantId: ctx.tenant.id,
        channelType: "whatsapp_360dialog",
        chatwootInboxId: inboxId,
        openclawAccountId: null,
        metadata: { provider: "chatwoot_native" },
      });
      return { ok: true, message: "WhatsApp (360dialog) connected.", data: { inbox_id: inboxId } };
    },
  },
];

export function getAdminTool(id: string): AdminToolDef | undefined {
  return ADMIN_TOOLS.find((t) => t.id === id);
}
