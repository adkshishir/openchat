export type HandoffDecision =
  | { action: "reply" }
  | { action: "skip"; reason: string }
  | { action: "escalate"; reason: string };

const HANDOFF_PATTERNS = [/^\/human\b/i, /@bot\s+off/i, /^\/agent\b/i, /\bhuman please\b/i];

export function decideHandoff(input: {
  event: string;
  messageType?: string | number;
  privateNote?: boolean;
  senderType?: string;
  humanAssignee?: boolean;
  aiEnabled?: boolean;
  tenantStatus?: string;
  content?: string | null;
}): HandoffDecision {
  if (input.event !== "message_created") {
    return { action: "skip", reason: "not_message_created" };
  }
  if (input.privateNote) {
    return { action: "skip", reason: "private_note" };
  }
  const messageType = String(input.messageType ?? "");
  if (messageType !== "incoming" && messageType !== "0") {
    return { action: "skip", reason: "not_incoming" };
  }
  if (input.senderType === "agent_bot") {
    return { action: "skip", reason: "bot_sender" };
  }
  if (input.tenantStatus && input.tenantStatus !== "active" && input.tenantStatus !== "provisioning") {
    return { action: "skip", reason: "tenant_inactive" };
  }
  if (input.aiEnabled === false) {
    return { action: "skip", reason: "ai_disabled" };
  }
  if (input.humanAssignee) {
    return { action: "skip", reason: "human_assigned" };
  }
  const content = input.content?.trim() ?? "";
  if (content && HANDOFF_PATTERNS.some((pattern) => pattern.test(content))) {
    return { action: "escalate", reason: "customer_requested_human" };
  }
  return { action: "reply" };
}
