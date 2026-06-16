/**
 * Memory System — Barrel Exports
 *
 * Agentic memory system components for Carbon Agent.
 */

// Token counting and budget management
export {
  estimateTokens,
  countMessageTokens,
  wouldExceedBudget,
  calculateFittingMessages,
  rotateMessages,
  estimateToolTokens,
  estimateStepTokens,
  TokenBudgetManager,
  ContextWindowManager,
  type TokenBudget,
  type TokenEstimate,
} from "./token-counter.js";

// BM25 keyword search
export {
  BM25Index,
  BM25IndexManager,
  type BM25Config,
  type BM25Document,
  type BM25TermInfo,
  type BM25Result,
} from "./bm25.js";

// Working memory (token-aware context window)
export {
  WorkingMemory,
  createWorkingMemory,
  createWorkingMemoryForModel,
  type WorkingMemoryConfig,
  type WorkingMemoryState,
  type CompressionResult,
} from "./working.js";

// Semantic memory (hybrid BM25 + vector retrieval)
export {
  SemanticMemory,
  cosineSimilarity,
  vectorSimilarity,
  type SemanticMemoryConfig,
  type SemanticMemoryEntry,
  type SemanticMemoryQuery,
  type SemanticMemoryResult,
  type SemanticMemoryStats,
} from "./semantic.js";

// Episodic memory (temporal events)
export {
  EpisodicMemory,
  type EpisodicEvent,
  type EpisodicEventType,
  type EpisodicOutcome,
  type EpisodicQuery,
  type EpisodicResult,
  type EpisodicStats,
} from "./episodic.js";

// Memory consolidation
export {
  MemoryConsolidation,
  createMemoryConsolidation,
  type ConsolidationConfig,
  type ConsolidationResult,
  type MemoryCluster,
} from "./consolidation.js";

// Graph memory (entity-relationship knowledge graph)
export {
  GraphMemory,
  createGraphMemory,
  type GraphNode,
  type GraphEdge,
  type GraphQuery,
  type GraphPath,
  type GraphSearchResult,
  type GraphStats,
} from "./graph.js";

// Agentic memory system (orchestrator)
export {
  AgenticMemorySystem,
  createMemorySystem,
  type MemorySystemConfig,
  type MemoryInjection,
  type MemorySystemStats,
  type MemoryQuery,
  type MemoryQueryResult,
} from "./system.js";
