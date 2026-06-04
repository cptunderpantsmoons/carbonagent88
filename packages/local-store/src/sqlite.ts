import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import path from "node:path";
import fs from "node:fs";
import { getDatabasePath } from "./paths";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmDir = path.join(__dirname, "..", "node_modules", "sql.js", "dist");

/**
 * SQLite Database Adapter (sql.js)
 * 
 * Pure JS SQLite — no native deps. Async init, sync operations.
 * Load DB at startup, save on shutdown.
 */

let sqlJs: SqlJsStatic | null = null;
let dbInstance: Database | null = null;
let currentDbPath = getDatabasePath();

async function initEngine(): Promise<SqlJsStatic> {
  if (sqlJs) return sqlJs;
  sqlJs = await initSqlJs({
        locateFile: (file: string): string => path.join(wasmDir, file),
  });
  return sqlJs;
}

function loadOrCreateDb(): Database {
  const dbFile = currentDbPath;
  const dir = path.dirname(dbFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(dbFile)) {
    const buffer = fs.readFileSync(dbFile);
    return new sqlJs!.Database(buffer as Uint8Array);
  }
  return new sqlJs!.Database();
}

function saveDb(db: Database): void {
  const data = db.export();
  fs.writeFileSync(currentDbPath, Buffer.from(data));
}

async function ensureDb(): Promise<Database> {
  if (!sqlJs) {
    await initEngine();
    dbInstance = loadOrCreateDb();
  }
  if (!dbInstance) {
    throw new Error("Database not initialized");
  }
  return dbInstance;
}

export async function initDatabase(path?: string): Promise<void> {
  if (path) currentDbPath = path;
  await initEngine();
  dbInstance = loadOrCreateDb();
  initTables();
}

export function saveDatabase(): void {
  if (dbInstance) saveDb(dbInstance);
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

function initTables(): void {
  if (!dbInstance) return;
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, vault_dir TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('anthropic','openai','custom-openai')),
      name TEXT NOT NULL, api_key TEXT NOT NULL, base_url TEXT, model TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS browser_profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, profile_dir TEXT NOT NULL,
      target_domains TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('active','expired','unknown','locked')),
      last_checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider_id TEXT REFERENCES ai_providers(id),
      status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','paused','completed','failed','cancelled')),
      model TEXT, jsonl_log_path TEXT NOT NULL,
      started_at TEXT, completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('file','browser_download','web_scrape')),
      name TEXT NOT NULL, path TEXT NOT NULL, mime_type TEXT, size_bytes INTEGER,
      source_url TEXT, profile_id TEXT REFERENCES browser_profiles(id),
      ingested_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
      title TEXT NOT NULL, content TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL, content TEXT NOT NULL,
      source_url TEXT, source_profile_id TEXT REFERENCES browser_profiles(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_document_chunks_workspace ON document_chunks(workspace_id);
    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
      chunks_created INTEGER NOT NULL DEFAULT 0, error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL CHECK(tool_name IN ('stealth_open','stealth_scrape','stealth_download','ingest_file','rag_retrieve','write_note')),
      input TEXT NOT NULL, output TEXT, error TEXT,
      started_at TEXT NOT NULL, completed_at TEXT
    );
  `);
}

// --- helpers ---
interface RowObj {
  [key: string]: unknown;
}

function getRow(db: Database, sql: string, params: unknown[] = []): RowObj | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(params as any);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

function getRows(db: Database, sql: string, params: unknown[] = []): RowObj[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as any);
  const rows: RowObj[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function runStmt(db: Database, sql: string, params: unknown[] = []): void {
  const stmt = db.prepare(sql);
  stmt.bind(params as any);
  stmt.step();
  stmt.free();
}

// --- public API ---
export class CarbonDatabase {
  async getWorkspace(id: string) {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM workspaces WHERE id = ?", [id]);
  }

  async listWorkspaces() {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM workspaces ORDER BY created_at DESC");
  }

  async createWorkspace(p: { id: string; name: string; description?: string; vaultDir: string }) {
    const db = await ensureDb();
    runStmt(db, "INSERT INTO workspaces (id, name, description, vault_dir) VALUES (?, ?, ?, ?)",
      [p.id, p.name, p.description ?? null, p.vaultDir]);
  }

  async getProvider(id: string) {
    const db = await ensureDb();
    return getRow(db, "SELECT id, type, name, base_url, model, created_at, updated_at FROM ai_providers WHERE id = ?", [id]);
  }

  async listProviders() {
    const db = await ensureDb();
    return getRows(db, "SELECT id, type, name, base_url, model, created_at, updated_at FROM ai_providers ORDER BY created_at DESC");
  }

  async createProvider(p: { id: string; type: string; name: string; apiKey: string; baseUrl?: string; model: string }) {
    const db = await ensureDb();
    runStmt(db, "INSERT INTO ai_providers (id, type, name, api_key, base_url, model) VALUES (?, ?, ?, ?, ?, ?)",
      [p.id, p.type, p.name, p.apiKey, p.baseUrl ?? null, p.model]);
  }

  async updateProvider(p: { id: string; type?: string; name?: string; apiKey?: string; baseUrl?: string; model?: string }) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    for (const k of ["type", "name", "apiKey", "baseUrl", "model"] as const) {
      if (p[k] !== undefined) { fields.push(`${k} = ?`); vals.push(p[k]); }
    }
    vals.push(p.id);
    runStmt(db, `UPDATE ai_providers SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async deleteProvider(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM ai_providers WHERE id = ?", [id]);
  }

  async getProfile(id: string) {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM browser_profiles WHERE id = ?", [id]);
  }

  async listProfiles() {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM browser_profiles ORDER BY created_at DESC");
  }

  async createProfile(p: { id: string; name: string; description?: string; profileDir: string; targetDomains: string[] }) {
    const db = await ensureDb();
    runStmt(db, "INSERT INTO browser_profiles (id, name, description, profile_dir, target_domains) VALUES (?, ?, ?, ?, ?)",
      [p.id, p.name, p.description ?? null, p.profileDir, JSON.stringify(p.targetDomains)]);
  }

  async updateProfile(p: { id: string; name?: string; description?: string; profileDir?: string; targetDomains?: string[]; status?: string; lastCheckedAt?: string }) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    for (const k of ["name", "description", "profileDir", "status", "lastCheckedAt"] as const) {
      if (p[k] !== undefined) { fields.push(`${k} = ?`); vals.push(p[k]); }
    }
    if (p.targetDomains !== undefined) { fields.push("target_domains = ?"); vals.push(JSON.stringify(p.targetDomains)); }
    vals.push(p.id);
    runStmt(db, `UPDATE browser_profiles SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async deleteProfile(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM browser_profiles WHERE id = ?", [id]);
  }

  async getConversation(id: string) {
    const db = await ensureDb();
    return getRow(db, `SELECT c.*, json_group_array(json_object('id',m.id,'role',m.role,'content',m.content,'created_at',m.created_at)) as messages
      FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id WHERE c.id = ? GROUP BY c.id`, [id]);
  }

  async listConversations(workspaceId: string) {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM conversations WHERE workspace_id = ? ORDER BY updated_at DESC", [workspaceId]);
  }

  async createConversation(p: { id: string; workspaceId: string }) {
    const db = await ensureDb();
    runStmt(db, "INSERT INTO conversations (id, workspace_id) VALUES (?, ?)", [p.id, p.workspaceId]);
  }

  async deleteConversation(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM conversations WHERE id = ?", [id]);
  }

  async addMessage(p: { id: string; conversationId: string; role: string; content: string }) {
    const db = await ensureDb();
    runStmt(db, "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
      [p.id, p.conversationId, p.role, p.content]);
  }

  async updateConversationTitle(id: string, title: string) {
    const db = await ensureDb();
    runStmt(db, "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?", [title, id]);
  }

  async getRun(id: string) {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM runs WHERE id = ?", [id]);
  }

  async listRuns(conversationId: string) {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM runs WHERE conversation_id = ? ORDER BY created_at DESC", [conversationId]);
  }

  async createRun(p: { id: string; conversationId: string; workspaceId: string; providerId: string | null; jsonlLogPath: string }) {
    const db = await ensureDb();
    runStmt(db, "INSERT INTO runs (id, conversation_id, workspace_id, provider_id, jsonl_log_path, status) VALUES (?, ?, ?, ?, ?, 'idle')",
      [p.id, p.conversationId, p.workspaceId, p.providerId, p.jsonlLogPath]);
  }

  async updateRunStatus(id: string, status: string, extra: { model?: string; startedAt?: string; completedAt?: string } = {}) {
    const db = await ensureDb();
    const fields: string[] = ["status = ?", "updated_at = datetime('now')"];
    const vals: unknown[] = [status];
    if (extra.model) { fields.push("model = ?"); vals.push(extra.model); }
    if (extra.startedAt) { fields.push("started_at = ?"); vals.push(extra.startedAt); }
    if (extra.completedAt) { fields.push("completed_at = ?"); vals.push(extra.completedAt); }
    vals.push(id);
    runStmt(db, `UPDATE runs SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async addToolCall(p: { id: string; runId: string; toolName: string; input: string; output?: string; error?: string }) {
    const db = await ensureDb();
    runStmt(db, `INSERT INTO tool_calls (id, run_id, tool_name, input, output, error, started_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [p.id, p.runId, p.toolName, p.input, p.output ?? null, p.error ?? null]);
  }

  async completeToolCall(id: string, output?: string, error?: string) {
    const db = await ensureDb();
    if (output !== undefined || error !== undefined) {
      const fields: string[] = ["completed_at = datetime('now')"];
      const vals: unknown[] = [];
      if (output !== undefined) { fields.push("output = ?"); vals.push(output); }
      if (error !== undefined) { fields.push("error = ?"); vals.push(error); }
      vals.push(id);
      runStmt(db, `UPDATE tool_calls SET ${fields.join(", ")} WHERE id = ?`, vals);
    } else {
      runStmt(db, "UPDATE tool_calls SET completed_at = datetime('now') WHERE id = ?", [id]);
    }
  }
}
