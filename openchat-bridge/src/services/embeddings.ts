import { config } from "../config.ts";

export async function embedText(text: string): Promise<number[]> {
  const response = await fetch(`${config.ollamaUrl.replace(/\/$/, "")}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.embeddingModel, prompt: text }),
  });
  if (!response.ok) {
    throw new Error(`Embedding request failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { embedding?: number[] };
  if (!Array.isArray(data.embedding)) {
    throw new Error("Embedding response missing 'embedding' array");
  }
  return data.embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
