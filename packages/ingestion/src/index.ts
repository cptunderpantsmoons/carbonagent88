/**
 * Ingestion — File Parsing, Chunking, Embedding, Local Vector Store
 *
 * Control Corridor:
 * - Owns: Parsing, chunking, indexing
 * - Must NOT own: Browser automation
 *
 * Uses pure-JS approaches: no native PDF/DOCX parsers.
 * For PDF/DOCX we extract what text we can; for HTML/TXT we do full extraction.
 * Embeddings use the configured AI provider (OpenAI embeddings API or local fallback).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// File Parsing (Phase 4.3)
// ---------------------------------------------------------------------------

export interface ParsedDocument {
  title: string;
  content: string;
  mimeType: string;
  sourceUrl: string | null;
  profileId: string | null;
}

export function parseFile(filePath: string, options: { sourceUrl?: string; profileId?: string } = {}): ParsedDocument {
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
      // Pure-JS PDF text extraction: look for text streams in the PDF binary
      return {
        title: basename,
        content: extractTextFromPdf(buffer),
        mimeType: "application/pdf",
        sourceUrl: options.sourceUrl ?? null,
        profileId: options.profileId ?? null,
      };

    case ".docx":
      // DOCX is a zip of XML — extract text from word/document.xml
      return {
        title: basename,
        content: extractTextFromDocx(buffer),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sourceUrl: options.sourceUrl ?? null,
        profileId: options.profileId ?? null,
      };

    default:
      // Try to read as text, fallback to base64 description
      try {
        const text = buffer.toString("utf-8");
        if (text.includes("\u0000")) throw new Error("Binary file");
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
  // Simple regex-based HTML tag stripping
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromPdf(buffer: Buffer): string {
  const str = buffer.toString("latin1");
  // PDF text objects: look for (text) or <text> inside BT...ET blocks
  const textBlocks: string[] = [];
  const btRegex = /BT[\s\S]*?ET/g;
  let match;
  while ((match = btRegex.exec(str)) !== null) {
    const block = match[0];
    // Extract text in parentheses (PDF string literals)
    const parenRegex = /\(([^)]*)\)/g;
    let tm;
    while ((tm = parenRegex.exec(block)) !== null) {
      if (tm[1]) textBlocks.push(tm[1]);
    }
    // Also hex strings <...>
    const hexRegex = /<([0-9A-Fa-f\s]+)>/g;
    let hm;
    while ((hm = hexRegex.exec(block)) !== null) {
      try {
        const hex = hm[1].replace(/\s/g, "");
        const bytes = Buffer.from(hex, "hex");
        textBlocks.push(bytes.toString("utf-8"));
      } catch { /* ignore */ }
    }
  }

  // Also look for stream objects with text
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let sm;
  while ((sm = streamRegex.exec(str)) !== null) {
    const stream = sm[1];
    const parenRegex2 = /\(([^)]{3,})\)/g;
    let tm2;
    while ((tm2 = parenRegex2.exec(stream)) !== null) {
      if (tm2[1]) textBlocks.push(tm2[1]);
    }
  }

  const result = textBlocks.join(" ").replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
  return result.trim() || `[PDF: ${buffer.length} bytes — text extraction limited]`;
}

function extractTextFromDocx(buffer: Buffer): string {
  try {
    // DOCX is a ZIP file — we need to read word/document.xml
    // Since we don't have a zip library, do a simple scan for text between <w:t> tags
    const str = buffer.toString("utf-8");
    const textParts: string[] = [];
    const regex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
      textParts.push(match[1]);
    }
    return textParts.join(" ").trim() || `[DOCX: text extraction limited]`;
  } catch {
    return `[DOCX: ${buffer.length} bytes — text extraction failed]`;
  }
}

// ---------------------------------------------------------------------------
// Text Chunking (Phase 4.3)
// ---------------------------------------------------------------------------

export interface Chunk {
  index: number;
  content: string;
  embedding?: number[];
}

export function chunkText(text: string, options: { chunkSize?: number; overlap?: number } = {}): Chunk[] {
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
    // Try to break at a sentence or paragraph boundary
    let breakPoint = end;
    if (end < text.length) {
      // Look for paragraph break
      const paraBreak = text.lastIndexOf("\n\n", end);
      if (paraBreak > start + chunkSize / 2) {
        breakPoint = paraBreak;
      } else {
        // Look for sentence break
        const sentenceBreak = Math.max(
          text.lastIndexOf(". ", end),
          text.lastIndexOf("! ", end),
          text.lastIndexOf("? ", end)
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
// Local Vector Store (SQLite-based, Phase 4.4)
// ---------------------------------------------------------------------------

// sql.js is dynamically imported to avoid build-time dependency issues

let embedDb: any = null;
let embedSql: any = null;

function getEmbeddingsDbPath(): string {
  return path.join(os.homedir(), ".carbon-agent", "embeddings.db");
}

async function ensureEmbedDb(): Promise<any> {
  if (embedDb) return embedDb;
  const { default: initSqlJs } = await import("sql.js");
  embedSql = await initSqlJs({ locateFile: (f: string) => f });
  const dbPath = getEmbeddingsDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    embedDb = new embedSql.Database(buf);
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
      embedding TEXT, -- JSON array of floats
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.documentId, c.workspaceId, c.chunkIndex, c.content, c.embedding ? JSON.stringify(c.embedding) : null, c.sourceUrl, c.sourceProfileId]
    );
  }
  saveEmbedDb();
}

export async function searchChunks(workspaceId: string, query: string, limit: number = 5): Promise<StoredChunk[]> {
  const db = await ensureEmbedDb();
  // Simple keyword search fallback when no embeddings
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return [];

  const likeClause = words.map(() => "LOWER(content) LIKE ?").join(" AND ");
  const params = words.map(w => `%${w}%`);

  const stmt = db.prepare(`SELECT * FROM chunks WHERE workspace_id = ? AND ${likeClause} ORDER BY chunk_index LIMIT ?`);
  stmt.bind([workspaceId, ...params, limit]);

  const rows: StoredChunk[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    rows.push({
      id: r.id as string,
      documentId: r.document_id as string,
      workspaceId: r.workspace_id as string,
      chunkIndex: r.chunk_index as number,
      content: r.content as string,
      embedding: r.embedding ? JSON.parse(r.embedding as string) : undefined,
      sourceUrl: r.source_url as string | null,
      sourceProfileId: r.source_profile_id as string | null,
    });
  }
  stmt.free();
  return rows;
}

export async function deleteDocumentChunks(documentId: string): Promise<void> {
  const db = await ensureEmbedDb();
  db.run("DELETE FROM chunks WHERE document_id = ?", [documentId]);
  saveEmbedDb();
}

// ---------------------------------------------------------------------------
// File Watcher / Scanner (Phase 4.2)
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
      else if (ext === ".docx") mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      else if (ext === ".csv") mime = "text/csv";
      files.push({ path: fullPath, name: entry, sizeBytes: stat.size, mimeType: mime });
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Embedding Generation (Phase 4.3)
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Simple hash-based embedding fallback when no AI provider is available.
 * NOT for production — use real embeddings from OpenAI/Anthropic.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  private dims = 384;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.hashEmbed(text));
  }

  private hashEmbed(text: string): number[] {
    const vec = new Array(this.dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      vec[code % this.dims] += 1;
      vec[(code * 31) % this.dims] += 0.5;
      vec[(code * 97 + i) % this.dims] += 0.25;
    }
    // Normalize
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return mag > 0 ? vec.map(v => v / mag) : vec;
  }
}

/**
 * OpenAI embedding provider (requires API key).
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl: string = "https://api.openai.com/v1", model: string = "text-embedding-3-small") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Embedding API error: ${resp.status} ${err}`);
    }
    const data = await resp.json() as { data: { embedding: number[] }[] };
    return data.data.map(d => d.embedding);
  }
}
