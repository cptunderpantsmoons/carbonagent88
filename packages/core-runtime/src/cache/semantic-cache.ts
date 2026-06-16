/**
 * Semantic Cache — Exact and Near-Match Prompt Caching
 *
 * Control Corridor:
 * - Owns: Cache storage, hash matching, similarity matching, eviction
 * - Must NOT own: LLM provider instantiation, prompt construction
 *
 * Provides semantic caching for LLM prompts with both exact hash matching
 * and near-match via embedding similarity.
 */

import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Cache Types
// ---------------------------------------------------------------------------

export interface SemanticCacheEntry {
  id: string;
  promptHash: string;
  promptEmbedding: number[];
  promptNormalized: string;
  response: string;
  model: string;
  tokenCount: number;
  hitCount: number;
  createdAt: string;
  lastHitAt: string;
  expiresAt?: string;
  ttlMs: number;
}

export interface SemanticCacheConfig {
  maxEntries: number;
  defaultTtlMs: number;
  similarityThreshold: number;
  evictionPolicy: "lru" | "lfu" | "ttl";
}

export interface CacheHit {
  entry: SemanticCacheEntry;
  matchType: "exact" | "near";
  similarity: number;
}

// ---------------------------------------------------------------------------
// Semantic Cache
// ---------------------------------------------------------------------------

export class SemanticCache extends EventEmitter {
  private config: SemanticCacheConfig;
  private entries: Map<string, SemanticCacheEntry> = new Map();
  private hashIndex: Map<string, string> = new Map();  // hash -> entry ID

  constructor(config: Partial<SemanticCacheConfig> = {}) {
    super();
    this.config = {
      maxEntries: config.maxEntries ?? 1000,
      defaultTtlMs: config.defaultTtlMs ?? 3600000,  // 1 hour
      similarityThreshold: config.similarityThreshold ?? 0.95,
      evictionPolicy: config.evictionPolicy ?? "lru",
    };
  }

  // ---------------------------------------------------------------------------
  // Cache Operations
  // ---------------------------------------------------------------------------

  /**
   * Look up a prompt in the cache.
   */
  lookup(prompt: string, model: string, embedding?: number[]): CacheHit | null {
    const hash = this.hashPrompt(prompt);

    // Exact match first
    const exactEntry = this.findByHash(hash, model);
    if (exactEntry) {
      this.recordHit(exactEntry);
      return { entry: exactEntry, matchType: "exact", similarity: 1 };
    }

    // Near-match via embedding similarity
    if (embedding) {
      const nearEntry = this.findNearMatch(embedding, model);
      if (nearEntry) {
        this.recordHit(nearEntry);
        return { entry: nearEntry, matchType: "near", similarity: nearEntry.score };
      }
    }

    return null;
  }

  /**
   * Store a prompt-response pair in the cache.
   */
  store(
    prompt: string,
    response: string,
    model: string,
    tokenCount: number,
    embedding?: number[],
  ): SemanticCacheEntry {
    const hash = this.hashPrompt(prompt);
    const normalized = this.normalizePrompt(prompt);

    // Check if we need to evict
    if (this.entries.size >= this.config.maxEntries) {
      this.evict();
    }

    const entry: SemanticCacheEntry = {
      id: `cache_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      promptHash: hash,
      promptEmbedding: embedding ?? this.simpleEmbed(prompt),
      promptNormalized: normalized,
      response,
      model,
      tokenCount,
      hitCount: 0,
      createdAt: new Date().toISOString(),
      lastHitAt: new Date().toISOString(),
      ttlMs: this.config.defaultTtlMs,
    };

    // Set expiration
    const ttl = this.config.defaultTtlMs;
    entry.expiresAt = new Date(Date.now() + ttl).toISOString();

    this.entries.set(entry.id, entry);
    this.hashIndex.set(hash, entry.id);

    this.emit("stored", { entry });
    return entry;
  }

  /**
   * Invalidate a cache entry.
   */
  invalidate(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    this.entries.delete(id);
    this.hashIndex.delete(entry.promptHash);

    this.emit("invalidated", { id });
    return true;
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.entries.clear();
    this.hashIndex.clear();
    this.emit("cleared");
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    totalEntries: number;
    totalHits: number;
    averageHits: number;
    hitRate: number;
    tokenSavings: number;
  } {
    const entries = Array.from(this.entries.values());
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
    const tokenSavings = entries.reduce((sum, e) => sum + (e.hitCount * e.tokenCount), 0);

    return {
      totalEntries: entries.length,
      totalHits,
      averageHits: entries.length > 0 ? totalHits / entries.length : 0,
      hitRate: 0,  // Would need to track total lookups
      tokenSavings,
    };
  }

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------

  private findByHash(hash: string, model: string): SemanticCacheEntry | null {
    const entryId = this.hashIndex.get(hash);
    if (!entryId) return null;

    const entry = this.entries.get(entryId);
    if (!entry) return null;
    if (entry.model !== model) return null;
    if (this.isExpired(entry)) return null;

    return entry;
  }

  private findNearMatch(
    queryEmbedding: number[],
    model: string,
  ): (SemanticCacheEntry & { score: number }) | null {
    let bestMatch: (SemanticCacheEntry & { score: number }) | null = null;
    let bestScore = 0;

    for (const entry of this.entries.values()) {
      if (entry.model !== model) continue;
      if (this.isExpired(entry)) continue;

      const similarity = this.cosineSimilarity(queryEmbedding, entry.promptEmbedding);
      if (similarity >= this.config.similarityThreshold && similarity > bestScore) {
        bestMatch = { ...entry, score: similarity };
        bestScore = similarity;
      }
    }

    return bestMatch;
  }

  private isExpired(entry: SemanticCacheEntry): boolean {
    if (!entry.expiresAt) return false;
    return new Date(entry.expiresAt) < new Date();
  }

  // ---------------------------------------------------------------------------
  // Eviction
  // ---------------------------------------------------------------------------

  private evict(): void {
    const entries = Array.from(this.entries.values());

    switch (this.config.evictionPolicy) {
      case "lru":
        this.evictLRU(entries);
        break;
      case "lfu":
        this.evictLFU(entries);
        break;
      case "ttl":
        this.evictTTL(entries);
        break;
    }
  }

  private evictLRU(entries: SemanticCacheEntry[]): void {
    // Sort by last access time
    entries.sort((a, b) =>
      new Date(a.lastHitAt).getTime() - new Date(b.lastHitAt).getTime()
    );

    // Remove oldest
    if (entries.length > 0) {
      this.invalidate(entries[0]!.id);
    }
  }

  private evictLFU(entries: SemanticCacheEntry[]): void {
    // Sort by hit count
    entries.sort((a, b) => a.hitCount - b.hitCount);

    // Remove least frequently used
    if (entries.length > 0) {
      this.invalidate(entries[0]!.id);
    }
  }

  private evictTTL(entries: SemanticCacheEntry[]): void {
    // Sort by expiration time
    entries.sort((a, b) => {
      const aExpiry = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
      const bExpiry = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
      return aExpiry - bExpiry;
    });

    // Remove earliest expiring
    if (entries.length > 0) {
      this.invalidate(entries[0]!.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private recordHit(entry: SemanticCacheEntry): void {
    entry.hitCount++;
    entry.lastHitAt = new Date().toISOString();
    this.emit("hit", { entry });
  }

  private hashPrompt(prompt: string): string {
    const normalized = this.normalizePrompt(prompt);
    // Simple hash - in production use SHA-256
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  private normalizePrompt(prompt: string): string {
    return prompt
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cosineSimilarity(a: number[], b: number[]): number {
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

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  exportData(): SemanticCacheEntry[] {
    return Array.from(this.entries.values());
  }

  importData(entries: SemanticCacheEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
      this.hashIndex.set(entry.promptHash, entry.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSemanticCache(config?: Partial<SemanticCacheConfig>): SemanticCache {
  return new SemanticCache(config);
}
