-- Phase 6: human-in-the-loop approvals table.
-- Idempotent migration for pending_approvals persistence.

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

CREATE INDEX IF NOT EXISTS idx_pending_approvals_session
  ON pending_approvals(session_id, status);
