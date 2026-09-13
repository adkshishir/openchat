const inboundUrl = () => process.env.OPENCHAT_BRIDGE_INBOUND_URL?.trim();

export function notifyOpenChatBridge(event: {
  channel: string;
  from: string;
  text: string;
  accountId?: string;
}): void {
  const url = inboundUrl();
  if (!url || !event.from || !event.text) {
    return;
  }
  const body = JSON.stringify({
    tenant_id: process.env.OPENCLAW_TENANT_ID ?? undefined,
    chatwoot_account_id: process.env.OPENCHAT_CHATWOOT_ACCOUNT_ID
      ? Number(process.env.OPENCHAT_CHATWOOT_ACCOUNT_ID)
      : undefined,
    channel: event.channel,
    from: event.from,
    text: event.text,
    account_id: event.accountId,
  });
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    // Bridge downtime must not break WhatsApp receive.
  });
}
