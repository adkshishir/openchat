import { z } from "zod";
import { decryptSecret } from "../crypto.ts";
import { ChatwootClient } from "../services/chatwoot.ts";
import { searchKnowledge } from "../services/knowledge.ts";
import { createOrder } from "../services/orders.ts";
import { getAgentBot } from "../services/tenants.ts";
import type { Tenant } from "../types.ts";

/**
 * Declarative registry of tools exposed to every tenant's customer-facing OpenClaw
 * agent (mounted via mcp/server.ts, registered per tenant in
 * OpenClawGatewayClient#ensureTenantAgentConfigured). Mirrors mcp/admin-tools.ts's
 * shape and the same authorization discipline: every execute() derives which
 * tenant/conversation to act on ONLY from ctx (resolved server-side from a verified
 * commerce action token) — never from any LLM-supplied argument.
 */

export type CommerceToolContext = {
  tenant: Tenant;
  conversationId: number;
  channelType: string;
};

export type CommerceToolResult = { ok: boolean; message: string; data?: unknown };

export type CommerceToolDef = {
  id: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: any, ctx: CommerceToolContext) => Promise<CommerceToolResult>;
};

const authTokenField = {
  authToken: z
    .string()
    .describe(
      "The commerce action token given to you in your system prompt for this session. Required on every call.",
    ),
};

/** Only the Chatwoot web widget renders content_type "cards" as an interactive picker
 * for the actual customer; every other channel just gets the returned product data
 * back as plain tool output for the model to describe in its own reply. */
const CARDS_SUPPORTED_CHANNEL = "web_widget";

type ProductCard = {
  name: string;
  price: string | null;
  description: string;
  imageUrl: string | null;
  /** Raw option list from the catalog, e.g. "Switch: Red, Blue, Brown". */
  variants: string | null;
};

function toProductCard(match: { content: string; metadata: Record<string, unknown> }): ProductCard {
  const meta = match.metadata ?? {};
  const name = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : match.content.slice(0, 80);
  const price = typeof meta.price === "string" || typeof meta.price === "number" ? String(meta.price) : null;
  const description =
    typeof meta.description === "string" && meta.description.trim() ? meta.description.trim() : match.content;
  const imageUrl = typeof meta.image_url === "string" && meta.image_url.trim() ? meta.image_url.trim() : null;
  // Uploaded catalogs spell the column however the business typed it.
  const rawVariants = meta.Variants ?? meta.variants;
  const variants = typeof rawVariants === "string" && rawVariants.trim() ? rawVariants.trim() : null;
  return { name, price, description, imageUrl, variants };
}

async function chatwootClientFor(tenant: Tenant): Promise<ChatwootClient | null> {
  const bot = await getAgentBot(tenant.id);
  if (!bot) return null;
  return new ChatwootClient(tenant.chatwootAccountId, decryptSecret(bot.accessTokenEnc));
}

export const COMMERCE_TOOLS: CommerceToolDef[] = [
  {
    id: "show_product_cards",
    description:
      "Look up products/packages matching a customer's request in this business's catalog. On the website " +
      "widget this automatically shows the customer an interactive picker with cards and a 'select' button per " +
      "product — you don't need to also list them out in your reply, just add a short intro sentence. On " +
      "channels without card support (e.g. WhatsApp), no picker is shown to the customer; describe the returned " +
      "products yourself as a clear numbered list in your reply.",
    inputSchema: z.object({
      ...authTokenField,
      query: z.string().describe("What the customer is looking for, e.g. 'hiking packages' or 'wireless earbuds'."),
    }),
    execute: async (input, ctx) => {
      const matches = await searchKnowledge(ctx.tenant.id, input.query, 6, "product");
      if (!matches.length) {
        return { ok: true, message: "No matching products found for that query." };
      }
      const products = matches.map(toProductCard);

      if (ctx.channelType === CARDS_SUPPORTED_CHANNEL) {
        const chatwoot = await chatwootClientFor(ctx.tenant);
        if (chatwoot) {
          await chatwoot.postMessage(ctx.conversationId, "Here's what I found:", {
            content_type: "cards",
            content_attributes: {
              items: products.map((p) => ({
                title: p.price ? `${p.name} — ${p.price}` : p.name,
                description: p.variants ? `${p.description}\nOptions — ${p.variants}` : p.description,
                media_url: p.imageUrl ?? "",
                actions: [{ type: "postback", text: "Select this", payload: `order:${p.name}` }],
              })),
            },
          });
        }
      }

      const shown = ctx.channelType === CARDS_SUPPORTED_CHANNEL;
      return {
        ok: true,
        // A tool-only turn ends with no visible text, which the agent runtime treats as a
        // failed run — so the result has to tell the model it still owes the customer a reply.
        message:
          (shown
            ? `Found ${products.length} matching product(s) and already showed them to the customer as cards. ` +
              `Now reply to the customer in plain text — briefly introduce the options and ask which one they want. ` +
              `Do not list every product again.`
            : `Found ${products.length} matching product(s). This channel cannot show cards, so reply in plain text ` +
              `listing them with their prices, then ask which one they want.`) +
          (products.some((p) => p.variants)
            ? ` Some products have options (see "variants"); if the customer picks one of those, ask which option ` +
              `they want before ordering and pass it to create_order as "variant".`
            : ""),
        data: { products, cards_shown_to_customer: shown },
      };
    },
  },
  {
    id: "create_order",
    description:
      "Place an order once the customer has picked a product and you've collected their full name, phone " +
      "number, and delivery address, and they've confirmed those details back to you. Executes immediately — " +
      "there is no separate human approval step, so only call this after the customer has explicitly confirmed.",
    inputSchema: z.object({
      ...authTokenField,
      product_name: z.string().describe("The exact product/package name the customer chose."),
      product_price: z.string().optional().describe("The price the customer was quoted, if known."),
      variant: z
        .string()
        .optional()
        .describe(
          "The option the customer chose, if the product has variants — e.g. 'Switch: Brown' or 'Color: Black'. " +
            "Required whenever the product listed options; ask the customer before ordering if they haven't said.",
        ),
      customer_name: z.string().describe("Customer's full name."),
      customer_phone: z.string().describe("Customer's phone number."),
      customer_address: z.string().describe("Customer's delivery/service address."),
    }),
    execute: async (input, ctx) => {
      const order = await createOrder({
        tenantId: ctx.tenant.id,
        chatwootConversationId: ctx.conversationId,
        productName: input.product_name,
        productPrice: input.product_price ?? null,
        variant: input.variant ?? null,
        customerName: input.customer_name,
        customerPhone: input.customer_phone,
        customerAddress: input.customer_address,
      });

      try {
        const chatwoot = await chatwootClientFor(ctx.tenant);
        await chatwoot?.postMessage(
          ctx.conversationId,
          `🛒 New order placed by the AI agent: ${input.product_name}${input.variant ? ` [${input.variant}]` : ""}` +
            `${input.product_price ? ` (${input.product_price})` : ""} — ` +
            `${input.customer_name}, ${input.customer_phone}, ${input.customer_address}`,
          { private: true },
        );
      } catch {
        // Order is already recorded — a failed internal note must not fail the order.
      }

      return {
        ok: true,
        message:
          `Order placed for ${input.product_name}${input.variant ? ` (${input.variant})` : ""}. ` +
          `Confirm it to the customer in plain text with what they ordered and where it's going.`,
        data: { order_id: order.id },
      };
    },
  },
];
