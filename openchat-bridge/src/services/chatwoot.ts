import { config } from "../config.ts";

export class ChatwootClient {
  private readonly accountId: number;
  private readonly accessToken: string;

  constructor(accountId: number, accessToken: string) {
    this.accountId = accountId;
    this.accessToken = accessToken;
  }

  private headers(): Record<string, string> {
    return {
      api_access_token: this.accessToken,
      "Content-Type": "application/json",
    };
  }

  async postMessage(conversationId: number, content: string, extra: Record<string, unknown> = {}) {
    const response = await fetch(
      `${config.chatwootBaseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ content, message_type: "outgoing", private: false, ...extra }),
      },
    );
    if (!response.ok) {
      throw new Error(`Chatwoot postMessage failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
  }

  async toggleStatus(conversationId: number, status: "open" | "pending" | "resolved") {
    const response = await fetch(
      `${config.chatwootBaseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/toggle_status`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ status }),
      },
    );
    if (!response.ok) {
      throw new Error(`Chatwoot toggleStatus failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
  }

  async assignConversation(conversationId: number, assigneeId: number | null, assigneeType = "User") {
    const response = await fetch(
      `${config.chatwootBaseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/assignments`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ assignee_id: assigneeId, assignee_type: assigneeType }),
      },
    );
    if (!response.ok) {
      throw new Error(`Chatwoot assign failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
  }

  async listMessages(conversationId: number) {
    const response = await fetch(
      `${config.chatwootBaseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages`,
      { headers: this.headers() },
    );
    if (!response.ok) {
      throw new Error(`Chatwoot listMessages failed: ${response.status}`);
    }
    return response.json();
  }

  async createApiInbox(name: string, webhookUrl: string) {
    const response = await fetch(`${config.chatwootBaseUrl}/api/v1/accounts/${this.accountId}/inboxes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        name,
        // Chatwoot defaults every new inbox to auto-assignment on. That fights the
        // bot: the moment a conversation is opened, Chatwoot hands it to a human
        // agent, and handleAgentBotWebhook's decideHandoff then sees humanAssignee
        // and skips replying forever. Escalated/handoff conversations still land in
        // the inbox's Unassigned view for a human to claim manually.
        enable_auto_assignment: false,
        channel: { type: "api", webhook_url: webhookUrl },
      }),
    });
    if (!response.ok) {
      throw new Error(`Chatwoot createApiInbox failed: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<{ id: number; channel?: { identifier?: string } }>;
  }

  async setAgentBot(inboxId: number, agentBotId: number) {
    const response = await fetch(
      `${config.chatwootBaseUrl}/api/v1/accounts/${this.accountId}/inboxes/${inboxId}/set_agent_bot`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ agent_bot: agentBotId }),
      },
    );
    if (!response.ok) {
      throw new Error(`Chatwoot setAgentBot failed: ${response.status}`);
    }
  }
}

function looksLikeE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

function normalizeContactId(value: string, channel?: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const ch = (channel || "").toLowerCase();
  // Discord / Slack / etc. — keep opaque ids (prefix for stability across channels).
  if (ch && ch !== "whatsapp") {
    return trimmed.includes(":") ? trimmed : `${ch}:${trimmed}`;
  }
  if (trimmed.includes("@")) {
    const user = trimmed.split("@")[0] ?? trimmed;
    return user.startsWith("+") ? user : `+${user.replace(/\D/g, "")}`;
  }
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  return digits ? `+${digits}` : trimmed;
}

type PublicConversation = {
  id?: number;
  display_id?: number;
  status?: string;
};

/**
 * Create (or reuse) a Chatwoot public-API conversation and append an incoming message.
 * WhatsApp uses E.164 phone as source_id; other channels use opaque identifiers.
 */
export async function createPublicIncomingMessage(input: {
  inboxIdentifier: string;
  contactIdentifier: string;
  content: string;
  channel?: string;
}): Promise<{ conversationId: number; sourceId: string }> {
  const sourceId = normalizeContactId(input.contactIdentifier, input.channel);
  const base = `${config.chatwootBaseUrl}/public/api/v1/inboxes/${input.inboxIdentifier}`;
  const isPhone = looksLikeE164(sourceId);

  const createContact = await fetch(`${base}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_id: sourceId,
      identifier: sourceId,
      name: sourceId,
      ...(isPhone ? { phone_number: sourceId } : {}),
    }),
  });
  if (!createContact.ok) {
    const body = await createContact.text();
    // Contact may already exist — continue with sourceId.
    if (createContact.status !== 422 || !/already|taken|exist/i.test(body)) {
      // Some Chatwoot versions return 200 only; 422 on duplicate — try reuse.
      if (!(createContact.status === 422 && body.includes("identifier"))) {
        throw new Error(`Chatwoot createContact failed: ${createContact.status} ${body}`);
      }
    }
  }
  let resolvedSourceId = sourceId;
  try {
    const contact = (await createContact.json()) as { source_id?: string };
    resolvedSourceId = contact.source_id ?? sourceId;
  } catch {
    resolvedSourceId = sourceId;
  }

  let conversationId: number | null = null;
  const listRes = await fetch(`${base}/contacts/${encodeURIComponent(resolvedSourceId)}/conversations`);
  if (listRes.ok) {
    const listed = (await listRes.json()) as PublicConversation[] | { payload?: PublicConversation[] };
    const rows = Array.isArray(listed) ? listed : listed.payload ?? [];
    const open =
      rows.find((c) => String(c.status ?? "").toLowerCase() === "open") ??
      rows.find((c) => String(c.status ?? "").toLowerCase() === "pending") ??
      rows[0];
    const id = open?.id ?? open?.display_id;
    if (typeof id === "number" && id > 0) conversationId = id;
  }

  if (!conversationId) {
    const convRes = await fetch(`${base}/contacts/${encodeURIComponent(resolvedSourceId)}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!convRes.ok) {
      throw new Error(`Chatwoot createConversation failed: ${convRes.status} ${await convRes.text()}`);
    }
    const conversation = (await convRes.json()) as PublicConversation;
    conversationId = conversation.id ?? conversation.display_id ?? null;
  }

  if (!conversationId) {
    throw new Error("Chatwoot conversation id missing after create");
  }

  const messageRes = await fetch(
    `${base}/contacts/${encodeURIComponent(resolvedSourceId)}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: input.content }),
    },
  );
  if (!messageRes.ok) {
    throw new Error(`Chatwoot createMessage failed: ${messageRes.status} ${await messageRes.text()}`);
  }
  return { conversationId, sourceId: resolvedSourceId };
}
