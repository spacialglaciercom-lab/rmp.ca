import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { ENV } from "../_core/env.js";
import type { RagDocument, RagIndexFile, RetrievedChunk } from "./ragTypes";
import { createLogger } from "../logger";

const log = createLogger("rag");

// ── Constants ──────────────────────────────────────────────────────────────
// Use cwd-relative path so it works in both dev (tsx watch) and prod (esbuild bundle in dist/)
const INDEX_DIR = path.join(process.cwd(), "server", "rag-data");
const INDEX_PATH = path.join(INDEX_DIR, "vector-index.json");
const CHUNK_SIZE = 2000; // ~500 tokens in chars
const CHUNK_OVERLAP = 200;
const DEFAULT_TOP_K = 3;
const SIMILARITY_THRESHOLD = 0.3;
const MISTRAL_EMBED_URL = "https://api.mistral.ai/v1/embeddings";
const MISTRAL_EMBED_MODEL = "mistral-embed";

// ── In-memory index ────────────────────────────────────────────────────────
let index: RagDocument[] = [];
let writeLock: Promise<void> = Promise.resolve();

// ── Init ───────────────────────────────────────────────────────────────────

export async function initRagIndex(): Promise<void> {
  try {
    if (!existsSync(INDEX_DIR)) {
      await mkdir(INDEX_DIR, { recursive: true });
    }
    if (existsSync(INDEX_PATH)) {
      const raw = await readFile(INDEX_PATH, "utf-8");
      const data: RagIndexFile = JSON.parse(raw);
      index = data.documents ?? [];
      log.info("Index loaded", {
        chunks: index.length,
        documents: new Set(index.map((d) => d.filename)).size,
      });
    } else {
      index = [];
      log.info("No existing index found — starting empty");
    }

    // Auto-ingest seed docs if index is empty and MISTRAL_API_KEY is set
    if (index.length === 0 && ENV.mistralApiKey) {
      await autoIngestSeedDocs();
    }
  } catch (err) {
    log.warn("Failed to load index, starting empty", {
      error: err instanceof Error ? err.message : String(err),
    });
    index = [];
  }
}

/**
 * Auto-ingest all .md/.txt files from server/rag-docs/ when the index is empty.
 * Runs once at startup on fresh deploys (e.g. Railway redeploy).
 */
async function autoIngestSeedDocs(): Promise<void> {
  const docsDir = path.join(process.cwd(), "server", "rag-docs");
  if (!existsSync(docsDir)) {
    log.info("No rag-docs/ directory found — skipping auto-ingest");
    return;
  }

  try {
    const files = await readdir(docsDir);
    const docFiles = files.filter(
      (f) => f.endsWith(".md") || f.endsWith(".txt"),
    );

    if (docFiles.length === 0) {
      log.info("No seed documents found in rag-docs/");
      return;
    }

    log.info("Auto-ingesting seed documents", { count: docFiles.length });

    for (const file of docFiles) {
      try {
        const content = await readFile(path.join(docsDir, file), "utf-8");
        if (!content.trim()) continue;

        // Derive category from filename: "algorithm-overview.md" -> "algorithm"
        const category =
          file.replace(/[-_].*$/, "").replace(/\.(md|txt)$/, "") || undefined;
        const result = await ingestDocument(file, content, category);
        log.info("ingested", { file, chunks: result.chunksCreated });
      } catch (err) {
        log.warn("seed doc failed", {
          file,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.info("Auto-ingest complete", { totalChunks: index.length });
  } catch (err) {
    log.warn("Auto-ingest failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Persistence ────────────────────────────────────────────────────────────

async function persistIndex(): Promise<void> {
  // Queue writes to prevent concurrent file corruption
  writeLock = writeLock.then(async () => {
    const data: RagIndexFile = {
      version: 1,
      documents: index,
      lastUpdated: new Date().toISOString(),
    };
    if (!existsSync(INDEX_DIR)) {
      await mkdir(INDEX_DIR, { recursive: true });
    }
    await writeFile(INDEX_PATH, JSON.stringify(data), "utf-8");
  });
  await writeLock;
}

// ── Embeddings ─────────────────────────────────────────────────────────────

export async function embedText(texts: string[]): Promise<number[][]> {
  if (!ENV.mistralApiKey) {
    throw new Error("[RAG] MISTRAL_API_KEY not configured");
  }

  const resp = await fetch(MISTRAL_EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.mistralApiKey}`,
    },
    body: JSON.stringify({
      model: MISTRAL_EMBED_MODEL,
      input: texts,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`[RAG] Mistral embed failed (${resp.status}): ${body}`);
  }

  const json = (await resp.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return json.data.map((d) => d.embedding);
}

// ── Chunking ───────────────────────────────────────────────────────────────

export function chunkDocument(content: string): string[] {
  const paragraphs = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length + 2 <= CHUNK_SIZE) {
      current += (current ? "\n\n" : "") + trimmed;
    } else {
      if (current) chunks.push(current);

      if (trimmed.length <= CHUNK_SIZE) {
        current = trimmed;
      } else {
        // Split long paragraphs on sentence boundaries
        const sentences = trimmed.split(/(?<=\.)\s+/);
        current = "";
        for (const sentence of sentences) {
          if (current.length + sentence.length + 1 <= CHUNK_SIZE) {
            current += (current ? " " : "") + sentence;
          } else {
            if (current) chunks.push(current);
            current = sentence;
          }
        }
      }
    }
  }
  if (current) chunks.push(current);

  // Add overlap between chunks
  if (chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const prevEnd = chunks[i - 1].slice(-CHUNK_OVERLAP);
      chunks[i] = prevEnd + "\n\n" + chunks[i];
    }
  }

  return chunks;
}

// ── Cosine similarity ──────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function ingestDocument(
  filename: string,
  content: string,
  category?: string,
): Promise<{ chunksCreated: number }> {
  // Remove existing chunks for this filename (re-ingest)
  index = index.filter((d) => d.filename !== filename);

  const chunks = chunkDocument(content);
  if (chunks.length === 0) {
    await persistIndex();
    return { chunksCreated: 0 };
  }

  const embeddings = await embedText(chunks);

  const now = new Date().toISOString();
  for (let i = 0; i < chunks.length; i++) {
    index.push({
      id: `${filename}-${i}-${Date.now()}`,
      filename,
      chunkIndex: i,
      content: chunks[i],
      embedding: embeddings[i],
      metadata: {
        category,
        ingestedAt: now,
        charCount: chunks[i].length,
      },
    });
  }

  await persistIndex();
  log.info("ingested document", { filename, chunks: chunks.length });
  return { chunksCreated: chunks.length };
}

export async function retrieveContext(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  if (index.length === 0) return [];

  const [queryEmbedding] = await embedText([query]);

  const scored = index
    .map((doc) => ({
      content: doc.content,
      filename: doc.filename,
      category: doc.metadata.category,
      score: cosineSimilarity(queryEmbedding, doc.embedding),
    }))
    .filter((r) => r.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

export function removeDocument(filename: string): { removed: number } {
  const before = index.length;
  index = index.filter((d) => d.filename !== filename);
  const removed = before - index.length;
  if (removed > 0) {
    persistIndex().catch((err) =>
      log.error(
        "Failed to persist after remove",
        err instanceof Error ? err : new Error(String(err)),
      ),
    );
  }
  return { removed };
}

export function listDocuments(): Array<{
  filename: string;
  chunkCount: number;
  category?: string;
  ingestedAt: string;
}> {
  const byFile = new Map<
    string,
    { chunkCount: number; category?: string; ingestedAt: string }
  >();
  for (const doc of index) {
    const existing = byFile.get(doc.filename);
    if (!existing) {
      byFile.set(doc.filename, {
        chunkCount: 1,
        category: doc.metadata.category,
        ingestedAt: doc.metadata.ingestedAt,
      });
    } else {
      existing.chunkCount++;
    }
  }
  return Array.from(byFile.entries()).map(([filename, info]) => ({
    filename,
    ...info,
  }));
}
