/**
 * Memory System — Tests
 *
 * Comprehensive tests for token counting, BM25 index, working memory,
 * semantic memory, episodic memory, consolidation, and memory system.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateTokens,
  countMessageTokens,
  wouldExceedBudget,
  calculateFittingMessages,
  rotateMessages,
  TokenBudgetManager,
  ContextWindowManager,
} from "./token-counter.js";
import { BM25Index, BM25IndexManager } from "./bm25.js";
import { WorkingMemory, createWorkingMemory, createWorkingMemoryForModel } from "./working.js";
import { SemanticMemory, cosineSimilarity, vectorSimilarity } from "./semantic.js";
import { EpisodicMemory, type EpisodicEvent } from "./episodic.js";
import { MemoryConsolidation, createMemoryConsolidation } from "./consolidation.js";
import { AgenticMemorySystem, createMemorySystem } from "./system.js";
import { GraphMemory, createGraphMemory } from "./graph.js";

// ---------------------------------------------------------------------------
// Token Counter Tests
// ---------------------------------------------------------------------------

describe("Token Counter", () => {
  it("should estimate tokens for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate tokens for simple text", () => {
    const tokens = estimateTokens("Hello world");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it("should estimate tokens for longer text", () => {
    const longText = "This is a longer piece of text that should have more tokens. ".repeat(10);
    const tokens = estimateTokens(longText);
    expect(tokens).toBeGreaterThan(20);
  });

  it("should count message tokens", () => {
    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello!" },
    ];
    const tokens = countMessageTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("should check budget exceedance", () => {
    const messages = [{ role: "user", content: "Hello" }];
    expect(wouldExceedBudget(messages, { role: "assistant", content: "Hi!" }, 1000)).toBe(false);
    expect(wouldExceedBudget(messages, { role: "assistant", content: "x".repeat(5000) }, 100)).toBe(true);
  });

  it("should calculate fitting messages", () => {
    const messages = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "Message 1" },
      { role: "assistant", content: "Response 1" },
      { role: "user", content: "Message 2" },
      { role: "assistant", content: "Response 2" },
    ];
    const count = calculateFittingMessages(messages, 1000);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(messages.length);
  });

  it("should rotate messages preserving system prompt", () => {
    const messages = [
      { role: "system", content: "System" },
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
      { role: "assistant", content: "A2" },
    ];
    const rotated = rotateMessages(messages, 100);
    expect(rotated[0]?.role).toBe("system");
  });
});

// ---------------------------------------------------------------------------
// Token Budget Manager Tests
// ---------------------------------------------------------------------------

describe("TokenBudgetManager", () => {
  let manager: TokenBudgetManager;

  beforeEach(() => {
    manager = new TokenBudgetManager(1000);
  });

  it("should initialize with correct budget", () => {
    const budget = manager.getBudget();
    expect(budget.total).toBe(1000);
    expect(budget.used).toBe(0);
    expect(budget.remaining).toBe(1000);
  });

  it("should allocate tokens", () => {
    expect(manager.allocate(100)).toBe(true);
    const budget = manager.getBudget();
    expect(budget.used).toBe(100);
    expect(budget.remaining).toBe(900);
  });

  it("should reject allocation exceeding budget", () => {
    expect(manager.allocate(1100)).toBe(false);
    const budget = manager.getBudget();
    expect(budget.used).toBe(0);
  });

  it("should reserve and release tokens", () => {
    manager.reserve(200);
    const budget = manager.getBudget();
    expect(budget.remaining).toBe(800);

    manager.releaseReserved(100);
    const newBudget = manager.getBudget();
    expect(newBudget.remaining).toBe(900);
  });

  it("should reset", () => {
    manager.allocate(500);
    manager.reset();
    const budget = manager.getBudget();
    expect(budget.used).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Context Window Manager Tests
// ---------------------------------------------------------------------------

describe("ContextWindowManager", () => {
  let manager: ContextWindowManager;

  beforeEach(() => {
    manager = new ContextWindowManager(500);
  });

  it("should initialize empty", () => {
    expect(manager.getMessages()).toHaveLength(0);
    expect(manager.getTokenCount()).toBe(0);
  });

  it("should add messages", () => {
    manager.addMessage({ role: "user", content: "Hello" });
    expect(manager.getMessages()).toHaveLength(1);
    expect(manager.getTokenCount()).toBeGreaterThan(0);
  });

  it("should set messages", () => {
    const messages = [
      { role: "system", content: "System" },
      { role: "user", content: "Hello" },
    ];
    manager.setMessages(messages);
    expect(manager.getMessages()).toHaveLength(2);
  });

  it("should get budget", () => {
    manager.addMessage({ role: "user", content: "Hello" });
    const budget = manager.getBudget();
    expect(budget.total).toBe(500);
    expect(budget.used).toBeGreaterThan(0);
    expect(budget.remaining).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// BM25 Index Tests
// ---------------------------------------------------------------------------

describe("BM25Index", () => {
  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index();
  });

  it("should add documents", () => {
    index.addDocument({ id: "1", content: "Hello world" });
    index.addDocument({ id: "2", content: "Foo bar" });
    expect(index.size()).toBe(2);
  });

  it("should remove documents", () => {
    index.addDocument({ id: "1", content: "Hello world" });
    index.addDocument({ id: "2", content: "Foo bar" });
    index.removeDocument("1");
    expect(index.size()).toBe(1);
  });

  it("should search", () => {
    index.addDocument({ id: "1", content: "The quick brown fox" });
    index.addDocument({ id: "2", content: "The lazy dog" });
    index.addDocument({ id: "3", content: "Fox and dog are friends" });

    const results = index.search("fox");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.documentId).toBe("1");
  });

  it("should rank results by relevance", () => {
    index.addDocument({ id: "1", content: "Machine learning is a subset of artificial intelligence" });
    index.addDocument({ id: "2", content: "Machine learning algorithms learn from data" });
    index.addDocument({ id: "3", content: "Cooking recipes for beginners" });

    const results = index.search("machine learning");
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.documentId).toMatch(/1|2/);
  });

  it("should clear index", () => {
    index.addDocument({ id: "1", content: "Hello world" });
    index.clear();
    expect(index.size()).toBe(0);
  });

  it("should return stats", () => {
    index.addDocument({ id: "1", content: "Hello world" });
    index.addDocument({ id: "2", content: "Foo bar baz" });
    const stats = index.getStats();
    expect(stats.totalDocuments).toBe(2);
    expect(stats.totalTerms).toBeGreaterThan(0);
  });

  it("should tokenize text", () => {
    const terms = index.tokenize("Hello, World! This is a test.");
    expect(terms).toContain("hello");
    expect(terms).toContain("world");
    expect(terms).toContain("test");
    expect(terms).not.toContain("is");
    expect(terms).not.toContain("a");
  });

  it("should export and import data", () => {
    index.addDocument({ id: "1", content: "Hello world" });
    index.addDocument({ id: "2", content: "Foo bar" });

    const data = index.exportData();
    const newIndex = new BM25Index();
    newIndex.importData(data);

    expect(newIndex.size()).toBe(2);
    const results = newIndex.search("hello");
    expect(results.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// BM25 Index Manager Tests
// ---------------------------------------------------------------------------

describe("BM25IndexManager", () => {
  let manager: BM25IndexManager;

  beforeEach(() => {
    manager = new BM25IndexManager();
  });

  it("should get or create indexes", () => {
    const index1 = manager.getIndex("workspace1");
    const index2 = manager.getIndex("workspace1");
    expect(index1).toBe(index2);

    const index3 = manager.getIndex("workspace2");
    expect(index3).not.toBe(index1);
  });

  it("should remove indexes", () => {
    manager.getIndex("workspace1");
    expect(manager.removeIndex("workspace1")).toBe(true);
    expect(manager.removeIndex("workspace1")).toBe(false);
  });

  it("should clear all indexes", () => {
    manager.getIndex("workspace1");
    manager.getIndex("workspace2");
    manager.clearAll();
    // After clearing, getting an index should return a new empty one
    const index = manager.getIndex("workspace1");
    expect(index.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Working Memory Tests
// ---------------------------------------------------------------------------

describe("WorkingMemory", () => {
  let memory: WorkingMemory;

  beforeEach(() => {
    memory = createWorkingMemory({ maxTokens: 500 });
  });

  it("should initialize empty", () => {
    expect(memory.getMessages()).toHaveLength(0);
    expect(memory.getTokenCount()).toBe(0);
  });

  it("should add messages", () => {
    memory.addMessage({ role: "user", content: "Hello" });
    expect(memory.getMessages()).toHaveLength(1);
    expect(memory.getTokenCount()).toBeGreaterThan(0);
  });

  it("should set messages", () => {
    const messages = [
      { role: "system", content: "System" },
      { role: "user", content: "Hello" },
    ];
    memory.setMessages(messages);
    expect(memory.getMessages()).toHaveLength(2);
  });

  it("should clear messages", () => {
    memory.addMessage({ role: "user", content: "Hello" });
    memory.clear();
    expect(memory.getMessages()).toHaveLength(0);
  });

  it("should get state", () => {
    memory.addMessage({ role: "user", content: "Hello" });
    const state = memory.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.tokenCount).toBeGreaterThan(0);
  });

  it("should restore state", () => {
    const state = {
      messages: [{ role: "user", content: "Restored message" }],
      tokenCount: 10,
      maxTokens: 500,
      compressionCount: 0,
    };
    memory.restoreState(state);
    expect(memory.getMessages()).toHaveLength(1);
    expect(memory.getMessages()[0]?.content).toBe("Restored message");
  });

  it("should inject memories into context", () => {
    memory.setMessages([
      { role: "system", content: "System prompt" },
      { role: "user", content: "Hello" },
    ]);

    const memories = [
      { content: "Important fact 1", score: 0.9 },
      { content: "Important fact 2", score: 0.8 },
    ];

    const context = memory.getContextWithMemories(memories);
    expect(context.length).toBeGreaterThan(2);
    // Should have system, memory, user messages
    expect(context.some(m => m.content.includes("Relevant Context"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Working Memory Factory Tests
// ---------------------------------------------------------------------------

describe("WorkingMemory Factory", () => {
  it("should create working memory with default config", () => {
    const memory = createWorkingMemory();
    expect(memory).toBeDefined();
    expect(memory.getBudget().total).toBe(8192);
  });

  it("should create working memory for specific model", () => {
    const claudeMemory = createWorkingMemoryForModel("claude-sonnet-4-20250514");
    expect(claudeMemory.getBudget().total).toBeGreaterThan(100000);

    const gpt4Memory = createWorkingMemoryForModel("gpt-4");
    expect(gpt4Memory.getBudget().total).toBe(5734); // 8192 * 0.7
  });
});

// ---------------------------------------------------------------------------
// Semantic Memory Tests
// ---------------------------------------------------------------------------

describe("SemanticMemory", () => {
  let memory: SemanticMemory;

  beforeEach(() => {
    memory = new SemanticMemory({ maxMemories: 100 });
  });

  it("should store entries", () => {
    const entry = memory.store({
      id: "1",
      workspaceId: "ws1",
      key: "fact1",
      content: "The sky is blue",
      embedding: [1, 0, 0],
      source: "test",
      confidence: 0.9,
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });
    expect(entry.id).toBe("1");
    expect(entry.bm25Terms).toBeDefined();
  });

  it("should retrieve entries", () => {
    memory.store({
      id: "1",
      workspaceId: "ws1",
      key: "fact1",
      content: "Machine learning is a subset of AI",
      embedding: [1, 0, 0],
      source: "test",
      confidence: 0.9,
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    const entry = memory.get("1");
    expect(entry).not.toBeNull();
    expect(entry?.content).toContain("Machine learning");
  });

  it("should delete entries", () => {
    memory.store({
      id: "1",
      workspaceId: "ws1",
      key: "fact1",
      content: "Test content",
      embedding: [1, 0, 0],
      source: "test",
      confidence: 0.9,
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    expect(memory.delete("1")).toBe(true);
    expect(memory.get("1")).toBeNull();
  });

  it("should list entries by workspace", () => {
    memory.store({
      id: "1",
      workspaceId: "ws1",
      key: "fact1",
      content: "Content 1",
      embedding: [1, 0, 0],
      source: "test",
      confidence: 0.9,
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    memory.store({
      id: "2",
      workspaceId: "ws2",
      key: "fact2",
      content: "Content 2",
      embedding: [0, 1, 0],
      source: "test",
      confidence: 0.9,
      importance: 0.7,
      createdAt: new Date().toISOString(),
    });

    const ws1Entries = memory.list("ws1");
    expect(ws1Entries).toHaveLength(1);
    expect(ws1Entries[0]?.id).toBe("1");
  });

  it("should perform hybrid recall", async () => {
    memory.store({
      id: "1",
      workspaceId: "ws1",
      key: "ml",
      content: "Machine learning algorithms learn from data",
      embedding: [1, 0, 0],
      source: "test",
      confidence: 0.9,
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    memory.store({
      id: "2",
      workspaceId: "ws1",
      key: "cooking",
      content: "Pasta is a delicious Italian dish",
      embedding: [0, 1, 0],
      source: "test",
      confidence: 0.9,
      importance: 0.7,
      createdAt: new Date().toISOString(),
    });

    const results = await memory.recall({
      query: "machine learning",
      workspaceId: "ws1",
      limit: 5,
    }, vectorSimilarity);

    expect(results.length).toBeGreaterThan(0);
  });

  it("should apply decay", () => {
    memory.store({
      id: "1",
      workspaceId: "ws1",
      key: "fact1",
      content: "Test content",
      embedding: [1, 0, 0],
      source: "test",
      confidence: 0.9,
      importance: 0.2,
      createdAt: new Date().toISOString(),
    });

    const forgotten = memory.applyDecay();
    expect(forgotten).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Cosine Similarity Tests
// ---------------------------------------------------------------------------

describe("Cosine Similarity", () => {
  it("should return 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("should return 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("should return -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });

  it("should return 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Episodic Memory Tests
// ---------------------------------------------------------------------------

describe("EpisodicMemory", () => {
  let memory: EpisodicMemory;

  beforeEach(() => {
    memory = new EpisodicMemory({ maxEvents: 100 });
  });

  it("should record events", () => {
    const event = memory.record({
      id: "1",
      workspaceId: "ws1",
      type: "task",
      summary: "Completed data extraction",
      details: { source: "outlook" },
      outcome: "success",
      embedding: [1, 0, 0],
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    expect(event.id).toBe("1");
    expect(event.type).toBe("task");
  });

  it("should query events by type", () => {
    memory.record({
      id: "1",
      workspaceId: "ws1",
      type: "task",
      summary: "Task 1",
      details: {},
      outcome: "success",
      embedding: [1, 0, 0],
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    memory.record({
      id: "2",
      workspaceId: "ws1",
      type: "error",
      summary: "Error 1",
      details: {},
      outcome: "failure",
      embedding: [0, 1, 0],
      importance: 0.7,
      createdAt: new Date().toISOString(),
    });

    const taskEvents = memory.getByType("ws1", "task");
    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0]?.type).toBe("task");
  });

  it("should get recent events", () => {
    memory.record({
      id: "1",
      workspaceId: "ws1",
      type: "task",
      summary: "Old task",
      details: {},
      outcome: "success",
      embedding: [1, 0, 0],
      importance: 0.8,
      createdAt: "2024-01-01T00:00:00Z",
    });

    memory.record({
      id: "2",
      workspaceId: "ws1",
      type: "task",
      summary: "Recent task",
      details: {},
      outcome: "success",
      embedding: [1, 0, 0],
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    const recent = memory.getRecent("ws1", 5);
    expect(recent.length).toBeGreaterThan(0);
    // Most recent should be first
    expect(recent[0]?.id).toBe("2");
  });

  it("should delete events", () => {
    memory.record({
      id: "1",
      workspaceId: "ws1",
      type: "task",
      summary: "Task 1",
      details: {},
      outcome: "success",
      embedding: [1, 0, 0],
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    expect(memory.delete("1")).toBe(true);
    expect(memory.get("1")).toBeNull();
  });

  it("should get stats", () => {
    memory.record({
      id: "1",
      workspaceId: "ws1",
      type: "task",
      summary: "Task 1",
      details: {},
      outcome: "success",
      embedding: [1, 0, 0],
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    const stats = memory.getStats("ws1");
    expect(stats.totalEvents).toBe(1);
    expect(stats.byType.task).toBe(1);
    expect(stats.byOutcome.success).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Memory Consolidation Tests
// ---------------------------------------------------------------------------

describe("MemoryConsolidation", () => {
  let semantic: SemanticMemory;
  let episodic: EpisodicMemory;
  let consolidation: MemoryConsolidation;

  beforeEach(() => {
    semantic = new SemanticMemory({ maxMemories: 100 });
    episodic = new EpisodicMemory({ maxEvents: 100 });
    consolidation = createMemoryConsolidation(semantic, episodic, {
      minEventsToConsolidate: 2,
    });
  });

  it("should consolidate events into memories", async () => {
    // Record some events
    episodic.record({
      id: "1",
      workspaceId: "ws1",
      type: "task",
      summary: "Extracted data from Outlook",
      details: {},
      outcome: "success",
      embedding: [1, 0, 0],
      importance: 0.8,
      createdAt: new Date().toISOString(),
    });

    episodic.record({
      id: "2",
      workspaceId: "ws1",
      type: "task",
      summary: "Processed Outlook emails",
      details: {},
      outcome: "success",
      embedding: [1, 0, 0],
      importance: 0.7,
      createdAt: new Date().toISOString(),
    });

    const result = await consolidation.consolidate("ws1");
    expect(result).toBeDefined();
    expect(result.consolidatedCount).toBeGreaterThanOrEqual(0);
  });

  it("should track consolidation history", async () => {
    await consolidation.consolidate("ws1");
    const history = consolidation.getHistory();
    expect(history).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Agentic Memory System Tests
// ---------------------------------------------------------------------------

describe("AgenticMemorySystem", () => {
  let system: AgenticMemorySystem;

  beforeEach(() => {
    system = createMemorySystem({ workspaceId: "test-ws" });
  });

  it("should initialize", async () => {
    await system.initialize();
    expect(system).toBeDefined();
  });

  it("should store and recall memories", async () => {
    system.storeMemory("fact1", "The sky is blue");
    system.storeMemory("fact2", "Water is wet");

    const results = await system.recallMemory("sky");
    expect(results.length).toBeGreaterThan(0);
  });

  it("should record and query events", () => {
    system.recordEvent("task", "Completed data extraction");
    system.recordEvent("error", "Failed to connect to API");

    const events = system.queryEvents({ type: "task" });
    expect(events.length).toBeGreaterThan(0);
  });

  it("should get memory injection", async () => {
    system.storeMemory("fact1", "Important fact about AI");
    system.recordEvent("task", "Recent task completion");

    const injection = await system.getMemoryInjection("artificial intelligence");
    expect(injection).toBeDefined();
    expect(injection.totalTokens).toBeGreaterThanOrEqual(0);
  });

  it("should get stats", () => {
    system.storeMemory("fact1", "Test fact");
    system.recordEvent("task", "Test task");

    const stats = system.getStats();
    expect(stats.semanticMemory.totalEntries).toBe(1);
    expect(stats.episodicMemory.totalEvents).toBe(1);
  });

  it("should export and import data", () => {
    const system = createMemorySystem({ workspaceId: "export-ws" });
    system.storeMemory("fact1", "Exported fact");
    system.recordEvent("task", "Exported task");

    const data = system.exportData();
    expect(data.semanticMemory.entries).toHaveLength(1);
    expect(data.episodicMemory).toHaveLength(1);

    // Import into a system with the same workspace ID
    const newSystem = createMemorySystem({ workspaceId: "export-ws" });
    newSystem.importData(data);
    expect(newSystem.listMemories()).toHaveLength(1);
  });

  it("should shutdown cleanly", async () => {
    await system.initialize();
    await system.shutdown();
    expect(system).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Graph Memory Tests
// ---------------------------------------------------------------------------

describe("GraphMemory", () => {
  let graph: GraphMemory;

  beforeEach(() => {
    graph = createGraphMemory();
  });

  it("should add nodes", () => {
    const node = graph.addNode({
      id: "1",
      workspaceId: "ws1",
      name: "Alice",
      entityType: "person",
      properties: { role: "engineer" },
      embedding: [1, 0, 0],
    });

    expect(node.id).toBe("1");
    expect(node.mentionCount).toBe(1);
  });

  it("should update existing nodes", () => {
    graph.addNode({
      id: "1",
      workspaceId: "ws1",
      name: "Alice",
      entityType: "person",
      properties: { role: "engineer" },
      embedding: [1, 0, 0],
    });

    const updated = graph.addNode({
      id: "2",
      workspaceId: "ws1",
      name: "Alice",
      entityType: "person",
      properties: { role: "senior engineer" },
      embedding: [1, 0, 0],
    });

    expect(updated.id).toBe("1");
    expect(updated.mentionCount).toBe(2);
  });

  it("should add edges", () => {
    graph.addNode({
      id: "1",
      workspaceId: "ws1",
      name: "Alice",
      entityType: "person",
      properties: {},
      embedding: [1, 0, 0],
    });

    graph.addNode({
      id: "2",
      workspaceId: "ws1",
      name: "Acme Corp",
      entityType: "company",
      properties: {},
      embedding: [0, 1, 0],
    });

    const edge = graph.addEdge({
      id: "e1",
      workspaceId: "ws1",
      sourceId: "1",
      targetId: "2",
      relationType: "works_for",
      weight: 0.9,
      properties: {},
    });

    expect(edge).not.toBeNull();
    expect(edge?.relationType).toBe("works_for");
  });

  it("should get neighbors", () => {
    graph.addNode({
      id: "1",
      workspaceId: "ws1",
      name: "Alice",
      entityType: "person",
      properties: {},
      embedding: [1, 0, 0],
    });

    graph.addNode({
      id: "2",
      workspaceId: "ws1",
      name: "Acme Corp",
      entityType: "company",
      properties: {},
      embedding: [0, 1, 0],
    });

    graph.addEdge({
      id: "e1",
      workspaceId: "ws1",
      sourceId: "1",
      targetId: "2",
      relationType: "works_for",
      weight: 0.9,
      properties: {},
    });

    const neighbors = graph.getNeighbors("1");
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]?.node.name).toBe("Acme Corp");
  });

  it("should traverse multi-hop", () => {
    graph.addNode({
      id: "1",
      workspaceId: "ws1",
      name: "Alice",
      entityType: "person",
      properties: {},
      embedding: [1, 0, 0],
    });

    graph.addNode({
      id: "2",
      workspaceId: "ws1",
      name: "Acme Corp",
      entityType: "company",
      properties: {},
      embedding: [0, 1, 0],
    });

    graph.addNode({
      id: "3",
      workspaceId: "ws1",
      name: "New York",
      entityType: "location",
      properties: {},
      embedding: [0, 0, 1],
    });

    graph.addEdge({
      id: "e1",
      workspaceId: "ws1",
      sourceId: "1",
      targetId: "2",
      relationType: "works_for",
      weight: 0.9,
      properties: {},
    });

    graph.addEdge({
      id: "e2",
      workspaceId: "ws1",
      sourceId: "2",
      targetId: "3",
      relationType: "located_in",
      weight: 0.8,
      properties: {},
    });

    const paths = graph.traverse("1", { maxDepth: 3 });
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]?.nodes).toHaveLength(2); // Alice -> Acme -> NY
  });

  it("should search nodes", () => {
    graph.addNode({
      id: "1",
      workspaceId: "ws1",
      name: "Machine Learning",
      entityType: "technology",
      properties: {},
      embedding: [1, 0, 0],
    });

    graph.addNode({
      id: "2",
      workspaceId: "ws1",
      name: "Deep Learning",
      entityType: "technology",
      properties: {},
      embedding: [0, 1, 0],
    });

    const results = graph.search("learning", "ws1");
    expect(results).toHaveLength(2);
  });

  it("should get stats", () => {
    graph.addNode({
      id: "1",
      workspaceId: "ws1",
      name: "Alice",
      entityType: "person",
      properties: {},
      embedding: [1, 0, 0],
    });

    graph.addNode({
      id: "2",
      workspaceId: "ws1",
      name: "Acme Corp",
      entityType: "company",
      properties: {},
      embedding: [0, 1, 0],
    });

    graph.addEdge({
      id: "e1",
      workspaceId: "ws1",
      sourceId: "1",
      targetId: "2",
      relationType: "works_for",
      weight: 0.9,
      properties: {},
    });

    const stats = graph.getStats("ws1");
    expect(stats.totalNodes).toBe(2);
    expect(stats.totalEdges).toBe(1);
    expect(stats.byEntityType.person).toBe(1);
    expect(stats.byEntityType.company).toBe(1);
  });

  it("should export and import data", () => {
    graph.addNode({
      id: "1",
      workspaceId: "ws1",
      name: "Alice",
      entityType: "person",
      properties: {},
      embedding: [1, 0, 0],
    });

    graph.addNode({
      id: "2",
      workspaceId: "ws1",
      name: "Acme Corp",
      entityType: "company",
      properties: {},
      embedding: [0, 1, 0],
    });

    graph.addEdge({
      id: "e1",
      workspaceId: "ws1",
      sourceId: "1",
      targetId: "2",
      relationType: "works_for",
      weight: 0.9,
      properties: {},
    });

    const data = graph.exportData();
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);

    const newGraph = createGraphMemory();
    newGraph.importData(data);
    expect(newGraph.listNodes("ws1")).toHaveLength(2);
  });
});
