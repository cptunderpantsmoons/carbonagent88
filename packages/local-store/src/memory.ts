/**
 * Agent Memory Store — Persistent semantic memory connected to the vault.
 *
 * Memories are auto-extracted facts, summaries, and context from agent runs
 * and vault writes. They can be recalled by semantic similarity for future tasks.
 */

import { ensureDb, getRows, runStmt } from "./sqlite.js";

export interface DbMemory {
  id: string;
  workspace_id: string;
  key: string;
  content: string;
  embedding_json: string;
  tags_json: string;
  source: string;
  importance: number;
  created_at: string;
  updated_at: string;
}

export async function initMemoryTable(): Promise<void> {
  const db = await ensureDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'manual',
      importance REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id);
  `);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Simple hash-based embedding (same as core-runtime HashEmbeddingProvider) */
export function hashEmbed(text: string, dims = 384): number[] {
  const vec = new Array(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    vec[code % dims] += 1;
    vec[(code * 31) % dims] += 0.5;
    vec[(code * 97 + i) % dims] += 0.25;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return mag > 0 ? vec.map(v => v / mag) : vec;
}

export async function dbStoreMemory(p: {
  id: string;
  workspaceId: string;
  key: string;
  content: string;
  tags?: string[];
  source?: string;
  importance?: number;
}): Promise<void> {
  const db = await ensureDb();
  const embedding = hashEmbed(`${p.key} ${p.content}`);
  runStmt(db,
    `INSERT OR REPLACE INTO memories (id, workspace_id, key, content, embedding_json, tags_json, source, importance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.workspaceId, p.key, p.content, JSON.stringify(embedding), JSON.stringify(p.tags ?? []), p.source ?? "manual", p.importance ?? 0.5]
  );
}

export async function dbRecallMemories(
  workspaceId: string,
  query: string,
  limit: number = 5,
): Promise<DbMemory[]> {
  const db = await ensureDb();
  const queryEmbedding = hashEmbed(query);
  const rows = getRows(db, `SELECT * FROM memories WHERE workspace_id = ?`, [workspaceId]) as unknown as DbMemory[];
  if (rows.length === 0) return [];

  const scored = rows.map((m) => {
    const embedding = JSON.parse(m.embedding_json) as number[];
    return { memory: m, score: cosineSimilarity(queryEmbedding, embedding) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.memory);
}

export async function dbListMemories(workspaceId: string): Promise<DbMemory[]> {
  const db = await ensureDb();
  return getRows(db, `SELECT * FROM memories WHERE workspace_id = ? ORDER BY importance DESC, created_at DESC`, [workspaceId]) as unknown as DbMemory[];
}

export async function dbDeleteMemory(id: string): Promise<void> {
  const db = await ensureDb();
  runStmt(db, `DELETE FROM memories WHERE id = ?`, [id]);
}
