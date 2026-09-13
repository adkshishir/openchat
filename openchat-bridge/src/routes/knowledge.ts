import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { deleteKnowledgeSource, ingestDocument, listKnowledgeSources, searchKnowledge } from "../services/knowledge.ts";
import { getTenantByAccountId } from "../services/tenants.ts";

export async function registerKnowledgeRoutes(app: FastifyInstance) {
  app.get("/tenants/:accountId/knowledge", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const sources = await listKnowledgeSources(tenant.id);
    return {
      sources: sources.map((s) => ({
        id: s.id,
        filename: s.filename,
        kind: s.kind,
        chunk_count: s.chunkCount,
        created_at: s.createdAt.toISOString(),
      })),
    };
  });

  app.post("/tenants/:accountId/knowledge/upload", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

    const file = await request.file({ limits: { fileSize: config.knowledgeMaxUploadBytes } });
    if (!file) return reply.code(400).send({ error: "no_file_uploaded" });

    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      return reply.code(413).send({ error: "file_too_large", max_bytes: config.knowledgeMaxUploadBytes });
    }

    try {
      const source = await ingestDocument({ tenantId: tenant.id, filename: file.filename, buffer });
      return {
        id: source.id,
        filename: source.filename,
        kind: source.kind,
        chunk_count: source.chunkCount,
      };
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : "ingest_failed" });
    }
  });

  app.delete("/tenants/:accountId/knowledge/:sourceId", async (request, reply) => {
    const { accountId, sourceId } = request.params as { accountId: string; sourceId: string };
    const tenant = await getTenantByAccountId(Number(accountId));
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const deleted = await deleteKnowledgeSource(tenant.id, sourceId);
    if (!deleted) return reply.code(404).send({ error: "source_not_found" });
    return { ok: true };
  });

  app.post("/tenants/:accountId/knowledge/search", async (request, reply) => {
    const accountId = Number((request.params as { accountId: string }).accountId);
    const tenant = await getTenantByAccountId(accountId);
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const body = request.body as { query?: string; top_k?: number };
    if (!body.query?.trim()) return reply.code(400).send({ error: "query_required" });
    const matches = await searchKnowledge(tenant.id, body.query, body.top_k);
    return {
      matches: matches.map((m) => ({
        source_type: m.sourceType,
        content: m.content,
        metadata: m.metadata,
        score: m.score,
      })),
    };
  });
}
