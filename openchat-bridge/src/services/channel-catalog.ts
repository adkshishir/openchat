/**
 * Chat channels OpenChat can connect. Most are OpenClaw channels: WhatsApp (QR
 * variant) uses QR/WebSocket, the rest use token/config → gateway config.patch +
 * channels.start. WhatsApp Cloud API and 360dialog are native Chatwoot channels
 * instead (delivery: "chatwoot_native") — Chatwoot itself sends/receives on them,
 * so buildConfig is unused for those two; their setup goes through
 * Api::V1::Internal::OpenchatToolsController#whatsapp_cloud/whatsapp_360dialog.
 * Meta Instagram/Messenger are intentionally omitted (not supported at all).
 */

export type ChannelField = {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
  help?: string;
};

export type OpenClawChannelDef = {
  id: string;
  label: string;
  description: string;
  /** qr = WhatsApp-style live stream; token = form fields */
  auth: "qr" | "token";
  /** Which system actually sends/receives on this channel once connected. */
  delivery: "openclaw" | "chatwoot_native";
  fields: ChannelField[];
  docsHint: string;
  /** Build channels.<id> config object from submitted field values. Unused
   * (returns {}) for delivery: "chatwoot_native" entries. */
  buildConfig: (fields: Record<string, string>) => Record<string, unknown>;
};

function req(fields: Record<string, string>, key: string): string {
  const v = fields[key]?.trim();
  if (!v) throw new Error(`${key}_required`);
  return v;
}

export const OPENCLAW_CHANNEL_CATALOG: OpenClawChannelDef[] = [
  {
    id: "whatsapp",
    label: "WhatsApp (QR)",
    description: "Scan a QR code (WhatsApp Web / linked devices) — free, uses a personal or business number.",
    auth: "qr",
    delivery: "openclaw",
    fields: [],
    docsHint: "WhatsApp → Linked devices → Link a device",
    buildConfig: () => ({ enabled: true }),
  },
  {
    id: "whatsapp_cloud",
    label: "WhatsApp (Cloud API)",
    description:
      "Official Meta WhatsApp Business Platform. Needs a WhatsApp Business Account (WABA) ID, a phone number ID, " +
      "and a permanent access token from Meta's developer console.",
    auth: "token",
    delivery: "chatwoot_native",
    fields: [
      { key: "waba_id", label: "WhatsApp Business Account ID" },
      { key: "phone_number_id", label: "Phone number ID" },
      { key: "access_token", label: "Permanent access token", secret: true },
    ],
    docsHint: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    buildConfig: () => ({}),
  },
  {
    id: "whatsapp_360dialog",
    label: "WhatsApp (360dialog)",
    description:
      "WhatsApp via the 360dialog Business Solution Provider. Needs the WhatsApp phone number and a 360dialog " +
      "API key from the 360dialog Hub.",
    auth: "token",
    delivery: "chatwoot_native",
    fields: [
      { key: "phone_number", label: "WhatsApp number (E.164)", placeholder: "+15551234567" },
      { key: "api_key", label: "360dialog API key", secret: true },
    ],
    docsHint: "https://www.360dialog.com/",
    buildConfig: () => ({}),
  },
  {
    id: "telegram",
    label: "Telegram",
    description: "Bot token from @BotFather.",
    auth: "token",
    delivery: "openclaw",
    fields: [
      {
        key: "botToken",
        label: "Bot token",
        secret: true,
        placeholder: "123456:ABC-DEF…",
        help: "Create a bot with @BotFather and paste the token.",
      },
    ],
    docsHint: "https://docs.openclaw.ai/channels/telegram",
    buildConfig: (f) => ({
      enabled: true,
      botToken: req(f, "botToken"),
      dmPolicy: "open",
      allowFrom: ["*"],
    }),
  },
  {
    id: "discord",
    label: "Discord",
    description: "Discord bot token from the Developer Portal.",
    auth: "token",
    delivery: "openclaw",
    fields: [
      {
        key: "token",
        label: "Bot token",
        secret: true,
        placeholder: "MTIz…",
        help: "Enable Message Content Intent on the bot page.",
      },
    ],
    docsHint: "https://docs.openclaw.ai/channels/discord",
    buildConfig: (f) => ({
      enabled: true,
      token: req(f, "token"),
      dmPolicy: "open",
      allowFrom: ["*"],
    }),
  },
  {
    id: "slack",
    label: "Slack",
    description: "Socket Mode: bot token + app-level token.",
    auth: "token",
    delivery: "openclaw",
    fields: [
      {
        key: "botToken",
        label: "Bot token",
        secret: true,
        placeholder: "xoxb-…",
      },
      {
        key: "appToken",
        label: "App-level token",
        secret: true,
        placeholder: "xapp-…",
        help: "App-Level Token with connections:write (Socket Mode).",
      },
    ],
    docsHint: "https://docs.openclaw.ai/channels/slack",
    buildConfig: (f) => ({
      enabled: true,
      botToken: req(f, "botToken"),
      appToken: req(f, "appToken"),
      dmPolicy: "open",
      allowFrom: ["*"],
    }),
  },
  {
    id: "signal",
    label: "Signal",
    description: "signal-cli HTTP daemon (account number + daemon URL).",
    auth: "token",
    delivery: "openclaw",
    fields: [
      {
        key: "account",
        label: "Signal number (E.164)",
        placeholder: "+15551234567",
      },
      {
        key: "httpUrl",
        label: "signal-cli HTTP URL",
        placeholder: "http://127.0.0.1:8080",
        help: "bbernhard/signal-cli-rest-api or native HTTP daemon.",
      },
    ],
    docsHint: "https://docs.openclaw.ai/channels/signal",
    buildConfig: (f) => ({
      enabled: true,
      account: req(f, "account"),
      httpUrl: req(f, "httpUrl"),
      dmPolicy: "open",
      allowFrom: ["*"],
    }),
  },
  {
    id: "googlechat",
    label: "Google Chat",
    description: "Google Chat app webhook + audience.",
    auth: "token",
    delivery: "openclaw",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://chat.googleapis.com/…",
      },
      {
        key: "audienceType",
        label: "Audience type",
        placeholder: "app-url",
        help: "app-url or project-number",
        optional: true,
      },
      {
        key: "audience",
        label: "Audience value",
        placeholder: "App URL or project number",
        optional: true,
      },
    ],
    docsHint: "https://docs.openclaw.ai/channels/googlechat",
    buildConfig: (f) => {
      const cfg: Record<string, unknown> = {
        enabled: true,
        webhookUrl: req(f, "webhookUrl"),
      };
      if (f.audienceType?.trim()) cfg.audienceType = f.audienceType.trim();
      if (f.audience?.trim()) cfg.audience = f.audience.trim();
      return cfg;
    },
  },
  {
    id: "matrix",
    label: "Matrix",
    description: "Homeserver + access token (or password).",
    auth: "token",
    delivery: "openclaw",
    fields: [
      { key: "homeserver", label: "Homeserver URL", placeholder: "https://matrix.org" },
      { key: "userId", label: "User ID", placeholder: "@bot:matrix.org" },
      {
        key: "accessToken",
        label: "Access token",
        secret: true,
        optional: true,
        help: "Prefer access token; password works if token omitted.",
      },
      {
        key: "password",
        label: "Password",
        secret: true,
        optional: true,
      },
    ],
    docsHint: "https://docs.openclaw.ai/channels/matrix",
    buildConfig: (f) => {
      const cfg: Record<string, unknown> = {
        enabled: true,
        homeserver: req(f, "homeserver"),
        userId: req(f, "userId"),
      };
      if (f.accessToken?.trim()) cfg.accessToken = f.accessToken.trim();
      else if (f.password?.trim()) cfg.password = f.password.trim();
      else throw new Error("accessToken_or_password_required");
      return cfg;
    },
  },
  {
    id: "line",
    label: "LINE",
    description: "LINE Messaging API channel access token + secret.",
    auth: "token",
    delivery: "openclaw",
    fields: [
      { key: "channelAccessToken", label: "Channel access token", secret: true },
      { key: "channelSecret", label: "Channel secret", secret: true },
    ],
    docsHint: "https://docs.openclaw.ai/channels/line",
    buildConfig: (f) => ({
      enabled: true,
      channelAccessToken: req(f, "channelAccessToken"),
      channelSecret: req(f, "channelSecret"),
    }),
  },
  {
    id: "irc",
    label: "IRC",
    description: "IRC server host + nick.",
    auth: "token",
    delivery: "openclaw",
    fields: [
      { key: "host", label: "Server host", placeholder: "irc.libera.chat" },
      { key: "nick", label: "Nick", placeholder: "openclaw-bot" },
      { key: "port", label: "Port", optional: true, placeholder: "6697" },
      { key: "password", label: "Server password", secret: true, optional: true },
    ],
    docsHint: "https://docs.openclaw.ai/channels/irc",
    buildConfig: (f) => {
      const cfg: Record<string, unknown> = {
        enabled: true,
        host: req(f, "host"),
        nick: req(f, "nick"),
      };
      if (f.port?.trim()) cfg.port = Number(f.port.trim());
      if (f.password?.trim()) cfg.password = f.password.trim();
      return cfg;
    },
  },
  {
    id: "mattermost",
    label: "Mattermost",
    description: "Mattermost bot token + base URL.",
    auth: "token",
    delivery: "openclaw",
    fields: [
      { key: "botToken", label: "Bot token", secret: true },
      { key: "baseUrl", label: "Base URL", placeholder: "https://chat.example.com" },
    ],
    docsHint: "https://docs.openclaw.ai/channels/mattermost",
    buildConfig: (f) => ({
      enabled: true,
      botToken: req(f, "botToken"),
      baseUrl: req(f, "baseUrl"),
      dmPolicy: "open",
      allowFrom: ["*"],
    }),
  },
  {
    id: "feishu",
    label: "Feishu / Lark",
    description: "Feishu app ID + app secret.",
    auth: "token",
    delivery: "openclaw",
    fields: [
      { key: "appId", label: "App ID" },
      { key: "appSecret", label: "App secret", secret: true },
    ],
    docsHint: "https://docs.openclaw.ai/channels/feishu",
    buildConfig: (f) => ({
      enabled: true,
      appId: req(f, "appId"),
      appSecret: req(f, "appSecret"),
      dmPolicy: "open",
      allowFrom: ["*"],
    }),
  },
  {
    id: "msteams",
    label: "Microsoft Teams",
    description: "Azure bot app ID + password + tenant.",
    auth: "token",
    delivery: "openclaw",
    fields: [
      { key: "appId", label: "App / Bot ID" },
      { key: "appPassword", label: "App password / client secret", secret: true },
      { key: "tenantId", label: "Tenant ID", optional: true },
    ],
    docsHint: "https://docs.openclaw.ai/channels/msteams",
    buildConfig: (f) => {
      const cfg: Record<string, unknown> = {
        enabled: true,
        appId: req(f, "appId"),
        appPassword: req(f, "appPassword"),
      };
      if (f.tenantId?.trim()) cfg.tenantId = f.tenantId.trim();
      return cfg;
    },
  },
];

export function getChannelDef(id: string): OpenClawChannelDef | undefined {
  return OPENCLAW_CHANNEL_CATALOG.find((c) => c.id === id);
}

export function listChannelCatalogPublic() {
  return OPENCLAW_CHANNEL_CATALOG.map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    auth: c.auth,
    fields: c.fields,
    docs_hint: c.docsHint,
  }));
}
