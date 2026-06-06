/**
 * Model Roles — Maps agent roles to specific AI providers.
 *
 * Users assign providers to roles:
 *   - assistant: general-purpose conversations
 *   - coder: code generation/editing (e.g., umans-coder)
 *   - knowledge-graph: knowledge extraction (e.g., umans-flash-beta)
 *   - meeting-notes: summarization (e.g., umans-flash)
 *   - track-block: task tracking and project management
 */

import { ensureDb, getRow, getRows, runStmt } from "./sqlite.js";

export const MODEL_ROLES = ["assistant", "coder", "knowledge-graph", "meeting-notes", "track-block"] as const;
export type ModelRoleName = typeof MODEL_ROLES[number];

export interface DbModelRole {
  id: string;
  role: ModelRoleName;
  provider_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export async function initModelRolesTable(): Promise<void> {
  const db = await ensureDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_roles (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(role, workspace_id)
    );
    CREATE INDEX IF NOT EXISTS idx_model_roles_workspace ON model_roles(workspace_id);
  `);
}

export async function dbSetModelRole(p: {
  id: string;
  role: ModelRoleName;
  providerId: string;
  workspaceId: string;
}): Promise<void> {
  const db = await ensureDb();
  const existing = getRow(db, `SELECT id FROM model_roles WHERE role = ? AND workspace_id = ?`, [p.role, p.workspaceId]);
  if (existing) {
    runStmt(db,
      `UPDATE model_roles SET provider_id = ?, updated_at = datetime('now') WHERE role = ? AND workspace_id = ?`,
      [p.providerId, p.role, p.workspaceId]
    );
  } else {
    runStmt(db,
      `INSERT INTO model_roles (id, role, provider_id, workspace_id) VALUES (?, ?, ?, ?)`,
      [p.id, p.role, p.providerId, p.workspaceId]
    );
  }
}

export async function dbGetModelRole(workspaceId: string, role: ModelRoleName): Promise<DbModelRole | undefined> {
  const db = await ensureDb();
  const row = getRow(db, `SELECT * FROM model_roles WHERE workspace_id = ? AND role = ?`, [workspaceId, role]);
  return row as unknown as DbModelRole | undefined;
}

export async function dbListModelRoles(workspaceId: string): Promise<DbModelRole[]> {
  const db = await ensureDb();
  return getRows(db, `SELECT * FROM model_roles WHERE workspace_id = ? ORDER BY role`, [workspaceId]) as unknown as DbModelRole[];
}

export async function dbDeleteModelRole(role: ModelRoleName, workspaceId: string): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `DELETE FROM model_roles WHERE role = ? AND workspace_id = ?`, [role, workspaceId]);
}
