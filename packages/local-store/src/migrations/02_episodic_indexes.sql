-- Episodic memory index migration (Phase 2)
-- Ensure indexes used by retention, filtering, and recall queries exist.

CREATE INDEX IF NOT EXISTS idx_episodic_workspace
  ON episodic_events(workspace_id);

CREATE INDEX IF NOT EXISTS idx_episodic_type
  ON episodic_events(type);

CREATE INDEX IF NOT EXISTS idx_episodic_outcome
  ON episodic_events(outcome);

CREATE INDEX IF NOT EXISTS idx_episodic_created_at
  ON episodic_events(created_at);
