import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
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
    try {
      const buffer = fs.readFileSync(dbFile);
      return new sqlJs!.Database(buffer as Uint8Array);
    } catch (err) {
      console.error(`[sqlite] Failed to open database at ${dbFile}:`, err);
      // Health check: try restoring from latest backup
      const restored = restoreFromBackup();
      if (restored) {
        console.log("[sqlite] Successfully restored database from backup");
        const buffer = fs.readFileSync(dbFile);
        return new sqlJs!.Database(buffer as Uint8Array);
      }
      console.warn("[sqlite] No backup available, starting with empty database");
      return new sqlJs!.Database();
    }
  }
  return new sqlJs!.Database();
}

/**
 * Backup the current database to a timestamped .bak file.
 * Keeps the last 7 daily backups; older ones are pruned.
 * Should be called on startup and periodically.
 */
export function backupDatabase(): void {
  const dbFile = currentDbPath;
  if (!fs.existsSync(dbFile)) return;

  const dir = path.dirname(dbFile);
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const backupPath = path.join(dir, `carbon.db.${dateStr}.bak`);

  // Don't create duplicate backups for the same day
  if (fs.existsSync(backupPath)) return;

  try {
    // Flush in-memory state to disk first so backup is current
    if (dbInstance) {
      saveDb(dbInstance);
    }
    fs.copyFileSync(dbFile, backupPath);
    console.log(`[sqlite] Database backed up to ${backupPath}`);
  } catch (err) {
    console.error(`[sqlite] Backup failed:`, err);
    return;
  }

  // Prune old backups — keep last 7 daily backups
  pruneOldBackups(dir);
}

/**
 * Prune backup files older than 7 days in the database directory.
 * Only deletes files matching the carbon.db.YYYYMMDD.bak pattern.
 */
function pruneOldBackups(dir: string): void {
  const backupPattern = /^carbon\.db\.\d{8}\.bak$/;
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => backupPattern.test(f));
  } catch {
    return;
  }

  // Sort by filename (YYYYMMDD sorts chronologically)
  files.sort().reverse();

  // Keep the 7 most recent, delete the rest
  const toDelete = files.slice(7);
  for (const file of toDelete) {
    try {
      fs.unlinkSync(path.join(dir, file));
      console.log(`[sqlite] Pruned old backup: ${file}`);
    } catch (err) {
      console.warn(`[sqlite] Failed to prune backup ${file}:`, err);
    }
  }
}

/**
 * Attempt to restore the database from the most recent backup file.
 * Returns true if restoration succeeded, false otherwise.
 */
function restoreFromBackup(): boolean {
  const dbFile = currentDbPath;
  const dir = path.dirname(dbFile);
  const backupPattern = /^carbon\.db\.\d{8}\.bak$/;

  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => backupPattern.test(f));
  } catch {
    return false;
  }

  if (files.length === 0) return false;

  // Sort by date descending (most recent first)
  files.sort().reverse();

  for (const backupFile of files) {
    const backupPath = path.join(dir, backupFile);
    try {
      // Verify the backup is a valid SQLite file by checking the header
      const header = Buffer.alloc(16);
      const fd = fs.openSync(backupPath, "r");
      fs.readSync(fd, header, 0, 16, 0);
      fs.closeSync(fd);

      // SQLite database file header magic string
      if (header.toString("utf8", 0, 15) !== "SQLite format 3") {
        console.warn(`[sqlite] Backup ${backupFile} is not a valid SQLite file, skipping`);
        continue;
      }

      fs.copyFileSync(backupPath, dbFile);
      console.log(`[sqlite] Restored database from ${backupFile}`);
      return true;
    } catch (err) {
      console.warn(`[sqlite] Failed to restore from ${backupFile}:`, err);
      continue;
    }
  }

  return false;
}

function saveDb(db: Database): void {
  const data = db.export();
  fs.writeFileSync(currentDbPath, Buffer.from(data));
}

export async function ensureDb(): Promise<Database> {
  if (!sqlJs) {
    await initEngine();
    dbInstance = loadOrCreateDb();
    // Create a daily backup on startup for data resilience
    backupDatabase();
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

// --- Debounced auto-flush mechanism ---
// Prevents data loss by periodically writing the in-memory DB to disk.
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushDb();
    flushTimer = null;
  }, 500);
}

export function closeDb(): void {
  // Cancel any pending debounced flush and flush immediately
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushDb();
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  sqlJs = null;
}

function initTables(): void {
  if (!dbInstance) return;
  // Enable foreign key enforcement for sql.js (off by default).
  dbInstance.exec("PRAGMA foreign_keys = ON;");
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
      trigger TEXT NOT NULL DEFAULT 'cron' CHECK(trigger IN ('cron', 'filesystem')),
      cron_expression TEXT NOT NULL DEFAULT '',
      watch_path TEXT,
      recursive INTEGER NOT NULL DEFAULT 1,
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
    CREATE INDEX IF NOT EXISTS idx_episodic_outcome ON episodic_events(outcome);
    CREATE INDEX IF NOT EXISTS idx_episodic_created_at ON episodic_events(created_at);
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
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_workspace_type ON memory_graph_nodes(workspace_id, entity_type);

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
    CREATE INDEX IF NOT EXISTS idx_graph_edges_source_target_relation ON memory_graph_edges(source_id, target_id, relation_type);

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

    -- Connectors (Phase 3)
    CREATE TABLE IF NOT EXISTS connector_configs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('directory','rest','email','calendar','pm','database')),
      enabled INTEGER NOT NULL DEFAULT 1,
      schedule TEXT,
      credentials_encrypted TEXT,
      options_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_connector_configs_workspace
      ON connector_configs(workspace_id);

    CREATE TABLE IF NOT EXISTS connector_runs (
      id TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('success','failed','partial','running')),
      items_processed INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_connector_runs_connector
      ON connector_runs(connector_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_connector_runs_workspace
      ON connector_runs(workspace_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS connector_state (
      connector_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      cursor TEXT,
      last_item_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_connector_state_workspace
      ON connector_state(workspace_id);

    -- Watcher anomaly rules (Phase 3)
    CREATE TABLE IF NOT EXISTS anomaly_rules (
      id TEXT PRIMARY KEY,
      watcher_id TEXT NOT NULL REFERENCES watchers(id) ON DELETE CASCADE,
      metric TEXT NOT NULL CHECK(metric IN ('new_file_count','file_size','run_failure_rate','connector_item_count')),
      operator TEXT NOT NULL CHECK(operator IN ('gt','lt','eq','changed')),
      threshold REAL,
      window_minutes INTEGER NOT NULL DEFAULT 60,
      severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
      enabled INTEGER NOT NULL DEFAULT 1,
      target_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_anomaly_rules_watcher
      ON anomaly_rules(watcher_id);

    -- Multi-tenancy tables (Phase 4)
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      password_hash TEXT,
      role_id TEXT NOT NULL REFERENCES roles(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, email)
    );

    CREATE TABLE IF NOT EXISTS tenant_members (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id),
      PRIMARY KEY (tenant_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id),
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON tenant_members(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

    -- Pending approvals (Phase 6)
    CREATE TABLE IF NOT EXISTS pending_approvals (
      correlation_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('tool','plan','plan-step')),
      priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      tool_name TEXT,
      arguments_json TEXT NOT NULL DEFAULT '{}',
      requested_at TEXT NOT NULL,
      timeout_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')),
      reason TEXT,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pending_approvals_session ON pending_approvals(session_id, status);
  `);
  ensureBrowserProfileColumns();
  ensureWatcherColumns();
  ensureWatcherRulesColumn();
  ensureMemoryColumns();
  ensureMultiTenancyColumns();
  initDefaultPermissions();
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
  if (!names.has("trigger")) {
    dbInstance.exec("ALTER TABLE watchers ADD COLUMN trigger TEXT NOT NULL DEFAULT 'cron' CHECK(trigger IN ('cron', 'filesystem'))");
  }
  if (!names.has("watch_path")) {
    dbInstance.exec("ALTER TABLE watchers ADD COLUMN watch_path TEXT");
  }
  if (!names.has("recursive")) {
    dbInstance.exec("ALTER TABLE watchers ADD COLUMN recursive INTEGER NOT NULL DEFAULT 1");
  }
}

function ensureWatcherRulesColumn(): void {
  if (!dbInstance) return;
  const columns = getRows(dbInstance, "PRAGMA table_info(watchers)");
  const names = new Set(columns.map((column: RowObj) => String(column.name)));
  if (!names.has("rules_json")) {
    dbInstance.exec("ALTER TABLE watchers ADD COLUMN rules_json TEXT NOT NULL DEFAULT '[]'");
  }
}

function ensureMemoryColumns(): void {
  if (!dbInstance) return;
  // This function is called after initTables to ensure all new tables exist
  // The tables are created with IF NOT EXISTS, so this is safe for existing databases
  // Additional column migrations can be added here if needed
}

function ensureMultiTenancyColumns(): void {
  if (!dbInstance) return;
  const tables = [
    "workspaces",
    "ai_providers",
    "browser_profiles",
    "conversations",
    "runs",
    "data_sources",
    "documents",
    "watchers",
    "connector_configs",
    "harness_configs",
    "orchestration_sessions",
  ];
  for (const table of tables) {
    try {
      const columns = getRows(dbInstance, `PRAGMA table_info(${table})`);
      const names = new Set(columns.map((column: RowObj) => String(column.name)));
      if (!names.has("tenant_id")) {
        dbInstance.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT`);
      }
      if (!names.has("user_id")) {
        dbInstance.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT`);
      }
      if (!names.has("owner_id")) {
        dbInstance.exec(`ALTER TABLE ${table} ADD COLUMN owner_id TEXT`);
      }
    } catch (err) {
      console.warn(`[ensureMultiTenancyColumns] skipped ${table}:`, err);
    }
  }
}

const DEFAULT_PERMISSIONS = [
  ["workspace:read", "View workspaces"],
  ["workspace:write", "Create and update workspaces"],
  ["workspace:delete", "Delete workspaces"],
  ["memory:read", "Read memory"],
  ["memory:write", "Write memory"],
  ["skills:read", "Read skills"],
  ["skills:write", "Write skills"],
  ["skills:delete", "Delete skills"],
  ["run:create", "Create runs"],
  ["run:cancel", "Cancel runs"],
  ["provider:manage", "Manage AI providers"],
  ["profile:manage", "Manage browser profiles"],
  ["connector:manage", "Manage connectors"],
  ["watcher:manage", "Manage watchers"],
  ["user:manage", "Manage users"],
  ["role:manage", "Manage roles and permissions"],
] as const;

function initDefaultPermissions(): void {
  if (!dbInstance) return;
  for (const [name, description] of DEFAULT_PERMISSIONS) {
    runStmt(
      dbInstance,
      "INSERT OR IGNORE INTO permissions (id, name, description) VALUES (?, ?, ?)",
      [crypto.randomUUID(), name, description],
    );
  }
}

/** Initialize database engine, load/create file, and create tables. Accepts optional path override for testing. */
export async function initDatabase(filePath?: string): Promise<void> {
  if (filePath) currentDbPath = filePath;
  await initEngine();
  dbInstance = loadOrCreateDb();
  initTables();
  // Create a daily backup on startup for data resilience
  backupDatabase();
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
  // Schedule a debounced flush so write operations are persisted to disk.
  scheduleFlush();
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

  async createWorkspace(p: { id: string; name: string; description?: string; vaultDir: string; tenantId?: string; userId?: string }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO workspaces (id, name, description, vault_dir, tenant_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.name, p.description ?? null, p.vaultDir, p.tenantId ?? null, p.userId ?? null],
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
    tenantId?: string;
    userId?: string;
  }) {
    const db = await ensureDb();
    const encryptedKey = encrypt(p.apiKey);
    runStmt(
      db,
      "INSERT INTO ai_providers (id, type, name, api_key, base_url, model, tenant_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.type, p.name, encryptedKey, p.baseUrl ?? null, p.model, p.tenantId ?? null, p.userId ?? null],
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
    tenantId?: string;
    userId?: string;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO browser_profiles (id, name, description, profile_dir, cdp_url, cdp_fingerprint, target_domains, status, tenant_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [
        p.id,
        p.name,
        p.description ?? null,
        p.profileDir,
        p.cdpUrl ?? null,
        p.cdpFingerprint ?? null,
        JSON.stringify(p.targetDomains),
        "unknown",
        p.tenantId ?? null,
        p.userId ?? null,
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
    trigger?: "cron" | "filesystem";
    cronExpression?: string;
    watchPath?: string | null;
    recursive?: boolean;
    prompt: string;
    enabled: boolean;
    rulesJson?: string;
  }) {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO watchers
       (id, workspace_id, profile_id, name, trigger, cron_expression, watch_path, recursive, prompt, enabled, rules_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        p.id,
        p.workspaceId,
        p.profileId ?? null,
        p.name,
        p.trigger ?? "cron",
        p.cronExpression ?? "",
        p.watchPath ?? null,
        p.recursive !== false ? 1 : 0,
        p.prompt,
        p.enabled ? 1 : 0,
        p.rulesJson ?? "[]",
      ],
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
      trigger?: "cron" | "filesystem";
      cronExpression?: string;
      watchPath?: string | null;
      recursive?: boolean;
      enabled?: boolean;
      profileId?: string | null;
      prompt?: string;
      lastRunAt?: string;
      lastRunStatus?: string;
      rulesJson?: string;
    },
  ) {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.trigger !== undefined) {
      fields.push("trigger = ?");
      vals.push(p.trigger);
    }
    if (p.cronExpression !== undefined) {
      fields.push("cron_expression = ?");
      vals.push(p.cronExpression);
    }
    if (p.watchPath !== undefined) {
      fields.push("watch_path = ?");
      vals.push(p.watchPath ?? null);
    }
    if (p.recursive !== undefined) {
      fields.push("recursive = ?");
      vals.push(p.recursive ? 1 : 0);
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
    if (p.rulesJson !== undefined) {
      fields.push("rules_json = ?");
      vals.push(p.rulesJson);
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
      "UPDATE watchers SET last_run_at = ?, updated_at = datetime('now') WHERE id = ?",
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
    const row = getRow(db, "SELECT COUNT(*) as count FROM runs WHERE status = 'running'", []);
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
  async listSkills(workspaceId: string, tenantId?: string) {
    const db = await ensureDb();
    if (tenantId) {
      return getRows(
        db,
        `SELECT s.* FROM skills s
         JOIN workspaces w ON s.workspace_id = w.id
         WHERE s.workspace_id = ? AND w.tenant_id = ?
         ORDER BY s.updated_at DESC`,
        [workspaceId, tenantId],
      );
    }
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

  // ==================== GRAPH MEMORY ====================
  async storeGraphNode(p: {
    id: string;
    workspaceId: string;
    type: string;
    label: string;
    properties?: Record<string, unknown>;
    embedding?: number[];
    mentionCount?: number;
  }): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO memory_graph_nodes (id, workspace_id, name, entity_type, properties_json, embedding_json, mention_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        p.id,
        p.workspaceId,
        p.label,
        p.type,
        JSON.stringify(p.properties ?? {}),
        JSON.stringify(p.embedding ?? []),
        p.mentionCount ?? 1,
      ],
    );
  }

  async getGraphNode(id: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM memory_graph_nodes WHERE id = ?", [id]);
  }

  async getGraphEdge(id: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM memory_graph_edges WHERE id = ?", [id]);
  }

  async findGraphNodes(p: {
    workspaceId: string;
    type?: string;
    label?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    const conditions: string[] = ["workspace_id = ?"];
    const params: unknown[] = [p.workspaceId];
    if (p.type !== undefined) {
      conditions.push("entity_type = ?");
      params.push(p.type);
    }
    if (p.label !== undefined) {
      conditions.push("name = ?");
      params.push(p.label);
    }
    const sql = `SELECT * FROM memory_graph_nodes WHERE ${conditions.join(" AND ")} ORDER BY mention_count DESC${p.limit ? " LIMIT ?" : ""}`;
    if (p.limit !== undefined) params.push(p.limit);
    return getRows(db, sql, params);
  }

  async mergeGraphNode(p: {
    id: string;
    workspaceId: string;
    type: string;
    label: string;
    properties?: Record<string, unknown>;
    embedding?: number[];
    mentionCount?: number;
  }): Promise<void> {
    const db = await ensureDb();
    const existing = getRow(db, "SELECT id FROM memory_graph_nodes WHERE id = ?", [p.id]);
    if (existing) {
      const fields: string[] = ["created_at = created_at"];
      const vals: unknown[] = [];
      if (p.label !== undefined) {
        fields.push("name = ?");
        vals.push(p.label);
      }
      if (p.type !== undefined) {
        fields.push("entity_type = ?");
        vals.push(p.type);
      }
      if (p.properties !== undefined) {
        fields.push("properties_json = ?");
        vals.push(JSON.stringify(p.properties));
      }
      if (p.embedding !== undefined) {
        fields.push("embedding_json = ?");
        vals.push(JSON.stringify(p.embedding));
      }
      if (p.mentionCount !== undefined) {
        fields.push("mention_count = ?");
        vals.push(p.mentionCount);
      }
      vals.push(p.id);
      runStmt(db, `UPDATE memory_graph_nodes SET ${fields.join(", ")} WHERE id = ?`, vals);
    } else {
      runStmt(
        db,
        `INSERT INTO memory_graph_nodes (id, workspace_id, name, entity_type, properties_json, embedding_json, mention_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          p.id,
          p.workspaceId,
          p.label,
          p.type,
          JSON.stringify(p.properties ?? {}),
          JSON.stringify(p.embedding ?? []),
          p.mentionCount ?? 1,
        ],
      );
    }
  }

  async deleteGraphNode(id: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM memory_graph_nodes WHERE id = ?", [id]);
  }

  async storeGraphEdge(p: {
    id: string;
    sourceId: string;
    targetId: string;
    relationType: string;
    workspaceId: string;
    documentId?: string | null;
    weight?: number;
    properties?: Record<string, unknown>;
  }): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO memory_graph_edges (id, workspace_id, source_id, target_id, relation_type, weight, properties_json, document_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        p.id,
        p.workspaceId,
        p.sourceId,
        p.targetId,
        p.relationType,
        p.weight ?? 0.5,
        JSON.stringify(p.properties ?? {}),
        p.documentId ?? null,
      ],
    );
  }

  async findGraphEdges(p: {
    workspaceId: string;
    sourceId?: string;
    targetId?: string;
    relationType?: string;
  }): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    const conditions: string[] = ["workspace_id = ?"];
    const params: unknown[] = [p.workspaceId];
    if (p.sourceId !== undefined) {
      conditions.push("source_id = ?");
      params.push(p.sourceId);
    }
    if (p.targetId !== undefined) {
      conditions.push("target_id = ?");
      params.push(p.targetId);
    }
    if (p.relationType !== undefined) {
      conditions.push("relation_type = ?");
      params.push(p.relationType);
    }
    const sql = `SELECT * FROM memory_graph_edges WHERE ${conditions.join(" AND ")} ORDER BY weight DESC`;
    return getRows(db, sql, params);
  }

  async deleteGraphEdge(id: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM memory_graph_edges WHERE id = ?", [id]);
  }

  async listGraphNodes(workspaceId: string): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM memory_graph_nodes WHERE workspace_id = ? ORDER BY mention_count DESC", [workspaceId]);
  }

  async listGraphEdges(workspaceId: string): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM memory_graph_edges WHERE workspace_id = ? ORDER BY weight DESC", [workspaceId]);
  }

  // ==================== EPISODIC MEMORY ====================
  async storeEpisodicEvent(event: {
    id: string;
    workspaceId: string;
    type: string;
    summary: string;
    details?: Record<string, unknown>;
    outcome: string;
    embedding?: number[];
    importance?: number;
    createdAt?: string;
    decayFactor?: number;
    accessCount?: number;
  }): Promise<void> {
    const db = await ensureDb();
    const createdAt = event.createdAt ?? new Date().toISOString();
    runStmt(
      db,
      `INSERT OR REPLACE INTO episodic_events
       (id, workspace_id, type, summary, details_json, outcome, embedding_json, importance,
        access_count, decay_factor, created_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.workspaceId,
        event.type,
        event.summary,
        JSON.stringify(event.details ?? {}),
        event.outcome,
        JSON.stringify(event.embedding ?? []),
        event.importance ?? 0.5,
        event.accessCount ?? 0,
        event.decayFactor ?? 1.0,
        createdAt,
        createdAt,
      ],
    );
  }

  async findEpisodicEvents(opts: {
    workspaceId: string;
    types?: string | string[];
    outcome?: string;
    after?: string;
    before?: string;
    limit?: number;
    includeEmbeddings?: boolean;
  }): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    const conditions: string[] = ["workspace_id = ?"];
    const params: unknown[] = [opts.workspaceId];

    if (opts.types !== undefined) {
      const types = Array.isArray(opts.types) ? opts.types : [opts.types];
      if (types.length > 0) {
        conditions.push(`type IN (${types.map(() => "?").join(", ")})`);
        params.push(...types);
      }
    }
    if (opts.outcome !== undefined) {
      conditions.push("outcome = ?");
      params.push(opts.outcome);
    }
    if (opts.after !== undefined) {
      conditions.push("created_at > ?");
      params.push(opts.after);
    }
    if (opts.before !== undefined) {
      conditions.push("created_at < ?");
      params.push(opts.before);
    }

    const includeEmbeddings = opts.includeEmbeddings !== false;
    const fields = includeEmbeddings
      ? "*"
      : "id, workspace_id, type, summary, details_json, outcome, importance, access_count, decay_factor, created_at, last_accessed_at";
    let sql = `SELECT ${fields} FROM episodic_events WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;
    if (opts.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    return getRows(db, sql, params);
  }

  async deleteEpisodicEvents(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await ensureDb();
    const placeholders = ids.map(() => "?").join(", ");
    runStmt(db, `DELETE FROM episodic_events WHERE id IN (${placeholders})`, ids);
  }

  async deleteEpisodicEventsByRange(workspaceId: string, before: string): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      "DELETE FROM episodic_events WHERE workspace_id = ? AND created_at < ?",
      [workspaceId, before],
    );
  }

  // ==================== CONNECTORS (Phase 3) ====================
  async createConnectorConfig(p: {
    id: string;
    workspaceId: string;
    name: string;
    type: string;
    enabled?: boolean;
    schedule?: string | null;
    credentials?: string | null;
    options?: Record<string, unknown>;
  }): Promise<string> {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO connector_configs
       (id, workspace_id, name, type, enabled, schedule, credentials_encrypted, options_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        p.id,
        p.workspaceId,
        p.name,
        p.type,
        p.enabled !== false ? 1 : 0,
        p.schedule ?? null,
        p.credentials ? encrypt(p.credentials) : null,
        JSON.stringify(p.options ?? {}),
      ],
    );
    return p.id;
  }

  async updateConnectorConfig(
    id: string,
    p: {
      name?: string;
      enabled?: boolean;
      schedule?: string | null;
      credentials?: string | null;
      options?: Record<string, unknown>;
    },
  ): Promise<void> {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.name !== undefined) {
      fields.push("name = ?");
      vals.push(p.name);
    }
    if (p.enabled !== undefined) {
      fields.push("enabled = ?");
      vals.push(p.enabled ? 1 : 0);
    }
    if (p.schedule !== undefined) {
      fields.push("schedule = ?");
      vals.push(p.schedule ?? null);
    }
    if (p.credentials !== undefined) {
      fields.push("credentials_encrypted = ?");
      vals.push(p.credentials === null || p.credentials === undefined ? null : encrypt(p.credentials));
    }
    if (p.options !== undefined) {
      fields.push("options_json = ?");
      vals.push(JSON.stringify(p.options));
    }
    vals.push(id);
    runStmt(db, `UPDATE connector_configs SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async deleteConnectorConfig(id: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM connector_configs WHERE id = ?", [id]);
    runStmt(db, "DELETE FROM connector_state WHERE connector_id = ?", [id]);
  }

  async listConnectorConfigs(workspaceId: string): Promise<Array<Record<string, unknown>>> {
    const db = await ensureDb();
    return getRows(
      db,
      "SELECT * FROM connector_configs WHERE workspace_id = ? ORDER BY updated_at DESC",
      [workspaceId],
    );
  }

  async getConnectorConfig(id: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    const row = getRow(db, "SELECT * FROM connector_configs WHERE id = ?", [id]);
    if (row && row.credentials_encrypted) {
      try {
        row.credentials_plaintext = decrypt(row.credentials_encrypted as string);
      } catch {
        /* leave encrypted */
      }
    }
    return row;
  }

  async recordConnectorRun(p: {
    id: string;
    connectorId: string;
    workspaceId: string;
    startedAt: string;
    finishedAt?: string | null;
    status: string;
    itemsProcessed?: number;
    errorMessage?: string | null;
  }): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO connector_runs
       (id, connector_id, workspace_id, started_at, finished_at, status, items_processed, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         finished_at = excluded.finished_at,
         status = excluded.status,
         items_processed = excluded.items_processed,
         error_message = excluded.error_message`,
      [
        p.id,
        p.connectorId,
        p.workspaceId,
        p.startedAt,
        p.finishedAt ?? null,
        p.status,
        p.itemsProcessed ?? 0,
        p.errorMessage ?? null,
      ],
    );
  }

  async listConnectorRuns(
    connectorId: string,
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    const db = await ensureDb();
    return getRows(
      db,
      "SELECT * FROM connector_runs WHERE connector_id = ? ORDER BY started_at DESC LIMIT ?",
      [connectorId, limit],
    );
  }

  async getConnectorState(connectorId: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM connector_state WHERE connector_id = ?", [connectorId]);
  }

  async updateConnectorState(p: {
    connectorId: string;
    workspaceId: string;
    cursor?: string | null;
    lastItemId?: string | null;
  }): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO connector_state
       (connector_id, workspace_id, cursor, last_item_id, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(connector_id) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         cursor = excluded.cursor,
         last_item_id = excluded.last_item_id,
         updated_at = excluded.updated_at`,
      [p.connectorId, p.workspaceId, p.cursor ?? null, p.lastItemId ?? null],
    );
  }

  // ==================== ANOMALY RULES (Phase 3) ====================
  async createAnomalyRule(p: {
    id: string;
    watcherId: string;
    metric: string;
    operator: string;
    threshold?: number | null;
    windowMinutes?: number;
    severity?: string;
    enabled?: boolean;
    targetId?: string | null;
  }): Promise<string> {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO anomaly_rules
       (id, watcher_id, metric, operator, threshold, window_minutes, severity, enabled, target_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        p.id,
        p.watcherId,
        p.metric,
        p.operator,
        p.threshold ?? null,
        p.windowMinutes ?? 60,
        p.severity ?? "warning",
        p.enabled !== false ? 1 : 0,
        p.targetId ?? null,
      ],
    );
    return p.id;
  }

  async listAnomalyRulesForWatcher(watcherId: string): Promise<Array<Record<string, unknown>>> {
    const db = await ensureDb();
    return getRows(
      db,
      "SELECT * FROM anomaly_rules WHERE watcher_id = ? ORDER BY created_at DESC",
      [watcherId],
    );
  }

  async deleteAnomalyRule(id: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM anomaly_rules WHERE id = ?", [id]);
  }

  // ==================== MULTI-TENANCY / RBAC (Phase 4) ====================
  async ensureDefaultTenantAndAdmin(): Promise<{ tenantId: string; adminUserId: string; adminRoleId: string }> {
    const db = await ensureDb();
    const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000001";
    const DEFAULT_ADMIN = "00000000-0000-0000-0000-000000000002";
    const DEFAULT_ROLES = {
      admin: "00000000-0000-0000-0000-000000000003",
      member: "00000000-0000-0000-0000-000000000004",
      viewer: "00000000-0000-0000-0000-000000000005",
    };

    const tenant = getRow(db, "SELECT * FROM tenants WHERE id = ?", [DEFAULT_TENANT]);
    if (!tenant) {
      runStmt(
        db,
        "INSERT INTO tenants (id, name, created_at) VALUES (?, ?, datetime('now'))",
        [DEFAULT_TENANT, "Default Tenant"],
      );
    }

    // Ensure system roles map to fixed IDs for this tenant
    const rolePermissions: Record<string, string[]> = {
      admin: [
        "workspace:read", "workspace:write", "workspace:delete",
        "memory:read", "memory:write",
        "skills:read", "skills:write", "skills:delete",
        "run:create", "run:cancel",
        "provider:manage", "profile:manage", "connector:manage", "watcher:manage",
        "user:manage", "role:manage",
      ],
      member: [
        "workspace:read", "workspace:write",
        "memory:read", "memory:write",
        "skills:read", "skills:write",
        "run:create", "run:cancel",
        "provider:manage", "profile:manage", "connector:manage", "watcher:manage",
      ],
      viewer: [
        "workspace:read", "memory:read", "skills:read",
      ],
    };

    for (const [name, roleId] of Object.entries(DEFAULT_ROLES)) {
      const existing = getRow(db, "SELECT * FROM roles WHERE id = ?", [roleId]);
      if (!existing) {
        runStmt(
          db,
          "INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
          [roleId, DEFAULT_TENANT, name, `System ${name} role`, 1],
        );
      }
      const perms = rolePermissions[name] ?? [];
      for (const permName of perms) {
        const perm = getRow(db, "SELECT * FROM permissions WHERE name = ?", [permName]);
        if (!perm) continue;
        const assigned = getRow(
          db,
          "SELECT * FROM role_permissions WHERE role_id = ? AND permission_id = ?",
          [roleId, perm.id],
        );
        if (!assigned) {
          runStmt(
            db,
            "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
            [roleId, perm.id],
          );
        }
      }
    }

    const adminRoleId = DEFAULT_ROLES.admin;
    const adminUser = getRow(db, "SELECT * FROM users WHERE id = ?", [DEFAULT_ADMIN]);
    if (!adminUser) {
      // Generate a random temporary password instead of storing null.
      const tempPassword = crypto.randomBytes(16).toString("hex");
      const tempHash = bcrypt.hashSync(tempPassword, 12);
      runStmt(
        db,
        "INSERT INTO users (id, tenant_id, email, name, password_hash, role_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
        [DEFAULT_ADMIN, DEFAULT_TENANT, "admin@local", "Default Admin", tempHash, adminRoleId, 1],
      );
      // Log the temporary password once so the operator can retrieve it.
      // The password must be changed on first login (indicated by the naming convention).
      console.log(`[DB] Default admin created with temporary password: ${tempPassword}`);
      console.log(`[DB] WARNING: The default admin password must be changed on first login.`);
    }

    // Ensure the default admin is a tenant member with admin role
    const tenantMembership = getRow(
      db,
      "SELECT * FROM tenant_members WHERE tenant_id = ? AND user_id = ?",
      [DEFAULT_TENANT, DEFAULT_ADMIN],
    );
    if (!tenantMembership) {
      runStmt(
        db,
        "INSERT INTO tenant_members (tenant_id, user_id, role_id) VALUES (?, ?, ?)",
        [DEFAULT_TENANT, DEFAULT_ADMIN, adminRoleId],
      );
    }

    // Migrate existing rows to default tenant and admin ownership
    const tables = [
      "workspaces",
      "ai_providers",
      "browser_profiles",
      "conversations",
      "runs",
      "data_sources",
      "documents",
      "watchers",
      "connector_configs",
      "harness_configs",
      "orchestration_sessions",
    ];
    for (const table of tables) {
      runStmt(
        db,
        `UPDATE ${table} SET tenant_id = COALESCE(tenant_id, ?), owner_id = COALESCE(owner_id, ?) WHERE tenant_id IS NULL`,
        [DEFAULT_TENANT, DEFAULT_ADMIN],
      );
    }

    return { tenantId: DEFAULT_TENANT, adminUserId: DEFAULT_ADMIN, adminRoleId };
  }

  async createTenant(p: { id: string; name: string }): Promise<string> {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO tenants (id, name, created_at) VALUES (?, ?, datetime('now'))",
      [p.id, p.name],
    );
    return p.id;
  }

  async getTenant(id: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM tenants WHERE id = ?", [id]);
  }

  async listTenants(): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM tenants ORDER BY created_at DESC");
  }

  async createUser(p: {
    id: string;
    tenantId: string;
    email: string;
    name?: string | null;
    passwordHash?: string | null;
    roleId: string;
    active?: boolean;
  }): Promise<string> {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO users (id, tenant_id, email, name, password_hash, role_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.tenantId, p.email, p.name ?? null, p.passwordHash ?? null, p.roleId, p.active !== false ? 1 : 0],
    );
    return p.id;
  }

  async getUserByEmail(email: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  }

  async getUserById(id: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM users WHERE id = ?", [id]);
  }

  async listUsersForTenant(tenantId: string): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at DESC", [tenantId]);
  }

  async updateUser(
    id: string,
    p: {
      email?: string;
      name?: string | null;
      passwordHash?: string | null;
      roleId?: string;
      active?: boolean;
    },
  ): Promise<void> {
    const db = await ensureDb();
    const fields: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (p.email !== undefined) { fields.push("email = ?"); vals.push(p.email); }
    if (p.name !== undefined) { fields.push("name = ?"); vals.push(p.name); }
    if (p.passwordHash !== undefined) { fields.push("password_hash = ?"); vals.push(p.passwordHash); }
    if (p.roleId !== undefined) { fields.push("role_id = ?"); vals.push(p.roleId); }
    if (p.active !== undefined) { fields.push("active = ?"); vals.push(p.active ? 1 : 0); }
    vals.push(id);
    runStmt(db, `UPDATE users SET ${fields.join(", ")} WHERE id = ?`, vals);
  }

  async deleteUser(id: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM tenant_members WHERE user_id = ?", [id]);
    runStmt(db, "DELETE FROM workspace_members WHERE user_id = ?", [id]);
    runStmt(db, "DELETE FROM users WHERE id = ?", [id]);
  }

  async createRole(p: {
    id: string;
    tenantId: string;
    name: string;
    description?: string | null;
    isSystem?: boolean;
  }): Promise<string> {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.id, p.tenantId, p.name, p.description ?? null, p.isSystem ? 1 : 0],
    );
    return p.id;
  }

  async getRole(id: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM roles WHERE id = ?", [id]);
  }

  async getRoleByName(tenantId: string, name: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM roles WHERE tenant_id = ? AND name = ?", [tenantId, name]);
  }

  async listRoles(tenantId: string): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    return getRows(db, "SELECT * FROM roles WHERE tenant_id = ? ORDER BY name", [tenantId]);
  }

  async deleteRole(id: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM workspace_members WHERE role_id = ?", [id]);
    runStmt(db, "DELETE FROM tenant_members WHERE role_id = ?", [id]);
    runStmt(db, "DELETE FROM role_permissions WHERE role_id = ?", [id]);
    runStmt(db, "DELETE FROM roles WHERE id = ?", [id]);
  }

  async listPermissionsForRole(roleId: string): Promise<string[]> {
    const db = await ensureDb();
    const rows = getRows(
      db,
      `SELECT p.name FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?`,
      [roleId],
    );
    return rows.map((row) => String(row.name));
  }

  async getPermissionByName(name: string): Promise<Record<string, unknown> | undefined> {
    const db = await ensureDb();
    return getRow(db, "SELECT * FROM permissions WHERE name = ?", [name]);
  }

  async assignPermission(roleId: string, permissionId: string): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
      [roleId, permissionId],
    );
  }

  async revokePermission(roleId: string, permissionId: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?", [roleId, permissionId]);
  }

  async addTenantMember(tenantId: string, userId: string, roleId: string): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT OR REPLACE INTO tenant_members (tenant_id, user_id, role_id) VALUES (?, ?, ?)",
      [tenantId, userId, roleId],
    );
  }

  async listTenantMembers(tenantId: string): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    return getRows(
      db,
      `SELECT tm.*, u.email, u.name, r.name as role_name
       FROM tenant_members tm
       JOIN users u ON u.id = tm.user_id
       JOIN roles r ON r.id = tm.role_id
       WHERE tm.tenant_id = ?`,
      [tenantId],
    );
  }

  async getTenantMemberRole(tenantId: string, userId: string): Promise<{ roleId: string } | undefined> {
    const db = await ensureDb();
    const row = getRow(
      db,
      "SELECT role_id FROM tenant_members WHERE tenant_id = ? AND user_id = ?",
      [tenantId, userId],
    );
    if (!row) return undefined;
    return { roleId: String(row.role_id) };
  }

  async addWorkspaceMember(workspaceId: string, userId: string, roleId: string): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      "INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role_id) VALUES (?, ?, ?)",
      [workspaceId, userId, roleId],
    );
  }

  async removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?", [workspaceId, userId]);
  }

  async listWorkspaceMembers(workspaceId: string): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    return getRows(
      db,
      `SELECT wm.*, u.email, u.name, r.name as role_name
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       JOIN roles r ON r.id = wm.role_id
       WHERE wm.workspace_id = ?`,
      [workspaceId],
    );
  }

  async getWorkspaceMemberRole(workspaceId: string, userId: string): Promise<{ roleId: string } | undefined> {
    const db = await ensureDb();
    const row = getRow(
      db,
      "SELECT role_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId],
    );
    if (!row) return undefined;
    return { roleId: String(row.role_id) };
  }

  async listWorkspacesForUser(userId: string): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    const user = getRow(db, "SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) return [];
    const tenantId = String(user.tenant_id);
    const role = await this.getRole(String(user.role_id));
    const isTenantAdmin = role?.name === "admin";
    if (isTenantAdmin) {
      return getRows(
        db,
        "SELECT * FROM workspaces WHERE tenant_id = ? OR tenant_id IS NULL ORDER BY created_at DESC",
        [tenantId],
      );
    }
    return getRows(
      db,
      `SELECT w.* FROM workspaces w
       LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?
       WHERE (w.tenant_id = ? OR w.tenant_id IS NULL)
         AND (wm.user_id IS NOT NULL)
       ORDER BY w.created_at DESC`,
      [userId, tenantId],
    );
  }

  // ==================== PENDING APPROVALS (Phase 6) ====================
  async listPendingApprovals(sessionId?: string): Promise<Record<string, unknown>[]> {
    const db = await ensureDb();
    if (sessionId) {
      return getRows(db, "SELECT * FROM pending_approvals WHERE session_id = ? AND status = 'pending' ORDER BY requested_at ASC", [sessionId]);
    }
    return getRows(db, "SELECT * FROM pending_approvals WHERE status = 'pending' ORDER BY requested_at ASC");
  }

  async savePendingApproval(p: {
    correlationId: string;
    sessionId: string;
    kind: string;
    priority: string;
    title: string;
    summary: string;
    toolName?: string;
    arguments?: Record<string, unknown>;
    requestedAt: string;
    timeoutAt?: string;
  }): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      `INSERT INTO pending_approvals
         (correlation_id, session_id, kind, priority, title, summary, tool_name, arguments_json, requested_at, timeout_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
       ON CONFLICT(correlation_id) DO UPDATE SET
         session_id = excluded.session_id,
         kind = excluded.kind,
         priority = excluded.priority,
         title = excluded.title,
         summary = excluded.summary,
         tool_name = excluded.tool_name,
         arguments_json = excluded.arguments_json,
         requested_at = excluded.requested_at,
         timeout_at = excluded.timeout_at`,
      [
        p.correlationId,
        p.sessionId,
        p.kind,
        p.priority,
        p.title,
        p.summary,
        p.toolName ?? null,
        JSON.stringify(p.arguments ?? {}),
        p.requestedAt,
        p.timeoutAt ?? null,
      ],
    );
  }

  async resolvePendingApproval(p: {
    correlationId: string;
    decision: "approved" | "rejected";
    reason?: string;
  }): Promise<void> {
    const db = await ensureDb();
    runStmt(
      db,
      `UPDATE pending_approvals
       SET status = ?, reason = ?, resolved_at = datetime('now')
       WHERE correlation_id = ?`,
      [p.decision, p.reason ?? null, p.correlationId],
    );
  }

  async deletePendingApproval(correlationId: string): Promise<void> {
    const db = await ensureDb();
    runStmt(db, "DELETE FROM pending_approvals WHERE correlation_id = ?", [correlationId]);
  }

  async clearExpiredPendingApprovals(before?: string): Promise<void> {
    const db = await ensureDb();
    const threshold = before ?? new Date().toISOString();
    runStmt(db, "DELETE FROM pending_approvals WHERE status = 'expired' AND resolved_at < ?", [threshold]);
  }
}
export { encrypt, decrypt } from "./crypto.js";
