/**
 * Semantic Memory — Hybrid BM25 + Vector Retrieval
 *
 * Control Corridor:
 * - Owns: Fact storage, hybrid retrieval, importance scoring, decay
 * - Must NOT own: Embedding generation, database persistence (uses injected providers)
 *
 * Provides semantic memory with complementary BM25 keyword search
 * and vector similarity search for robust retrieval.
 */

import { EventEmitter } from "node:events";
import { BM25Index, type BM25Document } from "./bm25.js";

// ---------------------------------------------------------------------------
// Semantic Memory Types
// ---------------------------------------------------------------------------

export interface SemanticMemoryConfig {
  maxMemories: number;
  decayRate: number;           // Lambda for exponential decay
  minImportance: number;       // Minimum importance to keep
  hybridWeights: {
    bm25: number;
    vector: number;
  };
  embeddingDimensions: number;
}

export interface SemanticMemoryEntry {
  id: string;
  workspaceId: string;
  key: string;
  content: string;
  embedding: number[];
  bm25Terms: string[];
  source: string;
  confidence: number;
  importance: number;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
}

export interface SemanticMemoryQuery {
  query: string;
  workspaceId: string;
  limit: number;
  minImportance?: number;
  after?: string;
}

export interface SemanticMemoryResult {
  entry: SemanticMemoryEntry;
  score: number;
  source: "bm25" | "vector" | "hybrid";
}

export interface SemanticMemoryStats {
  totalEntries: number;
  averageImportance: number;
  averageAccessCount: number;
  oldestEntry?: string;
  newestEntry?: string;
}

// ---------------------------------------------------------------------------
// Semantic Memory
// ---------------------------------------------------------------------------

export class SemanticMemory extends EventEmitter {
  private config: SemanticMemoryConfig;
  private entries: Map<string, SemanticMemoryEntry> = new Map();
  private bm25Index: BM25Index;
  private workspaceIndexes: Map<string, BM25Index> = new Map();

  constructor(config: Partial<SemanticMemoryConfig> = {}) {
    super();
    this.config = {
      maxMemories: config.maxMemories ?? 10000,
      decayRate: config.decayRate ?? 0.01,
      minImportance: config.minImportance ?? 0.1,
      hybridWeights: config.hybridWeights ?? { bm25: 0.4, vector: 0.6 },
      embeddingDimensions: config.embeddingDimensions ?? 384,
    };
    this.bm25Index = new BM25Index();
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  /**
   * Store a new semantic memory entry.
   */
  store(entry: Omit<SemanticMemoryEntry, "bm25Terms" | "accessCount" | "updatedAt" | "lastAccessedAt">): SemanticMemoryEntry {
    const now = new Date().toISOString();
    const fullEntry: SemanticMemoryEntry = {
      ...entry,
      bm25Terms: this.extractTerms(entry.content),
      accessCount: 0,
      updatedAt: now,
      lastAccessedAt: now,
    };

    this.entries.set(fullEntry.id, fullEntry);

    // Add to BM25 index
    const bm25Doc: BM25Document = {
      id: fullEntry.id,
      content: `${fullEntry.key} ${fullEntry.content}`,
      metadata: { workspaceId: fullEntry.workspaceId },
    };
    this.getWorkspaceIndex(fullEntry.workspaceId).addDocument(bm25Doc);

    this.emit("stored", { entry: fullEntry });
    return fullEntry;
  }

  /**
   * Update an existing memory entry.
   */
  update(id: string, updates: Partial<Pick<SemanticMemoryEntry, "content" | "importance" | "confidence" | "source">>): SemanticMemoryEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    const now = new Date().toISOString();
    const updatedEntry: SemanticMemoryEntry = {
      ...entry,
      ...updates,
      bm25Terms: updates.content ? this.extractTerms(updates.content) : entry.bm25Terms,
      updatedAt: now,
    };

    this.entries.set(id, updatedEntry);

    // Update BM25 index
    const workspaceIndex = this.workspaceIndexes.get(entry.workspaceId);
    if (workspaceIndex) {
      workspaceIndex.removeDocument(id);
      workspaceIndex.addDocument({
        id: updatedEntry.id,
        content: `${updatedEntry.key} ${updatedEntry.content}`,
        metadata: { workspaceId: updatedEntry.workspaceId },
      });
    }

    this.emit("updated", { entry: updatedEntry });
    return updatedEntry;
  }

  /**
   * Delete a memory entry.
   */
  delete(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    this.entries.delete(id);

    // Remove from BM25 index
    const workspaceIndex = this.workspaceIndexes.get(entry.workspaceId);
    if (workspaceIndex) {
      workspaceIndex.removeDocument(id);
    }

    this.emit("deleted", { id });
    return true;
  }

  /**
   * Get a memory entry by ID.
   */
  get(id: string): SemanticMemoryEntry | null {
    return this.entries.get(id) ?? null;
  }

  /**
   * List all memories for a workspace.
   */
  list(workspaceId: string, limit?: number): SemanticMemoryEntry[] {
    const entries = Array.from(this.entries.values())
      .filter(e => e.workspaceId === workspaceId)
      .sort((a, b) => b.importance - a.importance);

    return limit ? entries.slice(0, limit) : entries;
  }

  // ---------------------------------------------------------------------------
  // Retrieval
  // ---------------------------------------------------------------------------

  /**
   * Hybrid retrieval using both BM25 and vector similarity.
   */
  async recall(
    query: SemanticMemoryQuery,
    vectorSimilarityFn?: (query: number[], candidates: number[][]) => number[],
  ): Promise<SemanticMemoryResult[]> {
    const { query: queryText, workspaceId, limit, minImportance, after } = query;

    // Get candidates from BM25
    const bm25Results = this.bm25Search(queryText, workspaceId, limit * 2);

    // Get candidates from vector similarity (if provided)
    const vectorResults = vectorSimilarityFn
      ? this.vectorSearch(queryText, workspaceId, vectorSimilarityFn, limit * 2)
      : [];

    // Merge and rank results
    const merged = this.mergeResults(bm25Results, vectorResults, query);

    // Apply filters
    let filtered = merged;
    if (minImportance !== undefined) {
      filtered = filtered.filter(r => r.entry.importance >= minImportance);
    }
    if (after) {
      filtered = filtered.filter(r => r.entry.createdAt > after);
    }

    // Update access counts
    for (const result of filtered.slice(0, limit)) {
      this.recordAccess(result.entry.id);
    }

    return filtered.slice(0, limit);
  }

  /**
   * BM25 keyword search within a workspace.
   */
  private bm25Search(query: string, workspaceId: string, limit: number): SemanticMemoryResult[] {
    const index = this.workspaceIndexes.get(workspaceId);
    if (!index) return [];

    const results = index.search(query, limit);
    const mapped: SemanticMemoryResult[] = [];
    
    for (const r of results) {
      const entry = this.entries.get(r.documentId);
      if (entry) {
        mapped.push({
          entry,
          score: r.score,
          source: "bm25",
        });
      }
    }
    
    return mapped;
  }

  /**
   * Vector similarity search within a workspace.
   */
  private vectorSearch(
    query: string,
    workspaceId: string,
    similarityFn: (query: number[], candidates: number[][]) => number[],
    limit: number,
  ): SemanticMemoryResult[] {
    // Generate query embedding (simplified - in production would use real embedder)
    const queryEmbedding = this.simpleEmbed(query);

    // Get all embeddings for workspace
    const workspaceEntries = Array.from(this.entries.values())
      .filter(e => e.workspaceId === workspaceId);

    if (workspaceEntries.length === 0) return [];

    const embeddings = workspaceEntries.map(e => e.embedding);
    const scores = similarityFn(queryEmbedding, embeddings);

    // Combine entries with scores
    const scored = workspaceEntries.map((entry, i) => ({
      entry,
      score: scores[i] ?? 0,
      source: "vector" as const,
    }));

    // Sort by score and return top results
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Merge BM25 and vector results with hybrid scoring.
   */
  private mergeResults(
    bm25Results: SemanticMemoryResult[],
    vectorResults: SemanticMemoryResult[],
    _query: SemanticMemoryQuery,
  ): SemanticMemoryResult[] {
    const { bm25: bm25Weight, vector: vectorWeight } = this.config.hybridWeights;

    // Normalize scores to 0-1 range
    const maxBm25 = Math.max(...bm25Results.map(r => r.score), 1);
    const maxVector = Math.max(...vectorResults.map(r => r.score), 1);

    const normalizedBm25 = bm25Results.map(r => ({
      ...r,
      normalizedScore: r.score / maxBm25,
    }));

    const normalizedVector = vectorResults.map(r => ({
      ...r,
      normalizedScore: r.score / maxVector,
    }));

    // Merge by entry ID
    const mergedScores = new Map<string, { entry: SemanticMemoryEntry; bm25Score: number; vectorScore: number }>();

    for (const r of normalizedBm25) {
      mergedScores.set(r.entry.id, {
        entry: r.entry,
        bm25Score: r.normalizedScore,
        vectorScore: 0,
      });
    }

    for (const r of normalizedVector) {
      const existing = mergedScores.get(r.entry.id);
      if (existing) {
        existing.vectorScore = r.normalizedScore;
      } else {
        mergedScores.set(r.entry.id, {
          entry: r.entry,
          bm25Score: 0,
          vectorScore: r.normalizedScore,
        });
      }
    }

    // Calculate hybrid scores
    const results: SemanticMemoryResult[] = [];
    for (const [, data] of mergedScores) {
      const hybridScore = (data.bm25Score * bm25Weight) + (data.vectorScore * vectorWeight);
      results.push({
        entry: data.entry,
        score: hybridScore,
        source: "hybrid",
      });
    }

    // Sort by hybrid score
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  // ---------------------------------------------------------------------------
  // Importance & Decay
  // ---------------------------------------------------------------------------

  /**
   * Record an access to a memory (increases importance).
   */
  private recordAccess(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    entry.accessCount++;
    entry.lastAccessedAt = new Date().toISOString();
    // Boost importance on access (capped at 1.0)
    entry.importance = Math.min(1, entry.importance + 0.05);
  }

  /**
   * Apply time-based decay to all memories.
   */
  applyDecay(): number {
    const now = Date.now();
    let forgotten = 0;

    for (const [id, entry] of this.entries) {
      const lastAccess = new Date(entry.lastAccessedAt).getTime();
      const daysSinceAccess = (now - lastAccess) / (1000 * 60 * 60 * 24);

      // Exponential decay
      entry.importance *= Math.exp(-this.config.decayRate * daysSinceAccess);

      // Apply access-based decay (more accessed = slower decay)
      const accessFactor = Math.log1p(entry.accessCount) / 10;
      entry.importance *= (1 - accessFactor * 0.1);

      // Remove if below minimum importance
      if (entry.importance < this.config.minImportance) {
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
   * Boost importance for frequently accessed memories.
   */
  boostImportance(id: string, amount: number = 0.1): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    entry.importance = Math.min(1, entry.importance + amount);
    this.emit("importance_boosted", { id, newImportance: entry.importance });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get statistics for a workspace.
   */
  getStats(workspaceId: string): SemanticMemoryStats {
    const entries = Array.from(this.entries.values())
      .filter(e => e.workspaceId === workspaceId);

    if (entries.length === 0) {
      return {
        totalEntries: 0,
        averageImportance: 0,
        averageAccessCount: 0,
      };
    }

    const totalImportance = entries.reduce((sum, e) => sum + e.importance, 0);
    const totalAccess = entries.reduce((sum, e) => sum + e.accessCount, 0);

    const sortedByDate = entries.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    return {
      totalEntries: entries.length,
      averageImportance: totalImportance / entries.length,
      averageAccessCount: totalAccess / entries.length,
      oldestEntry: sortedByDate[0]?.createdAt,
      newestEntry: sortedByDate[sortedByDate.length - 1]?.createdAt,
    };
  }

  /**
   * Get index statistics.
   */
  getIndexStats(): Map<string, ReturnType<BM25Index['getStats']>> {
    const stats = new Map();
    for (const [workspaceId, index] of this.workspaceIndexes) {
      stats.set(workspaceId, index.getStats());
    }
    return stats;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getWorkspaceIndex(workspaceId: string): BM25Index {
    if (!this.workspaceIndexes.has(workspaceId)) {
      this.workspaceIndexes.set(workspaceId, new BM25Index());
    }
    return this.workspaceIndexes.get(workspaceId)!;
  }

  private extractTerms(content: string): string[] {
    return this.bm25Index.tokenize(content);
  }

  /**
   * Simple hash-based embedding (fallback for testing).
   * In production, use real embedding provider.
   */
  private simpleEmbed(text: string): number[] {
    const dims = this.config.embeddingDimensions;
    const vec = new Array(dims).fill(0);

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      vec[code % dims] += 1;
      vec[(code * 31) % dims] += 0.5;
      vec[(code * 97 + i) % dims] += 0.25;
    }

    // Normalize
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return mag > 0 ? vec.map(v => v / mag) : vec;
  }

  /**
   * Export all data for persistence.
   */
  exportData(): {
    entries: SemanticMemoryEntry[];
    bm25Data: ReturnType<BM25Index['exportData']>[];
  } {
    return {
      entries: Array.from(this.entries.values()),
      bm25Data: Array.from(this.workspaceIndexes.values()).map(idx => idx.exportData()),
    };
  }

  /**
   * Import data from persistence.
   */
  importData(data: {
    entries: SemanticMemoryEntry[];
    bm25Data?: ReturnType<BM25Index['exportData']>[];
  }): void {
    for (const entry of data.entries) {
      this.entries.set(entry.id, entry);
    }

    // Rebuild BM25 indexes
    for (const entry of data.entries) {
      const index = this.getWorkspaceIndex(entry.workspaceId);
      index.addDocument({
        id: entry.id,
        content: `${entry.key} ${entry.content}`,
        metadata: { workspaceId: entry.workspaceId },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Cosine Similarity Helper
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

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

/**
 * Vector similarity function using cosine similarity.
 */
export function vectorSimilarity(query: number[], candidates: number[][]): number[] {
  return candidates.map(c => cosineSimilarity(query, c));
}
