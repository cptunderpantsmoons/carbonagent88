-- Connector framework + proactive watcher rules migration (Phase 3)

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

-- Optional anomaly rules attached to watchers.
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
