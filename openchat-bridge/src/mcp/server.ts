import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminToken } from "./admin-token.ts";
import { ADMIN_TOOLS } from "./admin-tools.ts";
import { verifyCommerceToken } from "./commerce-token.ts";
import { COMMERCE_TOOLS } from "./commerce-tools.ts";
import { COMMERCE_MCP_SERVER_ID } from "../services/openclaw.ts";
import { getTenantById } from "../services/tenants.ts";

function toCallToolResult(result: { ok: boolean; message: string; data?: unknown }): CallToolResult {
  const text = result.data !== undefined ? `${result.message}\n\n${JSON.stringify(result.data)}` : result.message;
  return { content: [{ type: "text", text }], isError: !result.ok };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Fresh McpServer per request (stateless streamable-http transport, no
 * sessionIdGenerator) — avoids accumulating per-connection state across the
 * many short-lived admin-chat tool calls a single agent turn can make.
 */
function buildAdminMcpServer(): McpServer {
  const server = new McpServer({ name: "openchat-admin", version: "1.0.0" });

  for (const tool of ADMIN_TOOLS) {
    if (!(tool.inputSchema instanceof z.ZodObject)) {
      throw new Error(`admin tool "${tool.id}" must declare a z.object() inputSchema`);
    }
    server.registerTool(
      tool.id,
      { description: tool.description, inputSchema: tool.inputSchema.shape },
      async (args: any): Promise<CallToolResult> => {
        const verified = verifyAdminToken(args?.authToken);
        if (!verified) return errorResult("Invalid or expired admin action token.");
        const tenant = await getTenantById(verified.tenantId);
        if (!tenant) return errorResult("Tenant not found for this admin action token.");
        try {
          const result = await tool.execute(args, { tenant, adminActionToken: args.authToken });
          return toCallToolResult(result);
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
      },
    );
  }

  return server;
}

/** Mounted at POST /mcp/admin — the only MCP server the "openchat-admin" OpenClaw agent persona is wired to. */
export async function handleAdminMcpRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const server = buildAdminMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.hijack();
  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request.raw, reply.raw, request.body);
}

/** Fresh McpServer per request, same rationale as buildAdminMcpServer. Every tenant's
 * customer-facing agent is wired to this one shared server (see
 * OpenClawGatewayClient#ensureTenantAgentConfigured); tenant/conversation/channel come
 * only from the verified commerce token, never an agent-supplied argument. */
function buildCommerceMcpServer(): McpServer {
  const server = new McpServer({ name: COMMERCE_MCP_SERVER_ID, version: "1.0.0" });

  for (const tool of COMMERCE_TOOLS) {
    if (!(tool.inputSchema instanceof z.ZodObject)) {
      throw new Error(`commerce tool "${tool.id}" must declare a z.object() inputSchema`);
    }
    server.registerTool(
      tool.id,
      { description: tool.description, inputSchema: tool.inputSchema.shape },
      async (args: any): Promise<CallToolResult> => {
        const verified = verifyCommerceToken(args?.authToken);
        if (!verified) return errorResult("Invalid or expired commerce action token.");
        const tenant = await getTenantById(verified.tenantId);
        if (!tenant) return errorResult("Tenant not found for this commerce action token.");
        try {
          const result = await tool.execute(args, {
            tenant,
            conversationId: verified.conversationId,
            channelType: verified.channelType,
          });
          return toCallToolResult(result);
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
      },
    );
  }

  return server;
}

/** Mounted at POST /mcp/commerce — the only MCP server any tenant's customer-facing
 * agent is wired to. Never exposed to the "openchat-admin" persona's mcp.servers config. */
export async function handleCommerceMcpRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const server = buildCommerceMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.hijack();
  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request.raw, reply.raw, request.body);
}
