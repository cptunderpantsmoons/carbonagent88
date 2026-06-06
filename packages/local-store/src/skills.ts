/**
 * Local SQLite-backed Skills Store
 *
 * Mirrors the in-memory skill store from core-runtime with persistent
 * SQLite storage so skills survive reboots.
 */

import { ensureDb, getRow, getRows, runStmt } from "./sqlite.js";

export interface DbSkill {
  id: string;
  workspace_id: string;
  trigger: string;
  trigger_embedding_json: string;
  name: string;
  description: string;
  tool_sequence_json: string;
  success_count: number;
  failure_count: number;
  consecutive_failures: number;
  version: number;
  last_used_at: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export async function initSkillsTable(): Promise<void> {
  const db = await ensureDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      trigger TEXT NOT NULL,
      trigger_embedding_json TEXT NOT NULL, -- JSON array of floats
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      tool_sequence_json TEXT NOT NULL,     -- JSON array of SkillStep
      success_count INTEGER NOT NULL DEFAULT 1,
      failure_count INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_skills_workspace ON skills(workspace_id);
  `);

  // Migration: add self-improvement columns to existing tables
  const cols = getRows(db, `PRAGMA table_info(skills)`) as { name: string }[];
  const colNames = cols.map((c) => c.name);
  if (!colNames.includes("consecutive_failures")) {
    db.exec(`ALTER TABLE skills ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0`);
  }
  if (!colNames.includes("version")) {
    db.exec(`ALTER TABLE skills ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
  }
  if (!colNames.includes("last_used_at")) {
    db.exec(`ALTER TABLE skills ADD COLUMN last_used_at TEXT`);
  }
}

export async function dbStoreSkill(p: {
  id: string;
  workspaceId: string;
  trigger: string;
  triggerEmbedding: number[];
  name: string;
  description: string;
  toolSequence: { toolName: string; input: Record<string, unknown>; notes?: string }[];
}): Promise<void> {
  const db = await ensureDb();
  runStmt(db,
    `INSERT INTO skills (id, workspace_id, trigger, trigger_embedding_json, name, description, tool_sequence_json, success_count, failure_count, pinned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.workspaceId, p.trigger, JSON.stringify(p.triggerEmbedding), p.name, p.description, JSON.stringify(p.toolSequence), 1, 0, 0]
  );
}

export async function dbIncrementSkillSuccess(id: string): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `UPDATE skills SET success_count = success_count + 1, updated_at = datetime('now') WHERE id = ?`, [id]);
}

export async function dbIncrementSkillFailure(id: string): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `UPDATE skills SET failure_count = failure_count + 1, updated_at = datetime('now') WHERE id = ?`, [id]);
}

export async function dbTogglePin(id: string, pinned: boolean): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `UPDATE skills SET pinned = ?, updated_at = datetime('now') WHERE id = ?`, [pinned ? 1 : 0, id]);
}

export async function dbDeleteSkill(id: string): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `DELETE FROM skills WHERE id = ?`, [id]);
}

export async function dbListSkills(workspaceId: string): Promise<DbSkill[]> {
  const db = await ensureDb();
  const rows = getRows(db, `SELECT * FROM skills WHERE workspace_id = ? ORDER BY pinned DESC, success_count DESC, created_at DESC`, [workspaceId]);
  return rows as unknown as DbSkill[];
}

export async function dbGetSkill(id: string): Promise<DbSkill | undefined> {
  const db = await ensureDb();
  const row = getRow(db, `SELECT * FROM skills WHERE id = ?`, [id]);
  return row as unknown as DbSkill | undefined;
}

export async function dbRecordSkillUse(id: string): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `UPDATE skills SET last_used_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [id]);
}

export async function dbResetConsecutiveFailures(id: string): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `UPDATE skills SET consecutive_failures = 0, updated_at = datetime('now') WHERE id = ?`, [id]);
}

export async function dbIncrementConsecutiveFailures(id: string): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `UPDATE skills SET consecutive_failures = consecutive_failures + 1, failure_count = failure_count + 1, updated_at = datetime('now') WHERE id = ?`, [id]);
}

export async function dbBumpSkillVersion(id: string): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `UPDATE skills SET version = version + 1, consecutive_failures = 0, updated_at = datetime('now') WHERE id = ?`, [id]);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function dbRecallSkillsBySimilarity(
  workspaceId: string,
  queryEmbedding: number[],
  limit: number = 5,
): Promise<DbSkill[]> {
  const db = await ensureDb();
  const rows = getRows(db, `SELECT * FROM skills WHERE workspace_id = ?`, [workspaceId]) as unknown as DbSkill[];
  if (rows.length === 0) return [];

  const scored = rows.map((s) => {
    const embedding = JSON.parse(s.trigger_embedding_json) as number[];
    return { skill: s, score: cosineSimilarity(queryEmbedding, embedding) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.skill);
}

export interface SkillExport {
  id: string;
  workspaceId: string;
  trigger: string;
  triggerEmbedding: number[];
  name: string;
  description: string;
  toolSequence: { toolName: string; input: Record<string, unknown>; notes?: string }[];
  successCount: number;
  failureCount: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function dbExportSkills(workspaceId: string): Promise<SkillExport[]> {
  const rows = await dbListSkills(workspaceId);
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    trigger: r.trigger,
    triggerEmbedding: JSON.parse(r.trigger_embedding_json) as number[],
    name: r.name,
    description: r.description,
    toolSequence: JSON.parse(r.tool_sequence_json) as SkillExport["toolSequence"],
    successCount: r.success_count,
    failureCount: r.failure_count,
    pinned: r.pinned === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function dbImportSkills(skills: SkillExport[]): Promise<{ imported: number; skipped: number }> {
  const db = await ensureDb();
  let imported = 0;
  let skipped = 0;
  for (const s of skills) {
    const existing = getRow(db, `SELECT id FROM skills WHERE id = ?`, [s.id]);
    if (existing) {
      skipped++;
      continue;
    }
    runStmt(db,
      `INSERT INTO skills (id, workspace_id, trigger, trigger_embedding_json, name, description, tool_sequence_json, success_count, failure_count, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.workspaceId, s.trigger, JSON.stringify(s.triggerEmbedding), s.name, s.description, JSON.stringify(s.toolSequence), s.successCount, s.failureCount, s.pinned ? 1 : 0]
    );
    imported++;
  }
  return { imported, skipped };
}
