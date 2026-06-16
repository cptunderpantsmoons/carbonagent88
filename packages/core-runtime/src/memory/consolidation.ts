/**
 * Memory Consolidation — Periodic Compression & Summarization
 *
 * Control Corridor:
 * - Owns: Memory compression, summarization, deduplication
 * - Must NOT own: Memory storage, embedding generation
 *
 * Periodically consolidates episodic memories into semantic memories,
 * compresses old context, and deduplicates similar memories.
 */

import { EventEmitter } from "node:events";
import type { SemanticMemory, SemanticMemoryEntry } from "./semantic.js";
import type { EpisodicMemory, EpisodicEvent } from "./episodic.js";

// ---------------------------------------------------------------------------
// Consolidation Types
// ---------------------------------------------------------------------------

export interface ConsolidationConfig {
  enabled: boolean;
  intervalMs: number;
  minEventsToConsolidate: number;
  maxMemoriesPerConsolidation: number;
  deduplicationThreshold: number;
  compressionRatio: number;
}

export interface ConsolidationResult {
  id: string;
  timestamp: string;
  consolidatedCount: number;
  compressedCount: number;
  forgottenCount: number;
  deduplicatedCount: number;
  details: string;
}

export interface MemoryCluster {
  id: string;
  events: EpisodicEvent[];
  summary: string;
  keyTopics: string[];
  averageImportance: number;
}

// ---------------------------------------------------------------------------
// Memory Consolidation
// ---------------------------------------------------------------------------

export class MemoryConsolidation extends EventEmitter {
  private config: ConsolidationConfig;
  private semanticMemory: SemanticMemory;
  private episodicMemory: EpisodicMemory;
  private consolidationHistory: ConsolidationResult[] = [];
  private consolidationTimer?: ReturnType<typeof setInterval>;

  constructor(
    semanticMemory: SemanticMemory,
    episodicMemory: EpisodicMemory,
    config: Partial<ConsolidationConfig> = {},
  ) {
    super();
    this.semanticMemory = semanticMemory;
    this.episodicMemory = episodicMemory;
    this.config = {
      enabled: config.enabled ?? true,
      intervalMs: config.intervalMs ?? 3600000, // 1 hour
      minEventsToConsolidate: config.minEventsToConsolidate ?? 5,
      maxMemoriesPerConsolidation: config.maxMemoriesPerConsolidation ?? 50,
      deduplicationThreshold: config.deduplicationThreshold ?? 0.9,
      compressionRatio: config.compressionRatio ?? 0.5,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start automatic consolidation.
   */
  start(): void {
    if (this.consolidationTimer) return;

    this.consolidationTimer = setInterval(() => {
      this.consolidate();
    }, this.config.intervalMs);

    this.emit("started");
  }

  /**
   * Stop automatic consolidation.
   */
  stop(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = undefined;
    }
    this.emit("stopped");
  }

  /**
   * Check if consolidation is running.
   */
  isRunning(): boolean {
    return this.consolidationTimer !== undefined;
  }

  // ---------------------------------------------------------------------------
  // Consolidation
  // ---------------------------------------------------------------------------

  /**
   * Run a consolidation cycle.
   */
  async consolidate(workspaceId?: string): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      id: `consolidation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      consolidatedCount: 0,
      compressedCount: 0,
      forgottenCount: 0,
      deduplicatedCount: 0,
      details: "",
    };

    try {
      // 1. Apply decay to both memory systems
      const forgottenEpisodic = this.episodicMemory.applyDecay();
      result.forgottenCount += forgottenEpisodic;

      // 2. Get recent episodic events
      const events = workspaceId
        ? this.episodicMemory.getRecent(workspaceId, 1000)
        : [];

      if (events.length < this.config.minEventsToConsolidate) {
        result.details = `Not enough events to consolidate (${events.length} < ${this.config.minEventsToConsolidate})`;
        this.consolidationHistory.push(result);
        return result;
      }

      // 3. Cluster related events
      const clusters = this.clusterEvents(events);

      // 4. Consolidate each cluster into semantic memories
      for (const cluster of clusters) {
        if (result.consolidatedCount >= this.config.maxMemoriesPerConsolidation) break;

        const memory = this.createMemoryFromCluster(cluster, workspaceId ?? "default");
        if (memory) {
          this.semanticMemory.store(memory);
          result.consolidatedCount++;
        }
      }

      // 5. Deduplicate similar memories
      if (workspaceId) {
        result.deduplicatedCount = await this.deduplicateMemories(workspaceId);
      }

      // 6. Compress old memories
      result.compressedCount = this.compressOldMemories(workspaceId);

      result.details = `Consolidated ${result.consolidatedCount} memories, deduplicated ${result.deduplicatedCount}, compressed ${result.compressedCount}, forgot ${result.forgottenCount}`;

      this.consolidationHistory.push(result);
      this.emit("completed", result);

    } catch (error) {
      result.details = `Consolidation failed: ${error instanceof Error ? error.message : String(error)}`;
      this.emit("failed", { result, error });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Clustering
  // ---------------------------------------------------------------------------

  /**
   * Cluster related episodic events.
   */
  private clusterEvents(events: EpisodicEvent[]): MemoryCluster[] {
    const clusters: MemoryCluster[] = [];
    const used = new Set<string>();

    for (const event of events) {
      if (used.has(event.id)) continue;

      const cluster: EpisodicEvent[] = [event];
      used.add(event.id);

      // Find related events (same type, similar content, close in time)
      for (const other of events) {
        if (used.has(other.id)) continue;

        const isRelated = this.areEventsRelated(event, other);
        if (isRelated) {
          cluster.push(other);
          used.add(other.id);
        }
      }

      // Create cluster if it has multiple events
      if (cluster.length >= 2) {
        clusters.push({
          id: `cluster_${Date.now()}_${clusters.length}`,
          events: cluster,
          summary: this.generateClusterSummary(cluster),
          keyTopics: this.extractKeyTopics(cluster),
          averageImportance: cluster.reduce((s, e) => s + e.importance, 0) / cluster.length,
        });
      }
    }

    // Sort by importance
    clusters.sort((a, b) => b.averageImportance - a.averageImportance);

    return clusters;
  }

  /**
   * Check if two events are related.
   */
  private areEventsRelated(a: EpisodicEvent, b: EpisodicEvent): boolean {
    // Same type
    if (a.type === b.type) return true;

    // Close in time (within 5 minutes)
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (Math.abs(timeA - timeB) < 5 * 60 * 1000) return true;

    // Similar content (simple word overlap)
    const wordsA = new Set(a.summary.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.summary.toLowerCase().split(/\s+/));
    const overlap = Array.from(wordsA).filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    if (union > 0 && overlap / union > 0.3) return true;

    return false;
  }

  /**
   * Generate a summary for a cluster of events.
   */
  private generateClusterSummary(cluster: EpisodicEvent[]): string {
    if (cluster.length === 0) return "";
    if (cluster.length === 1) return cluster[0]!.summary;

    // Combine summaries
    const summaries = cluster.map(e => e.summary);

    // Simple summarization: take first sentence of each
    const firstSentences = summaries.map(s => {
      const periodIdx = s.indexOf('.');
      return periodIdx > 0 ? s.slice(0, periodIdx) : s.slice(0, 100);
    });

    return firstSentences.join('; ');
  }

  /**
   * Extract key topics from a cluster.
   */
  private extractKeyTopics(cluster: EpisodicEvent[]): string[] {
    const wordCounts = new Map<string, number>();

    for (const event of cluster) {
      const words = event.summary.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word.length > 3) { // Skip short words
          wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
        }
      }
    }

    // Return top words
    return Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  /**
   * Create a semantic memory entry from a cluster.
   */
  private createMemoryFromCluster(
    cluster: MemoryCluster,
    workspaceId: string,
  ): Omit<SemanticMemoryEntry, "bm25Terms" | "accessCount" | "updatedAt" | "lastAccessedAt"> | null {
    if (cluster.events.length === 0) return null;

    // Use the highest importance event as base
    const baseEvent = cluster.events.reduce((best, e) =>
      e.importance > best.importance ? e : best
    );

    return {
      id: `memory_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      workspaceId,
      key: cluster.keyTopics.join("_") || "consolidated_memory",
      content: cluster.summary,
      embedding: baseEvent.embedding,
      source: "consolidation",
      confidence: cluster.averageImportance,
      importance: cluster.averageImportance,
      createdAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Deduplication
  // ---------------------------------------------------------------------------

  /**
   * Deduplicate similar memories in a workspace.
   */
  private async deduplicateMemories(workspaceId: string): Promise<number> {
    const memories = this.semanticMemory.list(workspaceId);
    let deduplicated = 0;

    // Compare each pair of memories
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i]!;
        const b = memories[j]!;

        const similarity = this.calculateSimilarity(a, b);
        if (similarity >= this.config.deduplicationThreshold) {
          // Merge: keep the one with higher importance
          if (a.importance >= b.importance) {
            // Merge b into a
            this.mergeMemory(a, b);
            this.semanticMemory.delete(b.id);
            deduplicated++;
          } else {
            // Merge a into b
            this.mergeMemory(b, a);
            this.semanticMemory.delete(a.id);
            deduplicated++;
          }
        }
      }
    }

    return deduplicated;
  }

  /**
   * Calculate similarity between two memories.
   */
  private calculateSimilarity(a: SemanticMemoryEntry, b: SemanticMemoryEntry): number {
    // Simple text similarity
    const wordsA = new Set(a.content.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.content.toLowerCase().split(/\s+/));
    const intersection = Array.from(wordsA).filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Merge two similar memories.
   */
  private mergeMemory(target: SemanticMemoryEntry, source: SemanticMemoryEntry): void {
    // Combine content
    target.content = `${target.content}\n\n${source.content}`;

    // Update importance (weighted average)
    const totalAccess = target.accessCount + source.accessCount;
    if (totalAccess > 0) {
      target.importance = (target.importance * target.accessCount + source.importance * source.accessCount) / totalAccess;
    }

    target.accessCount += source.accessCount;
    target.updatedAt = new Date().toISOString();
  }

  // ---------------------------------------------------------------------------
  // Compression
  // ---------------------------------------------------------------------------

  /**
   * Compress old memories to save space.
   */
  private compressOldMemories(workspaceId?: string): number {
    const memories = workspaceId
      ? this.semanticMemory.list(workspaceId)
      : [];
    let compressed = 0;

    for (const memory of memories) {
      // Compress if content is long and importance is moderate
      if (memory.content.length > 500 && memory.importance < 0.5) {
        const compressedContent = this.compressContent(memory.content);
        if (compressedContent.length < memory.content.length) {
          this.semanticMemory.update(memory.id, { content: compressedContent });
          compressed++;
        }
      }
    }

    return compressed;
  }

  /**
   * Compress content by removing redundancy.
   */
  private compressContent(content: string): string {
    // Simple compression: take first sentence of each paragraph
    const paragraphs = content.split(/\n\n+/);
    const compressed = paragraphs.map(p => {
      const sentences = p.split(/[.!?]+/).filter(s => s.trim().length > 0);
      return sentences[0]?.trim() ?? p.slice(0, 100);
    });

    return compressed.join('\n');
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /**
   * Get consolidation history.
   */
  getHistory(limit?: number): ConsolidationResult[] {
    const history = [...this.consolidationHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Clear consolidation history.
   */
  clearHistory(): void {
    this.consolidationHistory = [];
  }
}

// ---------------------------------------------------------------------------
// Consolidation Factory
// ---------------------------------------------------------------------------

export function createMemoryConsolidation(
  semanticMemory: SemanticMemory,
  episodicMemory: EpisodicMemory,
  config?: Partial<ConsolidationConfig>,
): MemoryConsolidation {
  return new MemoryConsolidation(semanticMemory, episodicMemory, config);
}
