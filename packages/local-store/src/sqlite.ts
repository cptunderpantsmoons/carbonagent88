import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import path from "node:path";
import fs from "node:fs";
import { getDatabasePath } from "./paths";
import { fileURLToPath } from "node:url";
import { encrypt, decrypt } from "./crypto";

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

export async function ensureDb(): Promise<Database> {
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
      cdp_url TEXT, cdp_fingerprint TEXT,
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
    CREATE TABLE IF NOT EXISTS watchers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      cron_expression TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      profile_id TEXT REFERENCES browser_profiles(id),
      last_run_at TEXT, last_run_status TEXT CHECK(last_run_status IN ('success','failed','running','pending')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureBrowserProfileColumns();
  ensureWatcherColumns();
}

function ensureBrowserProfileColumns(): void {
  if (!dbInstance) return;
  const columns = getRows(dbInstance, "PRAGMA table_info(browser_profiles)");
  const names = new Set(columns.map((column) => String(column.name)));
  if (!names.has("cdp_url")) {
    dbInstance.exec("ALTER TABLE browser_profiles ADD COLUMN cdp_url TEXT");
  }
  if (!names.has("cdp_fingerprint")) {
    dbInstance.exec("ALTER TABLE browser_profiles ADD COLUMN cdp_fingerprint TEXT");
  }
}

function ensureWatcherColumns(): void {
  if (!dbInstance) return;
  const columns = getRows(dbInstance, "PRAGMA table_info(watchers)");
  const names = new Set(columns.map((column) => String(column.name)));
  if (!names.has("name")) {
    dbInstance.exec("ALTER TABLE watchers ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("profile_id")) {
    dbInstance.exec("ALTER TABLE watchers ADD COLUMN profile_id TEXT REFERENCES browser_profiles(id)");
  }
}

// --- helpers ---
interface RowObj {
  [key: string]: unknown;
}

function inferDocumentFormat(filePath: string, mimeType?: string | null): "markdown" | "docx" | "pdf" | "unknown" {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".docx") return "docx";
  if (ext === ".pdf") return "pdf";
  if (mimeType === "text/markdown" || mimeType === "text/plain") return "markdown";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "application/pdf") return "pdf";
  return "unknown";
}

function buildPreview(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function getRow(db: Database, sql: string, params: unknown[] = []): RowObj | undefined {
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

export function getRows(db: Database, sql: string, params: unknown[] = []): RowObj[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as any);
  const rows: RowObj[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function runStmt(db: Database, sql: string, params: unknown[] = []): void {
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

  async getProviderWithKey(id: string) {
    const db = await ensureDb();
    const row = getRow(db, "SELECT id, type, name, api_key, base_url, model, created_at, updated_at FROM ai_providers WHERE id = ?", [id]);
    if (row && row.api_key) {
      try {
        row.api_key = decrypt(row.api_key as string);
      } catch {
        // If decryption fails, assume it was stored plaintext (migration)
      }
    }
    return row;
  }

  async listProviders() {
    const db = await ensureDb();
    return getRows(db, "SELECT id, type, name, base_url, model, created_at, updated_at FROM ai_providers ORDER BY created_at DESC");
  }

  async listProvidersWithKeys() {
    const db = await ensureDb();
    const rows = getRows(db, "SELECT id, type, name, api_key, base_url, model, created_at, updated_at FROM ai_providers ORDER BY created_at DESC");
    for (const row of rows) {
      if (row.api_key) {
        try {
          row.api_key = decrypt(row.api_key as string);
        } catch {
          // Plaintext fallback
        }
      }
    }
    return rows;
  }

  async createProvider(p: { id: string; type: string; name: string; apiKey: string; baseUrl?: string; model: string }) {
    const db = await ensureDb();
    const encryptedKey = encrypt(p.apiKey);
    runStmt(db, "INSERT INTO ai_providers (id, type, name, api_key, base_url, model) VALUES (?, ?, ?, ?, ?, ?)",
      [p.id, p.type, p.name, encryptedKey, p.baseUrl ?? null, p.model]);
  }

  async updateProvider(p: { id: string; type?: string; name?: string; apiKey?: string; baseUrl?: string; model?: string }) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.type !== undefined) { fields.push("type = ?"); vals.push(p.type); }
    if (p.name !== undefined) { fields.push("name = ?"); vals.push(p.name); }
    if (p.baseUrl !== undefined) { fields.push("base_url = ?"); vals.push(p.baseUrl); }
    if (p.model !== undefined) { fields.push("model = ?"); vals.push(p.model); }
    if (p.apiKey !== undefined) { fields.push("api_key = ?"); vals.push(encrypt(p.apiKey)); }
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

  async createProfile(p: { id: string; name: string; description?: string; profileDir?: string; cdpUrl?: string; cdpFingerprint?: string; targetDomains: string[] }) {
    const db = await ensureDb();
    runStmt(db, "INSERT INTO browser_profiles (id, name, description, profile_dir, cdp_url, cdp_fingerprint, target_domains) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [p.id, p.name, p.description ?? null, p.profileDir ?? null, p.cdpUrl ?? null, p.cdpFingerprint ?? null, JSON.stringify(p.targetDomains)]);
  }

  async updateProfile(p: { id: string; name?: string; description?: string; profileDir?: string; cdpUrl?: string; cdpFingerprint?: string; targetDomains?: string[]; status?: string; lastCheckedAt?: string }) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.name !== undefined) { fields.push("name = ?"); vals.push(p.name); }
    if (p.description !== undefined) { fields.push("description = ?"); vals.push(p.description); }
    if (p.profileDir !== undefined) { fields.push("profile_dir = ?"); vals.push(p.profileDir); }
    if (p.cdpUrl !== undefined) { fields.push("cdp_url = ?"); vals.push(p.cdpUrl); }
    if (p.cdpFingerprint !== undefined) { fields.push("cdp_fingerprint = ?"); vals.push(p.cdpFingerprint); }
    if (p.status !== undefined) { fields.push("status = ?"); vals.push(p.status); }
    if (p.lastCheckedAt !== undefined) { fields.push("last_checked_at = ?"); vals.push(p.lastCheckedAt); }
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

  async countRunningRuns() {
    const db = await ensureDb();
    const row = getRow(db, "SELECT COUNT(*) AS count FROM runs WHERE status = 'running'");
    return Number(row?.count ?? 0);
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

  // ---------------------------------------------------------------------------
  // DataSource & Document (ingestion pipeline)
  // ---------------------------------------------------------------------------

  async createDataSource(p: {
    id: string;
    workspaceId: string;
    type: "file" | "browser_download" | "web_scrape";
    name: string;
    path: string;
    mimeType?: string;
    sizeBytes?: number;
    sourceUrl?: string;
    profileId?: string;
  }) {
    const db = await ensureDb();
    runStmt(db,
      `INSERT INTO data_sources (id, workspace_id, type, name, path, mime_type, size_bytes, source_url, profile_id, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [p.id, p.workspaceId, p.type, p.name, p.path, p.mimeType ?? null, p.sizeBytes ?? null, p.sourceUrl ?? null, p.profileId ?? null]
    );
  }

  async createDocument(p: {
    id: string;
    workspaceId: string;
    dataSourceId: string;
    title: string;
    content: string;
  }) {
    const db = await ensureDb();
    runStmt(db,
      `INSERT INTO documents (id, workspace_id, data_source_id, title, content, chunk_count)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [p.id, p.workspaceId, p.dataSourceId, p.title, p.content]
    );
  }

  async listDocuments(workspaceId: string) {
    const db = await ensureDb();
    const rows = getRows(db,
      `SELECT
         d.id,
         d.workspace_id,
         d.data_source_id,
         d.title,
         d.content,
         d.chunk_count,
         d.created_at,
         d.updated_at,
         ds.path AS file_path,
         ds.mime_type,
         ds.size_bytes,
         ds.source_url,
         ds.profile_id
       FROM documents d
       JOIN data_sources ds ON ds.id = d.data_source_id
       WHERE d.workspace_id = ?
       ORDER BY d.created_at DESC`,
      [workspaceId]
    );

    return rows.map((row) => {
      const filePath = String(row.file_path ?? "");
      const mimeType = row.mime_type ? String(row.mime_type) : null;
      const content = String(row.content ?? "");
      return {
        ...row,
        format: inferDocumentFormat(filePath, mimeType),
        preview: buildPreview(content),
      };
    });
  }

  async updateDocumentChunkCount(documentId: string, chunkCount: number) {
    const db = await ensureDb();
    runStmt(db,
      `UPDATE documents SET chunk_count = ?, updated_at = datetime('now') WHERE id = ?`,
      [chunkCount, documentId]
    );
  }

  async createIngestionJob(p: { id: string; documentId: string }) {
    const db = await ensureDb();
    runStmt(db,
      `INSERT INTO ingestion_jobs (id, document_id, status, chunks_created) VALUES (?, ?, 'completed', 0)`,
      [p.id, p.documentId]
    );
  }

  async updateIngestionJob(id: string, p: { status: string; chunksCreated?: number; error?: string }) {
    const db = await ensureDb();
    const fields: string[] = ["status = ?", "updated_at = datetime('now')"];
    const vals: unknown[] = [p.status];
    if (p.chunksCreated !== undefined) { fields.push("chunks_created = ?"); vals.push(p.chunksCreated); }
    if (p.error !== undefined) { fields.push("error = ?"); vals.push(p.error); }
    vals.push(id);
    runStmt(db, `UPDATE ingestion_jobs SET ${fields.join(", ")} WHERE id = ?`, vals);
  }


  async getWatcher(id: string) {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM watchers WHERE id = ?", [id]);
  }

  async listWatchers() {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM watchers ORDER BY created_at DESC");
  }

  async listSkills(workspaceId: string) {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM skills WHERE workspace_id = ? ORDER BY pinned DESC, success_count DESC, created_at DESC", [workspaceId]);
  }

  async toggleSkillPin(id: string, pinned: boolean) {
    const db = await ensureDb();
    runStmt(db, "UPDATE skills SET pinned = ?, updated_at = datetime('now') WHERE id = ?", [pinned ? 1 : 0, id]);
  }

  async deleteSkill(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM skills WHERE id = ?", [id]);
  }

  async createWatcher(p: { id: string; workspaceId: string; name: string; cronExpression: string; prompt: string; enabled: boolean; profileId?: string | null }) {
    const db = await ensureDb();
    runStmt(db, "INSERT INTO watchers (id, workspace_id, name, cron_expression, prompt, enabled, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [p.id, p.workspaceId, p.name, p.cronExpression, p.prompt, p.enabled ? 1 : 0, p.profileId ?? null]);
  }

  async updateWatcher(p: { id: string; name?: string; profileId?: string | null; cronExpression?: string; prompt?: string; enabled?: boolean; lastRunAt?: string; lastRunStatus?: string }) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.name !== undefined) { fields.push("name = ?"); vals.push(p.name); }
    if (p.profileId !== undefined) { fields.push("profile_id = ?"); vals.push(p.profileId); }
    if (p.cronExpression !== undefined) { fields.push("cron_expression = ?"); vals.push(p.cronExpression); }
    if (p.prompt !== undefined) { fields.push("prompt = ?"); vals.push(p.prompt); }
    if (p.enabled !== undefined) { fields.push("enabled = ?"); vals.push(p.enabled ? 1 : 0); }
    if (p.lastRunAt !== undefined) { fields.push("last_run_at = ?"); vals.push(p.lastRunAt); }
    if (p.lastRunStatus !== undefined) { fields.push("last_run_status = ?"); vals.push(p.lastRunStatus); }
    vals.push(p.id);
    runStmt(db, `UPDATE watchers SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async deleteWatcher(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM watchers WHERE id = ?", [id]);
  }
}
