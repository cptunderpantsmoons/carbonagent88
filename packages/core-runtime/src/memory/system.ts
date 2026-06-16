/**
 * Agentic Memory System — Orchestrator
 *
 * Control Corridor:
 * - Owns: Unified memory API, cross-tier retrieval, memory injection
 * - Must NOT own: Embedding generation, LLM provider instantiation
 *
 * Orchestrates all memory tiers (working, episodic, semantic, graph)
 * and provides a unified interface for the agent system.
 */

import { EventEmitter } from "node:events";
import { WorkingMemory, createWorkingMemory } from "./working.js";
import { SemanticMemory, type SemanticMemoryEntry, type SemanticMemoryResult, vectorSimilarity } from "./semantic.js";
import { EpisodicMemory, type EpisodicEvent, type EpisodicEventType, type EpisodicOutcome, type EpisodicPersistence } from "./episodic.js";
import { MemoryConsolidation, type ConsolidationConfig, type ConsolidationResult } from "./consolidation.js";
import { GraphMemory, type GraphNode, type GraphEdge, type GraphStats, type GraphPersistence } from "./graph.js";
import { estimateTokens } from "./token-counter.js";

// ---------------------------------------------------------------------------
// Memory System Types
// ---------------------------------------------------------------------------

export interface MemorySystemConfig {
  workspaceId: string;
  maxTokens: number;
  semantic: {
    maxMemories: number;
    decayRate: number;
    hybridWeights: { bm25: number; vector: number };
  };
  episodic: {
    maxEvents: number;
    decayRate: number;
    persistence?: EpisodicPersistence;
  };
  graph: {
    persistence?: GraphPersistence;
  };
  consolidation: ConsolidationConfig;
}

export interface MemoryInjection {
  semantic: SemanticMemoryEntry[];
  episodic: EpisodicEvent[];
  graph: GraphNode[];
  totalTokens: number;
}

export interface MemorySystemStats {
  workingMemory: {
    tokenCount: number;
    maxTokens: number;
    messageCount: number;
  };
  semanticMemory: {
    totalEntries: number;
    averageImportance: number;
  };
  episodicMemory: {
    totalEvents: number;
    byType: Record<string, number>;
  };
  graphMemory: GraphStats;
  consolidation: {
    lastRun?: string;
    totalConsolidations: number;
  };
}

export interface MemoryQuery {
  text: string;
  type?: "semantic" | "episodic" | "all";
  limit?: number;
  minImportance?: number;
  includeRecent?: boolean;
  includeGraph?: boolean;
}

export interface GraphQueryResult {
  node: GraphNode;
  edge: GraphEdge;
  depth: number;
}

export interface MemoryQueryResult {
  semantic: SemanticMemoryResult[];
  episodic: Array<{ event: EpisodicEvent; relevance: number }>;
  graph: GraphQueryResult[];
  totalResults: number;
  queryTime: number;
}

// ---------------------------------------------------------------------------
// Agentic Memory System
// ---------------------------------------------------------------------------

export class AgenticMemorySystem extends EventEmitter {
  private config: MemorySystemConfig;
  private workingMemory: WorkingMemory;
  private semanticMemory: SemanticMemory;
  private episodicMemory: EpisodicMemory;
  private graphMemory: GraphMemory;
  private consolidation: MemoryConsolidation;

  constructor(config: Partial<MemorySystemConfig> = {}) {
    super();
    this.config = {
      workspaceId: config.workspaceId ?? "default",
      maxTokens: config.maxTokens ?? 8192,
      semantic: {
        maxMemories: config.semantic?.maxMemories ?? 10000,
        decayRate: config.semantic?.decayRate ?? 0.01,
        hybridWeights: config.semantic?.hybridWeights ?? { bm25: 0.4, vector: 0.6 },
      },
      episodic: {
        maxEvents: config.episodic?.maxEvents ?? 10000,
        decayRate: config.episodic?.decayRate ?? 0.01,
        persistence: config.episodic?.persistence,
      },
      graph: {
        persistence: config.graph?.persistence,
      },
      consolidation: config.consolidation ?? {
        enabled: true,
        intervalMs: 3600000,
        minEventsToConsolidate: 5,
        maxMemoriesPerConsolidation: 50,
        deduplicationThreshold: 0.9,
        compressionRatio: 0.5,
      },
    };

    // Initialize components
    this.workingMemory = createWorkingMemory({ maxTokens: this.config.maxTokens });
    this.semanticMemory = new SemanticMemory({
      maxMemories: this.config.semantic.maxMemories,
      decayRate: this.config.semantic.decayRate,
      hybridWeights: this.config.semantic.hybridWeights,
    });
    this.episodicMemory = new EpisodicMemory({
      maxEvents: this.config.episodic.maxEvents,
      decayRate: this.config.episodic.decayRate,
      persistence: this.config.episodic.persistence,
    });
    this.graphMemory = new GraphMemory({
      persistence: this.config.graph.persistence,
    });
    this.consolidation = new MemoryConsolidation(
      this.semanticMemory,
      this.episodicMemory,
      this.config.consolidation,
    );

    // Wire up events
    this.setupEventForwarding();
  }

  // ---------------------------------------------------------------------------
  // Working Memory (Active Context)
  // ---------------------------------------------------------------------------

  /**
   * Add a message to working memory.
   */
  addMessage(message: { role: string; content: string }): void {
    this.workingMemory.addMessage(message);
  }

  /**
   * Get working memory messages.
   */
  getMessages(): Array<{ role: string; content: string }> {
    return this.workingMemory.getMessages();
  }

  /**
   * Get working memory token budget.
   */
  getWorkingMemoryBudget() {
    return this.workingMemory.getBudget();
  }

  /**
   * Clear working memory.
   */
  clearWorkingMemory(): void {
    this.workingMemory.clear();
  }

  // ---------------------------------------------------------------------------
  // Semantic Memory (Facts & Knowledge)
  // ---------------------------------------------------------------------------

  /**
   * Store a fact or piece of knowledge.
   */
  storeMemory(
    key: string,
    content: string,
    options: {
      source?: string;
      confidence?: number;
      importance?: number;
      embedding?: number[];
    } = {},
  ): SemanticMemoryEntry {
    return this.semanticMemory.store({
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      workspaceId: this.config.workspaceId,
      key,
      content,
      embedding: options.embedding ?? this.simpleEmbed(content),
      source: options.source ?? "agent",
      confidence: options.confidence ?? 0.8,
      importance: options.importance ?? 0.5,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Recall facts and knowledge.
   */
  async recallMemory(query: string, limit: number = 5): Promise<SemanticMemoryResult[]> {
    return this.semanticMemory.recall({
      query,
      workspaceId: this.config.workspaceId,
      limit,
    }, vectorSimilarity);
  }

  /**
   * List all semantic memories.
   */
  listMemories(limit?: number): SemanticMemoryEntry[] {
    return this.semanticMemory.list(this.config.workspaceId, limit);
  }

  /**
   * Delete a semantic memory.
   */
  deleteMemory(id: string): boolean {
    return this.semanticMemory.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Episodic Memory (Events & History)
  // ---------------------------------------------------------------------------

  /**
   * Record an episodic event.
   */
  recordEvent(
    type: EpisodicEventType,
    summary: string,
    details: Record<string, unknown> = {},
    outcome: EpisodicOutcome = "success",
  ): EpisodicEvent {
    return this.episodicMemory.record({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      workspaceId: this.config.workspaceId,
      type,
      summary,
      details,
      outcome,
      embedding: this.simpleEmbed(summary),
      importance: this.calculateEventImportance(type, outcome),
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Query episodic events.
   */
  queryEvents(options: {
    type?: EpisodicEventType;
    outcome?: EpisodicOutcome;
    after?: string;
    before?: string;
    limit?: number;
    usePersistence?: boolean;
  } = {}) {
    return this.episodicMemory.query({
      workspaceId: this.config.workspaceId,
      type: options.type,
      outcome: options.outcome,
      after: options.after,
      before: options.before,
      limit: options.limit ?? 10,
      usePersistence: options.usePersistence ?? true,
    });
  }

  /**
   * Get recent events.
   */
  getRecentEvents(limit: number = 10): EpisodicEvent[] {
    return this.episodicMemory.getRecent(this.config.workspaceId, limit);
  }

  // ---------------------------------------------------------------------------
  // Graph Memory (Entities & Relationships)
  // ---------------------------------------------------------------------------

  /**
   * Store or update a graph node.
   */
  storeGraphNode(node: Omit<GraphNode, "mentionCount" | "createdAt">): GraphNode {
    return this.graphMemory.addNode(node);
  }

  /**
   * Get a graph node by ID.
   */
  getGraphNode(id: string): GraphNode | null {
    return this.graphMemory.getNode(id);
  }

  /**
   * Find graph nodes for the current workspace.
   */
  findGraphNodes(options: {
    type?: string;
    label?: string;
    limit?: number;
  } = {}): GraphNode[] {
    return this.graphMemory.listNodes(this.config.workspaceId, options.type, options.limit);
  }

  /**
   * Store or update a graph edge.
   */
  storeGraphEdge(edge: Omit<GraphEdge, "createdAt">): GraphEdge | null {
    return this.graphMemory.addEdge(edge);
  }

  /**
   * Find graph edges for the current workspace.
   */
  findGraphEdges(options: {
    relationType?: string;
    limit?: number;
  } = {}): GraphEdge[] {
    return this.graphMemory.listEdges(this.config.workspaceId, options.relationType, options.limit);
  }

  /**
   * Delete a graph node and its connected edges.
   */
  deleteGraphNode(id: string): boolean {
    return this.graphMemory.deleteNode(id);
  }

  /**
   * Delete a graph edge.
   */
  deleteGraphEdge(id: string): boolean {
    return this.graphMemory.deleteEdge(id);
  }

  /**
   * Query the graph by node IDs, relation type, or hop traversal.
   */
  queryGraph(options: {
    nodeIds?: string[];
    relationType?: string;
    hops?: number;
    limit?: number;
  } = {}): Array<{ node: GraphNode; edge: GraphEdge; depth: number }> {
    const results: Array<{ node: GraphNode; edge: GraphEdge; depth: number }> = [];
    const seen = new Set<string>();
    const startNodeIds = options.nodeIds ?? [];
    const maxHops = options.hops ?? 2;

    for (const startId of startNodeIds) {
      if (seen.has(startId)) continue;
      seen.add(startId);
      const paths = this.graphMemory.traverse(startId, {
        maxDepth: maxHops,
        relationType: options.relationType,
        limit: options.limit ?? 20,
      });
      for (const path of paths) {
        for (let i = 0; i < path.nodes.length; i++) {
          const node = path.nodes[i];
          const edge = path.edges[i];
          if (!node || !edge) continue;
          if (node.workspaceId !== this.config.workspaceId) continue;
          results.push({ node, edge, depth: i + 1 });
        }
      }
    }

    return results;
  }

  /**
   * Get graph memory statistics.
   */
  graphStats(): GraphStats {
    return this.graphMemory.getStats(this.config.workspaceId);
  }

  // ---------------------------------------------------------------------------
  // Hybrid Query (Cross-Tier Retrieval)
  // ---------------------------------------------------------------------------

  /**
   * Query across all memory tiers.
   */
  async query(memoryQuery: MemoryQuery): Promise<MemoryQueryResult> {
    const startTime = Date.now();
    const limit = memoryQuery.limit ?? 10;

    const results: MemoryQueryResult = {
      semantic: [],
      episodic: [],
      graph: [],
      totalResults: 0,
      queryTime: 0,
    };

    // Query semantic memory
    if (memoryQuery.type !== "episodic") {
      results.semantic = await this.semanticMemory.recall({
        query: memoryQuery.text,
        workspaceId: this.config.workspaceId,
        limit,
        minImportance: memoryQuery.minImportance,
      }, vectorSimilarity);
    }

    // Query episodic memory
    if (memoryQuery.type !== "semantic") {
      const episodicResults = await this.episodicMemory.search(
        memoryQuery.text,
        this.config.workspaceId,
        limit,
        vectorSimilarity,
        true,
      );
      results.episodic = episodicResults;
    }

    // Query graph neighbors when requested
    if (memoryQuery.includeGraph !== false) {
      const searchResults = this.graphMemory.search(
        memoryQuery.text,
        this.config.workspaceId,
        { limit },
      );
      for (const result of searchResults.slice(0, limit)) {
        const nodeResults = this.queryGraph({
          nodeIds: [result.node.id],
          relationType: memoryQuery.type === "all" ? undefined : undefined,
          hops: 2,
          limit,
        });
        results.graph.push(...nodeResults);
      }
    }

    results.totalResults = results.semantic.length + results.episodic.length + results.graph.length;
    results.queryTime = Date.now() - startTime;

    return results;
  }

  // ---------------------------------------------------------------------------
  // Memory Injection (Context Augmentation)
  // ---------------------------------------------------------------------------

  /**
   * Get relevant memories to inject into LLM context.
   */
  async getMemoryInjection(
    context: string,
    maxTokens: number = 1000,
  ): Promise<MemoryInjection> {
    const injection: MemoryInjection = {
      semantic: [],
      episodic: [],
      graph: [],
      totalTokens: 0,
    };

    let remainingTokens = maxTokens;

    // Get relevant semantic memories
    const semanticResults = await this.semanticMemory.recall({
      query: context,
      workspaceId: this.config.workspaceId,
      limit: 10,
    }, vectorSimilarity);

    for (const result of semanticResults) {
      const tokens = estimateTokens(result.entry.content);
      if (tokens <= remainingTokens) {
        injection.semantic.push(result.entry);
        remainingTokens -= tokens;
      }
    }

    // Get relevant episodic events
    const episodicResults = await this.episodicMemory.search(
      context,
      this.config.workspaceId,
      5,
      vectorSimilarity,
      true,
    );

    for (const result of episodicResults) {
      const tokens = estimateTokens(result.event.summary);
      if (tokens <= remainingTokens) {
        injection.episodic.push(result.event);
        remainingTokens -= tokens;
      }
    }

    // Get relevant graph nodes
    const graphResults = this.graphMemory.search(
      context,
      this.config.workspaceId,
      { limit: 5 },
    );
    for (const result of graphResults) {
      const tokens = estimateTokens(result.node.name);
      if (tokens <= remainingTokens) {
        injection.graph.push(result.node);
        remainingTokens -= tokens;
      }
    }

    injection.totalTokens = maxTokens - remainingTokens;

    return injection;
  }

  /**
   * Inject memories into working memory context.
   */
  async injectMemories(context: string): Promise<void> {
    const injection = await this.getMemoryInjection(context);

    if (injection.semantic.length > 0 || injection.episodic.length > 0 || injection.graph.length > 0) {
      const memoryLines: string[] = [];

      if (injection.semantic.length > 0) {
        memoryLines.push("Facts & Knowledge:");
        for (const mem of injection.semantic) {
          memoryLines.push(`- ${mem.content}`);
        }
      }

      if (injection.episodic.length > 0) {
        memoryLines.push("Recent Events:");
        for (const evt of injection.episodic) {
          memoryLines.push(`- [${evt.type}] ${evt.summary}`);
        }
      }

      if (injection.graph.length > 0) {
        memoryLines.push("Related Entities:");
        for (const entity of injection.graph) {
          memoryLines.push(`- [${entity.entityType}] ${entity.name}`);
        }
      }

      const memoryMessage = {
        role: "system",
        content: `[Relevant Memory]\n${memoryLines.join("\n")}`,
      };

      // Inject into working memory
      const messages = this.workingMemory.getMessages();
      const insertIndex = messages.findIndex(m => m.role === "user");
      if (insertIndex !== -1) {
        const newMessages = [
          ...messages.slice(0, insertIndex),
          memoryMessage,
          ...messages.slice(insertIndex),
        ];
        this.workingMemory.setMessages(newMessages);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Consolidation
  // ---------------------------------------------------------------------------

  /**
   * Run memory consolidation.
   */
  async consolidate(): Promise<ConsolidationResult> {
    return this.consolidation.consolidate(this.config.workspaceId);
  }

  /**
   * Start automatic consolidation.
   */
  startConsolidation(): void {
    this.consolidation.start();
  }

  /**
   * Stop automatic consolidation.
   */
  stopConsolidation(): void {
    this.consolidation.stop();
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get comprehensive memory system stats.
   */
  getStats(): MemorySystemStats {
    const semanticStats = this.semanticMemory.getStats(this.config.workspaceId);
    const episodicStats = this.episodicMemory.getStats(this.config.workspaceId);
    const consolidationHistory = this.consolidation.getHistory(1);

    return {
      workingMemory: {
        tokenCount: this.workingMemory.getTokenCount(),
        maxTokens: this.config.maxTokens,
        messageCount: this.workingMemory.getMessages().length,
      },
      semanticMemory: {
        totalEntries: semanticStats.totalEntries,
        averageImportance: semanticStats.averageImportance,
      },
      episodicMemory: {
        totalEvents: episodicStats.totalEvents,
        byType: episodicStats.byType,
      },
      graphMemory: this.graphMemory.getStats(this.config.workspaceId),
      consolidation: {
        lastRun: consolidationHistory[0]?.timestamp,
        totalConsolidations: consolidationHistory.length,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the memory system.
   */
  async initialize(): Promise<void> {
    // Hydrate graph memory from persistence
    await this.graphMemory.init(this.config.workspaceId);

    // Hydrate episodic memory from persistence
    await this.episodicMemory.loadForWorkspace(this.config.workspaceId);

    // Start consolidation if enabled
    if (this.config.consolidation.enabled) {
      this.startConsolidation();
    }

    this.emit("initialized", { workspaceId: this.config.workspaceId });
  }

  /**
   * Shutdown the memory system.
   */
  async shutdown(): Promise<void> {
    this.stopConsolidation();
    this.emit("shutdown");
  }

  // ---------------------------------------------------------------------------
  // Event Forwarding
  // ---------------------------------------------------------------------------

  private setupEventForwarding(): void {
    // Forward working memory events
    this.workingMemory.on("compressed", (data) => {
      this.emit("working_memory:compressed", data);
    });

    // Forward semantic memory events
    this.semanticMemory.on("stored", (data) => {
      this.emit("semantic:stored", data);
    });

    // Forward episodic memory events
    this.episodicMemory.on("recorded", (data) => {
      this.emit("episodic:recorded", data);
    });

    // Forward consolidation events
    this.consolidation.on("completed", (data) => {
      this.emit("consolidation:completed", data);
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Simple hash-based embedding (fallback).
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
   * Calculate event importance based on type and outcome.
   */
  private calculateEventImportance(type: EpisodicEventType, outcome: EpisodicOutcome): number {
    const typeImportance: Record<EpisodicEventType, number> = {
      decision: 0.8,
      error: 0.7,
      task: 0.6,
      tool_use: 0.5,
      conversation: 0.4,
    };

    const outcomeModifier: Record<EpisodicOutcome, number> = {
      success: 0.1,
      partial: 0,
      failure: -0.1,
    };

    return Math.max(0, Math.min(1,
      (typeImportance[type] ?? 0.5) + (outcomeModifier[outcome] ?? 0)
    ));
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Export all memory data.
   */
  exportData(): {
    workingMemory: ReturnType<WorkingMemory['getState']>;
    semanticMemory: ReturnType<SemanticMemory['exportData']>;
    episodicMemory: ReturnType<EpisodicMemory['exportData']>;
    graphMemory: ReturnType<GraphMemory['exportData']>;
  } {
    return {
      workingMemory: this.workingMemory.getState(),
      semanticMemory: this.semanticMemory.exportData(),
      episodicMemory: this.episodicMemory.exportData(),
      graphMemory: this.graphMemory.exportData(),
    };
  }

  /**
   * Import memory data.
   */
  importData(data: {
    workingMemory?: ReturnType<WorkingMemory['getState']>;
    semanticMemory?: Parameters<SemanticMemory['importData']>[0];
    episodicMemory?: Parameters<EpisodicMemory['importData']>[0];
    graphMemory?: Parameters<GraphMemory['importData']>[0];
  }): void {
    if (data.workingMemory) {
      this.workingMemory.restoreState(data.workingMemory);
    }
    if (data.semanticMemory) {
      this.semanticMemory.importData(data.semanticMemory);
    }
    if (data.episodicMemory) {
      this.episodicMemory.importData(data.episodicMemory);
      // Ensure imported events are persisted if a persistence delegate exists.
      this.episodicMemory.saveForWorkspace(this.config.workspaceId).catch(() => {});
    }
    if (data.graphMemory) {
      this.graphMemory.importData(data.graphMemory);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMemorySystem(config?: Partial<MemorySystemConfig>): AgenticMemorySystem {
  return new AgenticMemorySystem(config);
}
