import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { getDatabasePath } from "./paths.js";
import { fileURLToPath } from "node:url";
import { encrypt, decrypt } from "./crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveWasmDir(): string {
  try {
    // Create a require function to resolve sql.js WASM path
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    return path.dirname(wasmPath);
  } catch {
    // Fallback
    return path.join(__dirname, "..", "node_modules", "sql.js", "dist");
  }
}

const wasmDir = resolveWasmDir();

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

export function flushDb(): void {
  if (dbInstance) {
    saveDb(dbInstance);
  }
}

export function closeDb(): void {
  flushDb();
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  sqlJs = null;
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
    CREATE TABLE IF NOT EXISTS orchestration_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      root_kind TEXT NOT NULL,
      root_json TEXT NOT NULL,
      supervision_mode TEXT NOT NULL CHECK(supervision_mode IN ('watch','confirm')),
      status TEXT NOT NULL CHECK(status IN ('draft','running','waiting','completed','failed','cancelled')),
      current_goal TEXT NOT NULL,
      completion_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orchestration_session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_orchestration_session_events_session ON orchestration_session_events(session_id, created_at, id);
    CREATE TABLE IF NOT EXISTS orchestration_working_sets (
      session_id TEXT PRIMARY KEY REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
      entities_json TEXT NOT NULL DEFAULT '[]',
      documents_json TEXT NOT NULL DEFAULT '[]',
      metrics_json TEXT NOT NULL DEFAULT '[]',
      gaps_json TEXT NOT NULL DEFAULT '[]',
      provenance_score REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS browser_sessions (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES browser_profiles(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','completed','failed','cancelled')),
      headless INTEGER NOT NULL DEFAULT 1,
      cdp_port INTEGER,
      target_url TEXT,
      cookies_json TEXT,
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
      tool_name TEXT NOT NULL CHECK(tool_name IN ('stealth_open','stealth_scrape','stealth_download','ingest_file','rag_retrieve','write_note','delegate_task','memory_recall','memory_store')),
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
    CREATE TABLE IF NOT EXISTS harness_configs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      harness_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      task_template TEXT,
      quality_gates_json TEXT NOT NULL DEFAULT '[]',
      extra_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace_id, harness_id)
    );
    CREATE INDEX IF NOT EXISTS idx_harness_configs_workspace ON harness_configs(workspace_id);

    -- Episodic memory (temporal events)
    CREATE TABLE IF NOT EXISTS episodic_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('conversation', 'task', 'tool_use', 'decision', 'error')),
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure', 'partial')),
      embedding_json TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      access_count INTEGER NOT NULL DEFAULT 0,
      decay_factor REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_workspace ON episodic_events(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_events(type);
    CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_events(importance DESC);

    -- Graph nodes (entities)
    CREATE TABLE IF NOT EXISTS memory_graph_nodes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      properties_json TEXT NOT NULL DEFAULT '{}',
      embedding_json TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace_id, name, entity_type)
    );
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_workspace ON memory_graph_nodes(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON memory_graph_nodes(entity_type);

    -- Graph edges (relationships)
    CREATE TABLE IF NOT EXISTS memory_graph_edges (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES memory_graph_nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES memory_graph_nodes(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0.5,
      properties_json TEXT NOT NULL DEFAULT '{}',
      document_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON memory_graph_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON memory_graph_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_workspace ON memory_graph_edges(workspace_id);

    -- BM25 inverted index
    CREATE TABLE IF NOT EXISTS bm25_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      term TEXT NOT NULL,
      term_frequency REAL NOT NULL,
      document_frequency INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_bm25_term ON bm25_index(term);
    CREATE INDEX IF NOT EXISTS idx_bm25_workspace ON bm25_index(workspace_id);

    -- Memory consolidation log
    CREATE TABLE IF NOT EXISTS memory_consolidation_log (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      consolidated_count INTEGER NOT NULL,
      compressed_count INTEGER NOT NULL,
      forgotten_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Prompt cache
    CREATE TABLE IF NOT EXISTS prompt_cache (
      id TEXT PRIMARY KEY,
      prompt_hash TEXT NOT NULL UNIQUE,
      prompt_embedding_json TEXT NOT NULL,
      prompt_normalized TEXT NOT NULL,
      response TEXT NOT NULL,
      model TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_hit_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      ttl_ms INTEGER NOT NULL DEFAULT 3600000
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_cache_hash ON prompt_cache(prompt_hash);

    -- Response cache
    CREATE TABLE IF NOT EXISTS response_cache (
      id TEXT PRIMARY KEY,
      prompt_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      response TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_hit_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_response_cache_hash ON response_cache(prompt_hash, model);

    -- Cache metrics
    CREATE TABLE IF NOT EXISTS cache_metrics (
      id TEXT PRIMARY KEY,
      cache_type TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      hits INTEGER NOT NULL DEFAULT 0,
      misses INTEGER NOT NULL DEFAULT 0,
      tokens_saved INTEGER NOT NULL DEFAULT 0,
      cost_saved_usd REAL NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Skill variants
    CREATE TABLE IF NOT EXISTS skill_variants (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      parameters_json TEXT NOT NULL DEFAULT '{}',
      tool_sequence_json TEXT NOT NULL,
      trigger_pattern TEXT NOT NULL,
      success_rate REAL NOT NULL DEFAULT 0,
      execution_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      UNIQUE(skill_id, version)
    );

    -- Skill outcomes
    CREATE TABLE IF NOT EXISTS skill_outcomes (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      variant_id TEXT,
      workspace_id TEXT NOT NULL,
      success INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      error_type TEXT,
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_skill_outcomes_skill ON skill_outcomes(skill_id);
    CREATE INDEX IF NOT EXISTS idx_skill_outcomes_workspace ON skill_outcomes(workspace_id);

    -- Skill compositions
    CREATE TABLE IF NOT EXISTS skill_compositions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Skill versions
    CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      changelog TEXT NOT NULL,
      parent_version INTEGER,
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(skill_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_versions(skill_id);

    -- Bandit state
    CREATE TABLE IF NOT EXISTS skill_bandit_state (
      skill_id TEXT PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
      variant_id TEXT,
      alpha REAL NOT NULL DEFAULT 1.0,
      beta REAL NOT NULL DEFAULT 1.0,
      total_pulls INTEGER NOT NULL DEFAULT 0,
      last_pull_at TEXT
    );
  `);
  ensureBrowserProfileColumns();
  ensureWatcherColumns();
  ensureMemoryColumns();
}

function ensureBrowserProfileColumns(): void {
  if (!dbInstance) return;
  const columns = getRows(dbInstance, "PRAGMA table_info(browser_profiles)");
  const names = new Set(columns.map((column: RowObj) => String(column.name)));
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
  const names = new Set(columns.map((column: RowObj) => String(column.name)));
  if (!names.has("name")) {
    dbInstance.exec("ALTER TABLE watchers ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("profile_id")) {
    dbInstance.exec("ALTER TABLE watchers ADD COLUMN profile_id TEXT REFERENCES browser_profiles(id)");
  }
}

function ensureMemoryColumns(): void {
  if (!dbInstance) return;
  // This function is called after initTables to ensure all new tables exist
  // The tables are created with IF NOT EXISTS, so this is safe for existing databases
  // Additional column migrations can be added here if needed
}

/** Initialize database engine, load/create file, and create tables. Accepts optional path override for testing. */
export async function initDatabase(filePath?: string): Promise<void> {
  if (filePath) currentDbPath = filePath;
  await initEngine();
  dbInstance = loadOrCreateDb();
  initTables();
}

/** Save current in-memory database to disk (flush). */
export function saveDatabase(): void {
  flushDb();
}

/** Alias for closeDb — legacy export compatibility. */
export { closeDb as closeDatabase };

interface RowObj { [key: string]: unknown; }

function bindParams(params?: unknown[]): Array<string | number | Uint8Array | null> {
  if (!params) return [];
  // sql.js allows SqlValue[] 
  return params as Array<string | number | Uint8Array | null>;
}

export function getRow(
  db: Database,
  sql: string,
  params?: unknown[],
): RowObj | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(bindParams(params));
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row as RowObj;
  }
  stmt.free();
  return undefined;
}

export function getRows(
  db: Database,
  sql: string,
  params?: unknown[],
): RowObj[] {
  const stmt = db.prepare(sql);
  stmt.bind(bindParams(params));
  const rows: RowObj[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as RowObj);
  stmt.free();
  return rows;
}

export function runStmt(
  db: Database,
  sql: string,
  params?: unknown[],
): void {
  const stmt = db.prepare(sql);
  stmt.bind(bindParams(params));
  stmt.step();
  stmt.free();
}

function coerce<T>(value: unknown): T {
  return value as T;
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
    runStmt(
      db,
      "INSERT INTO workspaces (id, name, description, vault_dir, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.name, p.description ?? null, p.vaultDir],
    );
    return p.id;
  }

  async updateWorkspace(
    id: string,
    p: { name?: string; description?: string },
  ) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.name !== undefined) {
      fields.push("name = ?");
      vals.push(p.name);
    }
    if (p.description !== undefined) {
      fields.push("description = ?");
      vals.push(p.description);
    }
    vals.push(id);
    runStmt(db, `UPDATE workspaces SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async deleteWorkspace(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM workspaces WHERE id = ?", [id]);
  }

  async listProviders() {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM ai_providers ORDER BY created_at DESC");
  }

  async listProvidersWithKeys() {
    const db = await ensureDb();
    const rows = getRows(
      db,
      "SELECT id, type, name, api_key, base_url, model, created_at, updated_at FROM ai_providers ORDER BY created_at DESC",
    );
    for (const row of rows) {
      if (row.api_key) {
        try {
          row.api_key = decrypt(row.api_key as string);
        } catch {
          /* leave encrypted */
        }
      }
    }
    return rows;
  }

  async getProvider(id: string) {
    const db = await ensureDb();
    const row = getRow(
      db,
      "SELECT id, type, name, api_key, base_url, model, created_at, updated_at FROM ai_providers WHERE id = ?",
      [id],
    );
    if (row && row.api_key) {
      try {
        row.api_key = decrypt(row.api_key as string);
      } catch {
        /* already plaintext */
      }
    }
    return row;
  }

  async createProvider(p: {
    id: string;
    type: string;
    name: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
  }) {
    const db = await ensureDb();
    const encryptedKey = encrypt(p.apiKey);
    runStmt(
      db,
      "INSERT INTO ai_providers (id, type, name, api_key, base_url, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.type, p.name, encryptedKey, p.baseUrl ?? null, p.model],
    );
    return p.id;
  }

  async updateProvider(
    id: string | { id: string; type?: "anthropic" | "openai" | "custom-openai"; name?: string; apiKey?: string; baseUrl?: string; model?: string },
    p?: { type?: "anthropic" | "openai" | "custom-openai"; name?: string; apiKey?: string; baseUrl?: string; model?: string },
  ) {
    let targetId: string;
    let update: { type?: "anthropic" | "openai" | "custom-openai"; name?: string; apiKey?: string; baseUrl?: string; model?: string } | undefined;
    if (typeof id === "object") {
      const { id: i, ...rest } = id;
      targetId = i;
      update = rest;
    } else {
      targetId = id;
      update = p;
    }
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (!update) return;
    if (update.type !== undefined) {
      fields.push("type = ?");
      vals.push(update.type);
    }
    if (update.name !== undefined) {
      fields.push("name = ?");
      vals.push(update.name);
    }
    if (update.apiKey !== undefined) {
      fields.push("api_key = ?");
      vals.push(encrypt(update.apiKey));
    }
    if (update.baseUrl !== undefined) {
      fields.push("base_url = ?");
      vals.push(update.baseUrl);
    }
    if (update.model !== undefined) {
      fields.push("model = ?");
      vals.push(update.model);
    }
    vals.push(targetId);
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

  async createProfile(p: {
    id: string;
    name: string;
    description?: string;
    profileDir: string;
    cdpUrl?: string;
    cdpFingerprint?: string;
    targetDomains: string[];
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO browser_profiles (id, name, description, profile_dir, cdp_url, cdp_fingerprint, target_domains, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [
        p.id,
        p.name,
        p.description ?? null,
        p.profileDir,
        p.cdpUrl ?? null,
        p.cdpFingerprint ?? null,
        JSON.stringify(p.targetDomains),
        "unknown",
      ],
    );
    return p.id;
  }

  async updateProfile(
    id: string | ({
      id: string;
      name?: string;
      description?: string;
      profileDir?: string;
      targetDomains?: string[];
      status?: string;
      lastCheckedAt?: string | null;
      cdpUrl?: string | null;
      cdpFingerprint?: string | null;
    }),
    p?: {
      name?: string;
      description?: string;
      profileDir?: string;
      targetDomains?: string[];
      status?: string;
      lastCheckedAt?: string | null;
      cdpUrl?: string | null;
      cdpFingerprint?: string | null;
    },
  ) {
    let targetId: string;
    let update: {
      name?: string;
      description?: string;
      profileDir?: string;
      targetDomains?: string[];
      status?: string;
      lastCheckedAt?: string | null;
      cdpUrl?: string | null;
      cdpFingerprint?: string | null;
    } | undefined;
    if (typeof id === "object") {
      const { id: i, ...rest } = id;
      targetId = i;
      update = rest;
    } else {
      targetId = id;
      update = p;
    }
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (!update) return;
    if (update.name !== undefined) {
      fields.push("name = ?");
      vals.push(update.name);
    }
    if (update.description !== undefined) {
      fields.push("description = ?");
      vals.push(update.description);
    }
    if (update.profileDir !== undefined) {
      fields.push("profile_dir = ?");
      vals.push(update.profileDir);
    }
    if (update.targetDomains !== undefined) {
      fields.push("target_domains = ?");
      vals.push(JSON.stringify(update.targetDomains));
    }
    if (update.status !== undefined) {
      fields.push("status = ?");
      vals.push(update.status);
    }
    if (update.lastCheckedAt !== undefined) {
      fields.push("last_checked_at = ?");
      vals.push(update.lastCheckedAt);
    }
    if (update.cdpUrl !== undefined) {
      fields.push("cdp_url = ?");
      vals.push(update.cdpUrl);
    }
    if (update.cdpFingerprint !== undefined) {
      fields.push("cdp_fingerprint = ?");
      vals.push(update.cdpFingerprint);
    }
    vals.push(targetId);
    runStmt(db, `UPDATE browser_profiles SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async deleteProfile(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM browser_profiles WHERE id = ?", [id]);
  }

  async listSessions() {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM browser_sessions ORDER BY created_at DESC");
  }

  async createSession(p: {
    id: string;
    profileId: string;
    status: string;
    headless?: boolean;
    cdpPort?: number;
    targetUrl?: string;
    cookiesJson?: string;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO browser_sessions (id, profile_id, status, headless, cdp_port, target_url, cookies_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [
        p.id,
        p.profileId,
        p.status,
        p.headless ? 1 : 0,
        p.cdpPort ?? null,
        p.targetUrl ?? null,
        p.cookiesJson ?? null,
      ],
    );
    return p.id;
  }

  async updateSession(
    id: string,
    p: {
      status?: string;
      cdpPort?: number;
      cookiesJson?: string;
    },
  ) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.status !== undefined) {
      fields.push("status = ?");
      vals.push(p.status);
    }
    if (p.cdpPort !== undefined) {
      fields.push("cdp_port = ?");
      vals.push(p.cdpPort);
    }
    if (p.cookiesJson !== undefined) {
      fields.push("cookies_json = ?");
      vals.push(p.cookiesJson);
    }
    vals.push(id);
    runStmt(
      db,
      `UPDATE browser_sessions SET ${fields.join(", ")} WHERE id = ?`,
      vals,
    );
  }

  async deleteSession(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM browser_sessions WHERE id = ?", [id]);
  }

  // ==================== WATCHERS ====================
  async createWatcher(p: {
    id: string;
    workspaceId: string;
    profileId?: string | null;
    name: string;
    cronExpression: string;
    prompt: string;
    enabled: boolean;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO watchers (id, workspace_id, profile_id, name, cron_expression, prompt, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.workspaceId, p.profileId ?? null, p.name, p.cronExpression, p.prompt, p.enabled ? 1 : 0],
    );
    return p.id;
  }

  async listWatchersForWorkspace(workspaceId: string) {
    const db = await ensureDb();
    return getRows(
      db,
      "SELECT * FROM watchers WHERE workspace_id = ? ORDER BY created_at DESC",
      [workspaceId],
    );
  }

  async getWatcher(id: string) {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM watchers WHERE id = ?", [id]);
  }

  async updateWatcher(
    id: string,
    p: {
      name?: string;
      cronExpression?: string;
      enabled?: boolean;
      profileId?: string | null;
      prompt?: string;
      lastRunAt?: string;
      lastRunStatus?: string;
    },
  ) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.cronExpression !== undefined) {
      fields.push("cron_expression = ?");
      vals.push(p.cronExpression);
    }
    if (p.enabled !== undefined) {
      fields.push("enabled = ?");
      vals.push(p.enabled ? 1 : 0);
    }
    if (p.profileId !== undefined) {
      fields.push("profile_id = ?");
      vals.push(p.profileId ?? null);
    }
    if (p.prompt !== undefined) {
      fields.push("prompt = ?");
      vals.push(p.prompt);
    }
    if (p.lastRunAt !== undefined) {
      fields.push("last_run_at = ?");
      vals.push(p.lastRunAt);
    }
    if (p.lastRunStatus !== undefined) {
      fields.push("last_run_status = ?");
      vals.push(p.lastRunStatus);
    }
    if (p.name !== undefined) {
      fields.push("name = ?");
      vals.push(p.name);
    }
    vals.push(id);
    runStmt(
      db,
      `UPDATE watchers SET ${fields.join(", ")} WHERE id = ?`,
      vals,
    );
  }

  async updateWatcherLastRun(id: string) {
    const db = await ensureDb();
    runStmt(
      db,
      "UPDATE watchers SET last_run = ?, updated_at = datetime('now') WHERE id = ?",
      [new Date().toISOString(), id],
    );
  }

  async deleteWatcher(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM watchers WHERE id = ?", [id]);
  }

  // ==================== AGENTS & OUTPUTS ====================
  async createAgent(p: { id: string; configJson: string }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO agents (id, config_json, created_at) VALUES (?, ?, datetime('now'))",
      [p.id, p.configJson],
    );
  }

  async countRunningRuns() {
    const db = await ensureDb();
    const row = getRow(db, "SELECT COUNT(*) as count FROM agents", []);
    return Number(row?.count ?? 0);
  }

  // ==================== HARNESS CONFIGS ====================
  async listHarnessConfigs(
    workspaceId: string,
  ): Promise<
    Array<{
      id: string;
      workspace_id: string;
      harness_id: string;
      enabled: number;
      task_template: string;
      quality_gates_json: string;
      extra_json: string;
      created_at: string;
      updated_at: string;
    }>
  > {
    const db = await ensureDb();
    const rows = getRows(
      db,
      "SELECT * FROM harness_configs WHERE workspace_id = ? ORDER BY harness_id",
      [workspaceId],
    );
    return coerce(rows);
  }

  async getHarnessConfig(
    workspaceId: string,
    harnessId: string,
  ): Promise<
    | {
        id: string;
        workspace_id: string;
        harness_id: string;
        enabled: number;
        task_template: string;
        quality_gates_json: string;
        extra_json: string;
        created_at: string;
        updated_at: string;
      }
    | undefined
  > {
    const db = await ensureDb();
    const row = getRow(
      db,
      "SELECT * FROM harness_configs WHERE workspace_id = ? AND harness_id = ?",
      [workspaceId, harnessId],
    );
    return coerce(row);
  }

  async upsertHarnessConfig(p: {
    id: string;
    workspaceId: string;
    harnessId: string;
    enabled?: boolean;
    taskTemplate?: string;
    qualityGatesJson?: string;
    extraJson?: string;
  }): Promise<void> {
    const db = await ensureDb();
    const existing = getRow(
      db,
      "SELECT id FROM harness_configs WHERE workspace_id = ? AND harness_id = ?",
      [p.workspaceId, p.harnessId],
    );
    if (existing) {
      const fields: string[] = ["updated_at = datetime('now')"];
      const vals: unknown[] = [];
      if (p.enabled !== undefined) {
        fields.push("enabled = ?");
        vals.push(p.enabled ? 1 : 0);
      }
      if (p.taskTemplate !== undefined) {
        fields.push("task_template = ?");
        vals.push(p.taskTemplate);
      }
      if (p.qualityGatesJson !== undefined) {
        fields.push("quality_gates_json = ?");
        vals.push(p.qualityGatesJson);
      }
      if (p.extraJson !== undefined) {
        fields.push("extra_json = ?");
        vals.push(p.extraJson);
      }
      vals.push(existing.id as string);
      runStmt(
        db,
        `UPDATE harness_configs SET ${fields.join(", ")} WHERE id = ?`,
        vals,
      );
    } else {
      runStmt(
        db,
        `INSERT INTO harness_configs (id, workspace_id, harness_id, enabled, task_template, quality_gates_json, extra_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id,
          p.workspaceId,
          p.harnessId,
          p.enabled !== undefined ? (p.enabled ? 1 : 0) : 1,
          p.taskTemplate ?? null,
          p.qualityGatesJson ?? "[]",
          p.extraJson ?? "{}",
        ],
      );
    }
  }

  async deleteHarnessConfig(id: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM harness_configs WHERE id = ?", [id]);
  }

  // ==================== RUNS ====================
  async getRun(id: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM runs WHERE id = ?", [id]);
  }

  // ==================== CONVERSATIONS ====================
  async createConversation(p: { id: string; workspaceId: string; title?: string }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO conversations (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.workspaceId, p.title ?? "New Conversation"],
    );
    return p.id;
  }

  // ==================== DOCUMENTS ====================
  async listDocuments(workspaceId: string) {
    const db = await ensureDb();
    return getRows(
      db,
      `SELECT d.*, ds.path AS file_path
       FROM documents d
       JOIN data_sources ds ON d.data_source_id = ds.id
       WHERE d.workspace_id = ?
       ORDER BY d.created_at DESC`,
      [workspaceId],
    );
  }

  // ==================== SKILLS ====================
  async listSkills(workspaceId: string) {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM skills WHERE workspace_id = ? ORDER BY updated_at DESC", [workspaceId]);
  }

  async toggleSkillPin(id: string, pinned: boolean): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "UPDATE skills SET pinned = ?, updated_at = datetime('now') WHERE id = ?", [pinned ? 1 : 0, id]);
  }

  async deleteSkill(id: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM skills WHERE id = ?", [id]);
  }

  // ==================== WATCHERS (list all) ====================
  async listWatchers() {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM watchers ORDER BY created_at DESC");
  }

  // ==================== RUNS ====================
  async createRun(p: {
    id: string;
    conversationId: string;
    workspaceId: string;
    providerId?: string | null;
    jsonlLogPath: string;
    status?: string;
    model?: string;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO runs (id, conversation_id, workspace_id, provider_id, jsonl_log_path, status, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.conversationId, p.workspaceId, p.providerId ?? null, p.jsonlLogPath, p.status ?? "idle", p.model ?? null],
    );
    return p.id;
  }

  async updateRunStatus(
    id: string,
    status: string,
    meta?: { model?: string; startedAt?: string; completedAt?: string; error?: string | null },
  ) {
    const db = await ensureDb();
    const fields: string[] = ["status = ?", "updated_at = datetime('now')"];
    const vals: unknown[] = [status];
    if (meta?.model !== undefined) {
      fields.push("model = ?");
      vals.push(meta.model);
    }
    if (meta?.startedAt !== undefined) {
      fields.push("started_at = ?");
      vals.push(meta.startedAt);
    }
    if (meta?.completedAt !== undefined) {
      fields.push("completed_at = ?");
      vals.push(meta.completedAt);
    }
    vals.push(id);
    runStmt(db, `UPDATE runs SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async listRuns(workspaceId: string) {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM runs WHERE workspace_id = ? ORDER BY created_at DESC", [workspaceId]);
  }

  // ==================== MESSAGES ====================
  async addMessage(p: { id: string; conversationId: string; role: string; content: string }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
      [p.id, p.conversationId, p.role, p.content],
    );
  }

  // ==================== CONVERSATIONS ====================
  async listConversations(workspaceId: string) {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM conversations WHERE workspace_id = ? ORDER BY created_at DESC", [workspaceId]);
  }

  async getConversation(id: string) {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM conversations WHERE id = ?", [id]);
  }

  async deleteConversation(id: string) {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM conversations WHERE id = ?", [id]);
  }

  // ==================== DATA SOURCES ====================
  async createDataSource(p: {
    id: string;
    workspaceId: string;
    type: string;
    name: string;
    path: string;
    mimeType?: string;
    sizeBytes?: number;
    sourceUrl?: string;
    profileId?: string | null;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO data_sources (id, workspace_id, type, name, path, mime_type, size_bytes, source_url, profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
      [p.id, p.workspaceId, p.type, p.name, p.path, p.mimeType ?? null, p.sizeBytes ?? null, p.sourceUrl ?? null, p.profileId ?? null],
    );
    return p.id;
  }

  // ==================== DOCUMENTS ====================
  async createDocument(p: {
    id: string;
    workspaceId: string;
    dataSourceId: string;
    title: string;
    content: string;
    chunkCount?: number;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO documents (id, workspace_id, data_source_id, title, content, chunk_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.workspaceId, p.dataSourceId, p.title, p.content, p.chunkCount ?? 0],
    );
    return p.id;
  }

  // ==================== INGESTION JOBS ====================
  async createIngestionJob(p: {
    id: string;
    documentId: string;
    status?: string;
    chunksCreated?: number;
    error?: string | null;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO ingestion_jobs (id, document_id, status, chunks_created, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.documentId, p.status ?? "pending", p.chunksCreated ?? 0, p.error ?? null],
    );
    return p.id;
  }

  async updateIngestionJob(
    id: string,
    p: { status?: string; chunksCreated?: number; error?: string | null },
  ) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.status !== undefined) {
      fields.push("status = ?");
      vals.push(p.status);
    }
    if (p.chunksCreated !== undefined) {
      fields.push("chunks_created = ?");
      vals.push(p.chunksCreated);
    }
    if (p.error !== undefined) {
      fields.push("error = ?");
      vals.push(p.error);
    }
    vals.push(id);
    runStmt(db, `UPDATE ingestion_jobs SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async updateDocumentChunkCount(id: string, chunkCount: number) {
    const db = await ensureDb();
    runStmt(
      db,
      "UPDATE documents SET chunk_count = ?, updated_at = datetime('now') WHERE id = ?",
      [chunkCount, id],
    );
  }

  // ==================== PROVIDER HELPERS ====================
  async getProviderWithKey(id: string) {
    return this.getProvider(id);
  }

  // ==================== ORCHESTRATION SESSIONS ====================
  async createOrchestrationSession(p: {
    id: string;
    workspaceId: string;
    conversationId: string;
    runId: string;
    rootKind: string;
    rootJson: string;
    supervisionMode: string;
    status: string;
    currentGoal: string;
    completionSummary?: string | null;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO orchestration_sessions
        (id, workspace_id, conversation_id, run_id, root_kind, root_json,
         supervision_mode, status, current_goal, completion_summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        p.id,
        p.workspaceId,
        p.conversationId,
        p.runId,
        p.rootKind,
        p.rootJson,
        p.supervisionMode,
        p.status,
        p.currentGoal,
        p.completionSummary ?? null,
      ],
    );
  }

  async getOrchestrationSession(id: string) {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM orchestration_sessions WHERE id = ?", [id]);
  }

  async updateOrchestrationSessionStatus(id: string, status: string, completionSummary?: string | null) {
    const db = await ensureDb();
    const fields: string[] = ["status = ?", "updated_at = datetime('now')"];
    const vals: unknown[] = [status];
    if (completionSummary !== undefined) {
      fields.push("completion_summary = ?");
      vals.push(completionSummary);
    }
    vals.push(id);
    runStmt(db, `UPDATE orchestration_sessions SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async appendSessionEvent(p: {
    id: string;
    sessionId: string;
    role: string;
    kind: string;
    summary: string;
    payloadJson: string;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO orchestration_session_events
        (id, session_id, role, kind, summary, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [p.id, p.sessionId, p.role, p.kind, p.summary, p.payloadJson],
    );
  }

  async listSessionEvents(sessionId: string) {
    const db = await ensureDb();
    return getRows(
      db,
      "SELECT * FROM orchestration_session_events WHERE session_id = ? ORDER BY created_at ASC, id ASC",
      [sessionId],
    );
  }

  async saveSessionWorkingSet(p: {
    sessionId: string;
    entitiesJson: string;
    documentsJson: string;
    metricsJson: string;
    gapsJson: string;
    provenanceScore: number;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO orchestration_working_sets
        (session_id, entities_json, documents_json, metrics_json, gaps_json, provenance_score, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(session_id) DO UPDATE SET
         entities_json = excluded.entities_json,
         documents_json = excluded.documents_json,
         metrics_json = excluded.metrics_json,
         gaps_json = excluded.gaps_json,
         provenance_score = excluded.provenance_score,
         updated_at = datetime('now')`,
      [p.sessionId, p.entitiesJson, p.documentsJson, p.metricsJson, p.gapsJson, p.provenanceScore],
    );
  }

  async getSessionWorkingSet(sessionId: string) {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM orchestration_working_sets WHERE session_id = ?", [sessionId]);
  }

  // ==================== TOOL CALLS ====================
  async addToolCall(p: { id: string; runId: string; toolName: string; input: string }) {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO tool_calls (id, run_id, tool_name, input, started_at, completed_at)
       VALUES (?, ?, ?, ?, datetime('now'), NULL)`,
      [p.id, p.runId, p.toolName, p.input],
    );
  }

  async completeToolCall(id: string, output: string) {
    const db = await ensureDb();
    runStmt(
      db,
      "UPDATE tool_calls SET output = ?, completed_at = datetime('now') WHERE id = ?",
      [output, id],
    );
  }
}
export { encrypt, decrypt } from "./crypto.js";
