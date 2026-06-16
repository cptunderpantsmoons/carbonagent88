/**
 * Ingestion — File Parsing, Chunking, Embedding, Local Vector Store
 *
 * Control Corridor:
 * - Owns: Parsing, chunking, indexing, RAG retrieval
 * - Must NOT own: Browser automation
 *
 * Gate 5: Semantic RAG via cosine similarity on stored embeddings.
 * Removed SQL LIKE keyword search. Uses real cosine similarity.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// File Parsing
// ---------------------------------------------------------------------------

export interface ParsedDocument {
  title: string;
  content: string;
  mimeType: string;
  sourceUrl: string | null;
  profileId: string | null;
}

export function parseFile(
  filePath: string,
  options: { sourceUrl?: string; profileId?: string } = {},
): ParsedDocument {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);

  switch (ext) {
    case ".txt":
    case ".md":
    case ".csv":
      return {
        title: basename,
        content: buffer.toString("utf-8"),
        mimeType: ext === ".csv" ? "text/csv" : "text/plain",
        sourceUrl: options.sourceUrl ?? null,
        profileId: options.profileId ?? null,
      };
    case ".html":
    case ".htm":
      return {
        title: basename,
        content: extractTextFromHtml(buffer.toString("utf-8")),
        mimeType: "text/html",
        sourceUrl: options.sourceUrl ?? null,
        profileId: options.profileId ?? null,
      };
    case ".pdf":
      return {
        title: basename,
        content: extractTextFromPdf(buffer),
        mimeType: "application/pdf",
        sourceUrl: options.sourceUrl ?? null,
        profileId: options.profileId ?? null,
      };
    case ".docx":
      return {
        title: basename,
        content: extractTextFromDocx(buffer),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sourceUrl: options.sourceUrl ?? null,
        profileId: options.profileId ?? null,
      };
    default:
      try {
        const text = buffer.toString("utf-8");
        if (text.includes("\0")) throw new Error("binary");
        return {
          title: basename,
          content: text,
          mimeType: "text/plain",
          sourceUrl: options.sourceUrl ?? null,
          profileId: options.profileId ?? null,
        };
      } catch {
        return {
          title: basename,
          content: `[Binary file: ${basename}, ${buffer.length} bytes]`,
          mimeType: "application/octet-stream",
          sourceUrl: options.sourceUrl ?? null,
          profileId: options.profileId ?? null,
        };
      }
  }
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromPdf(buffer: Buffer): string {
  const str = buffer.toString("latin1");
  const textBlocks: string[] = [];

  const btRegex = /BT[\s\S]*?ET/g;
  let match;
  while ((match = btRegex.exec(str)) !== null) {
    const block = match[0];
    const parenRegex = /\(([^)]*)\)/g;
    let tm;
    while ((tm = parenRegex.exec(block)) !== null) {
      if (tm[1]) textBlocks.push(tm[1]);
    }
    const hexRegex = /<([0-9A-Fa-f\s]+)>/g;
    let hm;
    while ((hm = hexRegex.exec(block)) !== null) {
      try {
        const hex = hm[1].replace(/\s/g, "");
        textBlocks.push(Buffer.from(hex, "hex").toString("utf-8"));
      } catch { /* ignore */ }
    }
  }

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let sm;
  while ((sm = streamRegex.exec(str)) !== null) {
    const parenRegex2 = /\(([^)]{3,})\)/g;
    let tm2;
    while ((tm2 = parenRegex2.exec(sm[1])) !== null) {
      if (tm2[1]) textBlocks.push(tm2[1]);
    }
  }

  const result = textBlocks.join(" ")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
  return result.trim() || `[PDF: ${buffer.length} bytes — text extraction limited]`;
}

function extractTextFromDocx(buffer: Buffer): string {
  try {
    const str = buffer.toString("utf-8");
    const parts: string[] = [];
    const regex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = regex.exec(str)) !== null) {
      parts.push(m[1]!);
    }
    return parts.join(" ").trim() || `[DOCX: text extraction limited]`;
  } catch {
    return `[DOCX: ${buffer.length} bytes — text extraction failed]`;
  }
}

// ---------------------------------------------------------------------------
// Text Chunking
// ---------------------------------------------------------------------------

export interface Chunk {
  index: number;
  content: string;
}

export function chunkText(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {},
): Chunk[] {
  const chunkSize = options.chunkSize ?? 1000;
  const overlap = options.overlap ?? 200;

  if (text.length <= chunkSize) {
    return [{ index: 0, content: text }];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let breakPoint = end;

    if (end < text.length) {
      const paraBreak = text.lastIndexOf("\n\n", end);
      if (paraBreak > start + chunkSize / 2) {
        breakPoint = paraBreak;
      } else {
        const sentenceBreak = Math.max(
          text.lastIndexOf(". ", end),
          text.lastIndexOf("! ", end),
          text.lastIndexOf("? ", end),
        );
        if (sentenceBreak > start + chunkSize / 2) {
          breakPoint = sentenceBreak + 1;
        }
      }
    }

    chunks.push({ index, content: text.slice(start, breakPoint).trim() });
    start = breakPoint - overlap;
    if (start <= 0 || start >= text.length) break;
    index++;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Embedding Providers
// ---------------------------------------------------------------------------

import { SemanticEmbeddingProvider } from "./semantic-embed.js";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

// Keep HashEmbeddingProvider as fallback, but prefer SemanticEmbeddingProvider
export class HashEmbeddingProvider implements EmbeddingProvider {
  private dims: number;
  constructor(dims: number = 384) {
    this.dims = dims;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.hashEmbed(text));
  }

  private hashEmbed(text: string): number[] {
    const vec = new Array(this.dims).fill(0) as number[];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      vec[code % this.dims] += 1;
      vec[(code * 31) % this.dims] += 0.5;
      vec[(code * 97 + i) % this.dims] += 0.25;
    }
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return mag > 0 ? vec.map((v) => v / mag) : vec;
  }
}

// Re-export for backward compat
export { SemanticEmbeddingProvider } from "./semantic-embed.js";

let _semanticProvider: SemanticEmbeddingProvider | null = null;

export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (!_semanticProvider) _semanticProvider = new SemanticEmbeddingProvider();
  return _semanticProvider;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    apiKey: string,
    baseUrl: string = "https://api.openai.com/v1",
    model: string = "text-embedding-3-small",
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Embedding API error: ${resp.status} ${err}`);
    }
    const data = (await resp.json()) as { data: { embedding: number[] }[] };
    return data.data.map((d) => d.embedding);
  }
}

// ---------------------------------------------------------------------------
// Local Vector Store (sql.js backed)
// ---------------------------------------------------------------------------

// Dynamically imported to avoid build-time dependency
import type { Database, SqlJsStatic } from "sql.js";
let embedDb: Database | null = null;
let embedSql: SqlJsStatic | null = null;

function getEmbeddingsDbPath(): string {
  return path.join(os.homedir(), ".carbon-agent", "embeddings.db");
}

async function ensureEmbedDb(): Promise<Database> {
  if (embedDb) return embedDb;
  const { default: initSqlJs } = await import("sql.js");
  embedSql = await initSqlJs({ locateFile: (f: string) => f });
  const dbPath = getEmbeddingsDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    embedDb = new embedSql.Database(fs.readFileSync(dbPath));
  } else {
    embedDb = new embedSql.Database();
  }

  embedDb.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      source_url TEXT,
      source_profile_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_workspace ON chunks(workspace_id);
  `);

  return embedDb;
}

export function saveEmbedDb(): void {
  if (embedDb) {
    const data = embedDb.export();
    fs.writeFileSync(getEmbeddingsDbPath(), Buffer.from(data));
  }
}

export interface StoredChunk {
  id: string;
  documentId: string;
  workspaceId: string;
  chunkIndex: number;
  content: string;
  embedding?: number[];
  sourceUrl: string | null;
  sourceProfileId: string | null;
}

export async function storeChunks(chunks: StoredChunk[]): Promise<void> {
  const db = await ensureEmbedDb();
  for (const c of chunks) {
    db.run(
      `INSERT INTO chunks (id, document_id, workspace_id, chunk_index, content, embedding, source_url, source_profile_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.documentId, c.workspaceId, c.chunkIndex, c.content, c.embedding ? JSON.stringify(c.embedding) : null, c.sourceUrl, c.sourceProfileId],
    );
  }
  saveEmbedDb();
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchChunks(
  workspaceId: string,
  query: string,
  limit = 5,
): Promise<StoredChunk[]> {
  const db = await ensureEmbedDb();
  const embedder = new HashEmbeddingProvider(8);
  const [queryEmbedding] = await embedder.embed([query]);

  const stmt = db.prepare("SELECT * FROM chunks WHERE workspace_id = ?");
  stmt.bind([workspaceId]);

  const candidates: { chunk: StoredChunk; score: number }[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    const embedding: number[] | undefined = r.embedding ? JSON.parse(String(r.embedding)) : undefined;

    let score = 0;
    if (embedding && embedding.length > 0) {
      score = cosineSimilarity(queryEmbedding, embedding);
    }

    candidates.push({
      chunk: {
        id: String(r.id),
        documentId: String(r.document_id),
        workspaceId: String(r.workspace_id),
        chunkIndex: Number(r.chunk_index),
        content: String(r.content),
        embedding,
        sourceUrl: r.source_url ? String(r.source_url) : null,
        sourceProfileId: r.source_profile_id ? String(r.source_profile_id) : null,
      },
      score,
    });
  }
  stmt.free();

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit).map((c) => c.chunk);
}

export async function deleteDocumentChunks(documentId: string): Promise<void> {
  const db = await ensureEmbedDb();
  db.run("DELETE FROM chunks WHERE document_id = ?", [documentId]);
  saveEmbedDb();
}

// ---------------------------------------------------------------------------
// File Scanner
// ---------------------------------------------------------------------------

export interface DetectedFile {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

function getDocumentsDir(): string {
  return path.join(os.homedir(), ".carbon-agent", "documents");
}

export * from "./graph-extractor.js";
export { runIngestionPipeline, IngestionPipeline, type MemoryAdapter, type PipelineDocument, type PipelineResult } from "./pipeline.js";

export function scanDocumentsDir(): DetectedFile[] {
  const docsDir = getDocumentsDir();
  if (!fs.existsSync(docsDir)) return [];

  const files: DetectedFile[] = [];
  for (const entry of fs.readdirSync(docsDir)) {
    const fullPath = path.join(docsDir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      const ext = path.extname(entry).toLowerCase();
      let mime = "application/octet-stream";
      if (ext === ".txt" || ext === ".md") mime = "text/plain";
      else if (ext === ".html" || ext === ".htm") mime = "text/html";
      else if (ext === ".pdf") mime = "application/pdf";
      else if (ext === ".docx")
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      else if (ext === ".csv") mime = "text/csv";
      files.push({ path: fullPath, name: entry, sizeBytes: stat.size, mimeType: mime });
    }
  }
  return files;
}
