/**
 * Response Cache — LLM Response Memoization
 *
 * Control Corridor:
 * - Owns: Response storage, TTL management, cost tracking
 * - Must NOT own: LLM provider instantiation, prompt construction
 *
 * Caches LLM responses for repeated queries with TTL-based expiration
 * and cost tracking per cache hit/miss.
 */

import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Response Cache Types
// ---------------------------------------------------------------------------

export interface ResponseCacheEntry {
  id: string;
  promptHash: string;
  model: string;
  response: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  hitCount: number;
  createdAt: string;
  lastHitAt: string;
  expiresAt: string;
}

export interface ResponseCacheConfig {
  maxEntries: number;
  defaultTtlMs: number;
  costPerInputToken: number;   // Cost per input token in USD
  costPerOutputToken: number;  // Cost per output token in USD
}

export interface CacheMetrics {
  totalRequests: number;
  hits: number;
  misses: number;
  hitRate: number;
  tokensSaved: number;
  costSavedUsd: number;
}

// ---------------------------------------------------------------------------
// Response Cache
// ---------------------------------------------------------------------------

export class ResponseCache extends EventEmitter {
  private config: ResponseCacheConfig;
  private entries: Map<string, ResponseCacheEntry> = new Map();
  private hashIndex: Map<string, string> = new Map();
  private metrics: CacheMetrics = {
    totalRequests: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    tokensSaved: 0,
    costSavedUsd: 0,
  };

  constructor(config: Partial<ResponseCacheConfig> = {}) {
    super();
    this.config = {
      maxEntries: config.maxEntries ?? 1000,
      defaultTtlMs: config.defaultTtlMs ?? 3600000,  // 1 hour
      costPerInputToken: config.costPerInputToken ?? 0.000003,  // ~$3/1M tokens
      costPerOutputToken: config.costPerOutputToken ?? 0.000015,  // ~$15/1M tokens
    };
  }

  // ---------------------------------------------------------------------------
  // Cache Operations
  // ---------------------------------------------------------------------------

  /**
   * Look up a response in the cache.
   */
  lookup(prompt: string, model: string): ResponseCacheEntry | null {
    this.metrics.totalRequests++;

    const hash = this.hashPrompt(prompt);
    const entryId = this.hashIndex.get(hash);
    if (!entryId) {
      this.metrics.misses++;
      this.updateHitRate();
      return null;
    }

    const entry = this.entries.get(entryId);
    if (!entry) {
      this.metrics.misses++;
      this.updateHitRate();
      return null;
    }

    if (entry.model !== model) {
      this.metrics.misses++;
      this.updateHitRate();
      return null;
    }

    if (this.isExpired(entry)) {
      this.invalidate(entry.id);
      this.metrics.misses++;
      this.updateHitRate();
      return null;
    }

    // Record hit
    entry.hitCount++;
    entry.lastHitAt = new Date().toISOString();

    // Update metrics
    this.metrics.hits++;
    this.metrics.tokensSaved += entry.inputTokens + entry.outputTokens;
    this.metrics.costSavedUsd += entry.costUsd;
    this.updateHitRate();

    this.emit("hit", { entry });
    return entry;
  }

  /**
   * Store a response in the cache.
   */
  store(
    prompt: string,
    response: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): ResponseCacheEntry {
    const hash = this.hashPrompt(prompt);

    // Check if we need to evict
    if (this.entries.size >= this.config.maxEntries) {
      this.evict();
    }

    // Calculate cost
    const costUsd = (inputTokens * this.config.costPerInputToken) +
                    (outputTokens * this.config.costPerOutputToken);

    const entry: ResponseCacheEntry = {
      id: `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      promptHash: hash,
      model,
      response,
      inputTokens,
      outputTokens,
      costUsd,
      hitCount: 0,
      createdAt: new Date().toISOString(),
      lastHitAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.config.defaultTtlMs).toISOString(),
    };

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
    this.resetMetrics();
    this.emit("cleared");
  }

  /**
   * Get cache metrics.
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    totalEntries: number;
    totalHits: number;
    averageHits: number;
    totalCostSaved: number;
  } {
    const entries = Array.from(this.entries.values());
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
    const totalCostSaved = entries.reduce((sum, e) => sum + (e.hitCount * e.costUsd), 0);

    return {
      totalEntries: entries.length,
      totalHits,
      averageHits: entries.length > 0 ? totalHits / entries.length : 0,
      totalCostSaved,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isExpired(entry: ResponseCacheEntry): boolean {
    return new Date(entry.expiresAt) < new Date();
  }

  private evict(): void {
    // Evict LRU entry
    const entries = Array.from(this.entries.values());
    entries.sort((a, b) =>
      new Date(a.lastHitAt).getTime() - new Date(b.lastHitAt).getTime()
    );

    if (entries.length > 0) {
      this.invalidate(entries[0]!.id);
    }
  }

  private hashPrompt(prompt: string): string {
    const normalized = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private updateHitRate(): void {
    this.metrics.hitRate = this.metrics.totalRequests > 0
      ? this.metrics.hits / this.metrics.totalRequests
      : 0;
  }

  private resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      tokensSaved: 0,
      costSavedUsd: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  exportData(): ResponseCacheEntry[] {
    return Array.from(this.entries.values());
  }

  importData(entries: ResponseCacheEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
      this.hashIndex.set(entry.promptHash, entry.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createResponseCache(config?: Partial<ResponseCacheConfig>): ResponseCache {
  return new ResponseCache(config);
}
