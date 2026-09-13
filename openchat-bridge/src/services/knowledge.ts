import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { config } from "../config.ts";
import { query } from "../db.ts";
import type { KnowledgeMatch, KnowledgeSource } from "../types.ts";
import { cosineSimilarity, embedText } from "./embeddings.ts";

const CATALOG_EXTENSIONS = /\.(json|csv|xlsx|xls)$/i;
const MAX_CHUNK_CHARS = 1200;

function isCatalogFile(filename: string): boolean {
  return CATALOG_EXTENSIONS.test(filename.trim());
}

/** Splits plain text into ~MAX_CHUNK_CHARS chunks on paragraph boundaries. */
function chunkPlainText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= MAX_CHUNK_CHARS) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= MAX_CHUNK_CHARS) {
      current = paragraph;
    } else {
      for (let i = 0; i < paragraph.length; i += MAX_CHUNK_CHARS) {
        chunks.push(paragraph.slice(i, i + MAX_CHUNK_CHARS));
      }
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.trim()].filter(Boolean);
}

/** Parses .json/.csv/.xlsx/.xls into row objects — one product/record per row. */
function parseCatalogRows(buffer: Buffer, filename: string): Array<Record<string, unknown>> {
  if (/\.json$/i.test(filename)) {
    const parsed = JSON.parse(buffer.toString("utf8"));
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
  }
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function rowToText(row: Record<string, unknown>): string {
  return Object.entries(row)
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

export async function ingestDocument(input: {
  tenantId: string;
  filename: string;
  buffer: Buffer;
}): Promise<KnowledgeSource> {
  const catalog = isCatalogFile(input.filename);
  const kind: "document" | "catalog" = catalog ? "catalog" : "document";

  const items: Array<{ sourceType: "document" | "product"; content: string; metadata: Record<string, unknown> }> =
    [];
  if (catalog) {
    const rows = parseCatalogRows(input.buffer, input.filename);
    for (const row of rows) {
      const content = rowToText(row);
      if (content.trim()) {
        items.push({ sourceType: "product", content, metadata: row });
      }
    }
  } else {
    const text = input.buffer.toString("utf8");
    for (const chunk of chunkPlainText(text)) {
      items.push({ sourceType: "document", content: chunk, metadata: {} });
    }
  }

  if (!items.length) {
    throw new Error("No content could be extracted from this file");
  }

  const sourceId = crypto.randomUUID();
  await query(
    `INSERT INTO knowledge_sources (id, tenant_id, filename, kind, chunk_count)
     VALUES ($1, $2, $3, $4, $5)`,
    [sourceId, input.tenantId, input.filename, kind, items.length],
  );

  // Sequential to stay gentle on the local embedding model; catalogs can be sizeable.
  for (const item of items) {
    const embedding = await embedText(item.content);
    await query(
      `INSERT INTO knowledge_chunks (id, tenant_id, source_id, source_type, content, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        crypto.randomUUID(),
        input.tenantId,
        sourceId,
        item.sourceType,
        item.content,
        JSON.stringify(item.metadata),
        JSON.stringify(embedding),
      ],
    );
  }

  return {
    id: sourceId,
    tenantId: input.tenantId,
    filename: input.filename,
    kind,
    chunkCount: items.length,
    createdAt: new Date(),
  };
}

export async function listKnowledgeSources(tenantId: string): Promise<KnowledgeSource[]> {
  const rows = await query(
    "SELECT * FROM knowledge_sources WHERE tenant_id = $1 ORDER BY created_at DESC",
    [tenantId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    filename: String(row.filename),
    kind: row.kind as KnowledgeSource["kind"],
    chunkCount: Number(row.chunk_count),
    createdAt: new Date(String(row.created_at)),
  }));
}

export async function deleteKnowledgeSource(tenantId: string, sourceId: string): Promise<boolean> {
  const rows = await query(
    "DELETE FROM knowledge_sources WHERE tenant_id = $1 AND id = $2 RETURNING id",
    [tenantId, sourceId],
  );
  return rows.length > 0;
}

export async function searchKnowledge(
  tenantId: string,
  queryText: string,
  topK = config.knowledgeTopK,
): Promise<KnowledgeMatch[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];
  const rows = await query<{
    source_id: string;
    source_type: string;
    content: string;
    metadata: Record<string, unknown>;
    embedding: number[];
  }>("SELECT source_id, source_type, content, metadata, embedding FROM knowledge_chunks WHERE tenant_id = $1", [
    tenantId,
  ]);
  if (!rows.length) return [];

  const queryEmbedding = await embedText(trimmed);
  const scored = rows.map((row) => ({
    sourceId: String(row.source_id),
    sourceType: row.source_type as KnowledgeMatch["sourceType"],
    content: String(row.content),
    metadata: row.metadata ?? {},
    score: cosineSimilarity(queryEmbedding, row.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter((match) => match.score > 0.3);
}
