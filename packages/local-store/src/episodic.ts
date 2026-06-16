/**
 * Episodic Memory Persistence Helpers
 *
 * Wraps CarbonDatabase episodic methods into a persistence adapter that can be
 * injected into core-runtime EpisodicMemory via callbacks. This preserves the
 * dependency boundary: core-runtime never imports local-store.
 */

import type { CarbonDatabase } from "./sqlite.js";

export type EpisodicEventType = "conversation" | "task" | "tool_use" | "decision" | "error";
export type EpisodicOutcome = "success" | "failure" | "partial";

export interface EpisodicEvent {
  id: string;
  workspaceId: string;
  type: EpisodicEventType;
  summary: string;
  details: Record<string, unknown>;
  outcome: EpisodicOutcome;
  embedding: number[];
  importance: number;
  accessCount: number;
  decayFactor: number;
  createdAt: string;
  lastAccessedAt: string;
}

export interface EpisodicPersistenceAdapter {
  load(workspaceId: string): Promise<EpisodicEvent[]>;
  save(workspaceId: string, events: EpisodicEvent[]): Promise<void>;
  store(event: EpisodicEvent): Promise<void>;
  deleteEvents(ids: string[]): Promise<void>;
  deleteEventsByRange(workspaceId: string, before: string): Promise<void>;
  flush?(): Promise<void>;
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value ?? JSON.stringify(fallback))) as T;
  } catch {
    return fallback;
  }
}

function parseEmbedding(json: string | unknown): number[] {
  return parseJson<number[]>(json, []);
}

function parseDetails(json: string | unknown): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(json, {});
}

export function mapEpisodicRow(row: Record<string, unknown>): EpisodicEvent {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    type: String(row.type) as EpisodicEventType,
    summary: String(row.summary),
    details: parseDetails(row.details_json),
    outcome: String(row.outcome) as EpisodicOutcome,
    embedding: parseEmbedding(row.embedding_json),
    importance: Number(row.importance ?? 0.5),
    accessCount: Number(row.access_count ?? 0),
    decayFactor: Number(row.decay_factor ?? 1.0),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    lastAccessedAt: String(row.last_accessed_at ?? new Date().toISOString()),
  };
}

/**
 * Creates a persistence adapter backed by a CarbonDatabase instance.
 */
export function createEpisodicPersistenceAdapter(db: CarbonDatabase): EpisodicPersistenceAdapter {
  return {
    async load(workspaceId: string): Promise<EpisodicEvent[]> {
      const rows = await db.findEpisodicEvents({ workspaceId, includeEmbeddings: true });
      return rows.map((row) => mapEpisodicRow(row));
    },

    async save(workspaceId: string, events: EpisodicEvent[]): Promise<void> {
      // Persist each event individually. This is acceptable for the expected
      // volumes and keeps the adapter simple and transaction-free.
      for (const event of events) {
        if (event.workspaceId !== workspaceId) continue;
        await db.storeEpisodicEvent(event);
      }
    },

    async store(event: EpisodicEvent): Promise<void> {
      await db.storeEpisodicEvent(event);
    },

    async deleteEvents(ids: string[]): Promise<void> {
      await db.deleteEpisodicEvents(ids);
    },

    async deleteEventsByRange(workspaceId: string, before: string): Promise<void> {
      await db.deleteEpisodicEventsByRange(workspaceId, before);
    },

    async flush(): Promise<void> {
      // Individual store() calls already write through; nothing to batch.
    },
  };
}
