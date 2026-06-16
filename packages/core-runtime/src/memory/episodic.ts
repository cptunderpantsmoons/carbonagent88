/**
 * Episodic Memory — Temporal Event Storage
 *
 * Control Corridor:
 * - Owns: Event storage, temporal indexing, decay-based forgetting
 * - Must NOT own: Embedding generation, database persistence
 *
 * Stores conversation history, task outcomes, and decision events
 * with temporal indexing for "what happened" queries.
 */

import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Episodic Memory Types
// ---------------------------------------------------------------------------

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

export interface EpisodicQuery {
  workspaceId: string;
  type?: EpisodicEventType;
  outcome?: EpisodicOutcome;
  after?: string;
  before?: string;
  limit: number;
}

export interface EpisodicResult {
  event: EpisodicEvent;
  relevance: number;
}

export interface EpisodicStats {
  totalEvents: number;
  byType: Record<EpisodicEventType, number>;
  byOutcome: Record<EpisodicOutcome, number>;
  averageImportance: number;
  averageDecayFactor: number;
}

// ---------------------------------------------------------------------------
// Episodic Memory
// ---------------------------------------------------------------------------

export class EpisodicMemory extends EventEmitter {
  private events: Map<string, EpisodicEvent> = new Map();
  private workspaceIndexes: Map<string, Set<string>> = new Map();
  private typeIndexes: Map<string, Set<string>> = new Map();
  private decayRate: number;
  private maxEvents: number;

  constructor(config: { decayRate?: number; maxEvents?: number } = {}) {
    super();
    this.decayRate = config.decayRate ?? 0.01;
    this.maxEvents = config.maxEvents ?? 10000;
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  /**
   * Record a new episodic event.
   */
  record(event: Omit<EpisodicEvent, "decayFactor" | "accessCount" | "lastAccessedAt">): EpisodicEvent {
    const fullEvent: EpisodicEvent = {
      ...event,
      decayFactor: 1.0,
      accessCount: 0,
      lastAccessedAt: event.createdAt,
    };

    this.events.set(fullEvent.id, fullEvent);

    // Update indexes
    this.addToIndex(fullEvent);

    // Enforce max events limit
    if (this.events.size > this.maxEvents) {
      this.evictOldest(fullEvent.workspaceId);
    }

    this.emit("recorded", { event: fullEvent });
    return fullEvent;
  }

  /**
   * Get an event by ID.
   */
  get(id: string): EpisodicEvent | null {
    const event = this.events.get(id);
    if (event) {
      this.recordAccess(id);
    }
    return event ?? null;
  }

  /**
   * Delete an event.
   */
  delete(id: string): boolean {
    const event = this.events.get(id);
    if (!event) return false;

    this.events.delete(id);
    this.removeFromIndex(event);

    this.emit("deleted", { id });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Retrieval
  // ---------------------------------------------------------------------------

  /**
   * Query episodic events with filters.
   */
  query(query: EpisodicQuery): EpisodicResult[] {
    const { workspaceId, type, outcome, after, before, limit } = query;

    // Get candidate IDs from workspace index
    const candidateIds = this.workspaceIndexes.get(workspaceId) ?? new Set();
    let candidates = Array.from(candidateIds)
      .map(id => this.events.get(id))
      .filter((e): e is EpisodicEvent => e !== undefined);

    // Apply filters
    if (type) {
      candidates = candidates.filter(e => e.type === type);
    }
    if (outcome) {
      candidates = candidates.filter(e => e.outcome === outcome);
    }
    if (after) {
      candidates = candidates.filter(e => e.createdAt > after);
    }
    if (before) {
      candidates = candidates.filter(e => e.createdAt < before);
    }

    // Sort by importance and recency
    candidates.sort((a, b) => {
      // Weight by importance and recency
      const scoreA = a.importance * a.decayFactor;
      const scoreB = b.importance * b.decayFactor;
      return scoreB - scoreA;
    });

    // Return top results with relevance scores
    return candidates.slice(0, limit).map(event => ({
      event,
      relevance: event.importance * event.decayFactor,
    }));
  }

  /**
   * Search events by content similarity.
   */
  async search(
    query: string,
    workspaceId: string,
    limit: number,
    similarityFn?: (queryEmbedding: number[], candidates: number[][]) => number[],
  ): Promise<EpisodicResult[]> {
    const candidateIds = this.workspaceIndexes.get(workspaceId) ?? new Set();
    const candidates = Array.from(candidateIds)
      .map(id => this.events.get(id))
      .filter((e): e is EpisodicEvent => e !== undefined);

    if (candidates.length === 0) return [];

    let scored: Array<{ event: EpisodicEvent; score: number }>;

    if (similarityFn) {
      // Use provided similarity function
      const queryEmbedding = this.simpleEmbed(query);
      const embeddings = candidates.map(e => e.embedding);
      const scores = similarityFn(queryEmbedding, embeddings);

      scored = candidates.map((event, i) => ({
        event,
        score: scores[i] ?? 0,
      }));
    } else {
      // Fallback to simple text matching
      scored = candidates.map(event => ({
        event,
        score: this.textSimilarity(query, event.summary),
      }));
    }

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Record access and return
    return scored.slice(0, limit).map(({ event, score }) => {
      this.recordAccess(event.id);
      return { event, relevance: score };
    });
  }

  /**
   * Get recent events for a workspace.
   */
  getRecent(workspaceId: string, limit: number = 10): EpisodicEvent[] {
    const candidateIds = this.workspaceIndexes.get(workspaceId) ?? new Set();
    const candidates = Array.from(candidateIds)
      .map(id => this.events.get(id))
      .filter((e): e is EpisodicEvent => e !== undefined);

    // Sort by creation time descending
    candidates.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return candidates.slice(0, limit);
  }

  /**
   * Get events by type.
   */
  getByType(workspaceId: string, type: EpisodicEventType, limit?: number): EpisodicEvent[] {
    const typeKey = `${workspaceId}:${type}`;
    const typeIds = this.typeIndexes.get(typeKey) ?? new Set();

    const events = Array.from(typeIds)
      .map(id => this.events.get(id))
      .filter((e): e is EpisodicEvent => e !== undefined)
      .sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    return limit ? events.slice(0, limit) : events;
  }

  // ---------------------------------------------------------------------------
  // Decay & Forgetting
  // ---------------------------------------------------------------------------

  /**
   * Apply time-based decay to all events.
   */
  applyDecay(): number {
    const now = Date.now();
    let forgotten = 0;

    for (const [id, event] of this.events) {
      const lastAccess = new Date(event.lastAccessedAt).getTime();
      const daysSinceAccess = (now - lastAccess) / (1000 * 60 * 60 * 24);

      // Exponential decay
      event.decayFactor = Math.exp(-this.decayRate * daysSinceAccess);

      // Apply access bonus (more accessed = slower decay)
      const accessBonus = Math.min(0.5, Math.log1p(event.accessCount) * 0.1);
      event.decayFactor = Math.min(1, event.decayFactor + accessBonus);

      // Remove if decayed too much
      if (event.decayFactor < 0.01) {
        this.delete(id);
        forgotten++;
      }
    }

    if (forgotten > 0) {
      this.emit("decay_applied", { forgotten });
    }

    return forgotten;
  }

  /**
   * Forget events older than a certain date.
   */
  forgetBefore(date: string): number {
    let forgotten = 0;

    for (const [id, event] of this.events) {
      if (event.createdAt < date) {
        this.delete(id);
        forgotten++;
      }
    }

    return forgotten;
  }

  /**
   * Forget events with low importance.
   */
  forgetLowImportance(threshold: number = 0.2): number {
    let forgotten = 0;

    for (const [id, event] of this.events) {
      if (event.importance < threshold) {
        this.delete(id);
        forgotten++;
      }
    }

    return forgotten;
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get statistics for a workspace.
   */
  getStats(workspaceId: string): EpisodicStats {
    const candidateIds = this.workspaceIndexes.get(workspaceId) ?? new Set();
    const events = Array.from(candidateIds)
      .map(id => this.events.get(id))
      .filter((e): e is EpisodicEvent => e !== undefined);

    if (events.length === 0) {
      return {
        totalEvents: 0,
        byType: { conversation: 0, task: 0, tool_use: 0, decision: 0, error: 0 },
        byOutcome: { success: 0, failure: 0, partial: 0 },
        averageImportance: 0,
        averageDecayFactor: 0,
      };
    }

    const byType: Record<EpisodicEventType, number> = {
      conversation: 0, task: 0, tool_use: 0, decision: 0, error: 0,
    };
    const byOutcome: Record<EpisodicOutcome, number> = {
      success: 0, failure: 0, partial: 0,
    };

    let totalImportance = 0;
    let totalDecay = 0;

    for (const event of events) {
      byType[event.type]++;
      byOutcome[event.outcome]++;
      totalImportance += event.importance;
      totalDecay += event.decayFactor;
    }

    return {
      totalEvents: events.length,
      byType,
      byOutcome,
      averageImportance: totalImportance / events.length,
      averageDecayFactor: totalDecay / events.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private addToIndex(event: EpisodicEvent): void {
    // Workspace index
    if (!this.workspaceIndexes.has(event.workspaceId)) {
      this.workspaceIndexes.set(event.workspaceId, new Set());
    }
    this.workspaceIndexes.get(event.workspaceId)!.add(event.id);

    // Type index
    const typeKey = `${event.workspaceId}:${event.type}`;
    if (!this.typeIndexes.has(typeKey)) {
      this.typeIndexes.set(typeKey, new Set());
    }
    this.typeIndexes.get(typeKey)!.add(event.id);
  }

  private removeFromIndex(event: EpisodicEvent): void {
    // Workspace index
    const workspaceIds = this.workspaceIndexes.get(event.workspaceId);
    if (workspaceIds) {
      workspaceIds.delete(event.id);
    }

    // Type index
    const typeKey = `${event.workspaceId}:${event.type}`;
    const typeIds = this.typeIndexes.get(typeKey);
    if (typeIds) {
      typeIds.delete(event.id);
    }
  }

  private recordAccess(id: string): void {
    const event = this.events.get(id);
    if (event) {
      event.accessCount++;
      event.lastAccessedAt = new Date().toISOString();
      // Boost importance on access
      event.importance = Math.min(1, event.importance + 0.02);
    }
  }

  private evictOldest(workspaceId: string): void {
    const candidateIds = this.workspaceIndexes.get(workspaceId) ?? new Set();
    const events = Array.from(candidateIds)
      .map(id => this.events.get(id))
      .filter((e): e is EpisodicEvent => e !== undefined)
      .sort((a, b) => a.importance - b.importance);

    // Remove the least important event
    if (events.length > 0) {
      const oldest = events[0]!;
      this.delete(oldest.id);
    }
  }

  private textSimilarity(query: string, text: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const textTerms = text.toLowerCase().split(/\s+/);
    const textSet = new Set(textTerms);

    let matches = 0;
    for (const term of queryTerms) {
      if (textSet.has(term)) matches++;
    }

    return matches / queryTerms.length;
  }

  /**
   * Simple hash-based embedding (fallback for testing).
   */
  private simpleEmbed(text: string): number[] {
    const dims = 384;
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

  /**
   * Export data for persistence.
   */
  exportData(): EpisodicEvent[] {
    return Array.from(this.events.values());
  }

  /**
   * Import data from persistence.
   */
  importData(events: EpisodicEvent[]): void {
    for (const event of events) {
      this.events.set(event.id, event);
      this.addToIndex(event);
    }
  }
}
