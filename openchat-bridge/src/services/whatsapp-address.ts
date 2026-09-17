/**
 * The one place that decides what a WhatsApp address looks like once it is inside
 * OpenChat. Inbound sync (the Chatwoot contact/source id), the AI reply path and the
 * human-reply relay all pass identifiers through here, so the id a conversation is
 * filed under is by construction the same string we later hand back to OpenClaw's
 * send RPC. Two independent normalizers is how privacy-mode senders got lost.
 *
 * Only real phone-based WhatsApp JIDs (`<digits>@s.whatsapp.net` / `<digits>@c.us`)
 * or bare phone numbers become E.164. A privacy-mode sender — the WhatsApp username
 * feature — arrives as `<id>@lid` with no phone number behind it at all, and never
 * will have one: that local part is an opaque WhatsApp id, not digits of a number.
 * It is returned unchanged and handed to OpenClaw as-is (its WhatsApp plugin
 * addresses `@lid` natively). Coercing it to `+<id>` would file the contact under a
 * phone number that belongs to someone else entirely.
 */
export function normalizeWhatsAppAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    const [user = trimmed, domain = ""] = trimmed.split("@");
    if (domain !== "s.whatsapp.net" && domain !== "c.us") {
      return trimmed;
    }
    const digits = user.replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  // Bare 10-digit numbers starting with 9 are almost always Nepali mobile numbers
  // missing their country code (the operator's home market) — default to +977.
  if (digits.length === 10 && digits.startsWith("9")) return `+977${digits}`;
  return `+${digits}`;
}
