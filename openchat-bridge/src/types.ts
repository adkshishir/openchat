export type TenantStatus = "provisioning" | "active" | "suspended" | "past_due" | "deleted";

export type Tenant = {
  id: string;
  chatwootAccountId: number;
  openclawTenantId: string;
  gatewayUrl: string;
  gatewayTokenEnc: string;
  status: TenantStatus;
  aiEnabled: boolean;
  billingCustomerId: string | null;
  createdAt: Date;
};

export type ChannelLink = {
  id: string;
  tenantId: string;
  channelType: string;
  openclawAccountId: string | null;
  chatwootInboxId: number;
  metadata: Record<string, unknown>;
};

export type ConversationMap = {
  id: string;
  tenantId: string;
  channelLinkId: string;
  externalContactId: string;
  chatwootConversationId: number;
};

export type AgentBotRecord = {
  id: string;
  tenantId: string;
  chatwootAgentBotId: number;
  accessTokenEnc: string;
  secretEnc: string;
};

export type ObservabilityEvent = {
  id: string;
  tenantId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type KnowledgeSource = {
  id: string;
  tenantId: string;
  filename: string;
  kind: "document" | "catalog";
  chunkCount: number;
  createdAt: Date;
};

export type KnowledgeMatch = {
  sourceId: string;
  sourceType: "document" | "product";
  content: string;
  metadata: Record<string, unknown>;
  score: number;
};

export type ChatwootMessageWebhook = {
  event: string;
  id?: number;
  content?: string | null;
  message_type?: "incoming" | "outgoing" | "activity" | "template" | number;
  private?: boolean;
  sender?: { type?: string; id?: number; name?: string; identifier?: string } | null;
  account?: { id?: number };
  inbox?: { id?: number; name?: string };
  conversation?: {
    id?: number;
    display_id?: number;
    inbox_id?: number;
    status?: string;
    meta?: {
      assignee?: { id?: number; type?: string } | null;
      assignee_type?: string;
      sender?: { id?: number; identifier?: string; name?: string; phone_number?: string } | null;
    };
  };
};
