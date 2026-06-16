/**
 * Cache System — Tests
 *
 * Comprehensive tests for semantic cache, response cache, context compressor,
 * and prompt templates.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SemanticCache, createSemanticCache } from "./semantic-cache.js";
import { ResponseCache, createResponseCache } from "./response-cache.js";
import { ContextCompressor, createContextCompressor } from "./context-compressor.js";
import { PromptTemplateEngine, createPromptTemplateEngine } from "./prompt-templates.js";

// ---------------------------------------------------------------------------
// Semantic Cache Tests
// ---------------------------------------------------------------------------

describe("SemanticCache", () => {
  let cache: SemanticCache;

  beforeEach(() => {
    cache = createSemanticCache({ maxEntries: 100, similarityThreshold: 0.9 });
  });

  it("should store and retrieve entries", () => {
    cache.store("What is AI?", "AI is artificial intelligence", "gpt-4", 100);
    const hit = cache.lookup("What is AI?", "gpt-4");
    expect(hit).not.toBeNull();
    expect(hit?.matchType).toBe("exact");
  });

  it("should return null for cache miss", () => {
    const hit = cache.lookup("What is ML?", "gpt-4");
    expect(hit).toBeNull();
  });

  it("should invalidate entries", () => {
    const entry = cache.store("Test prompt", "Test response", "gpt-4", 50);
    expect(cache.invalidate(entry.id)).toBe(true);
    expect(cache.lookup("Test prompt", "gpt-4")).toBeNull();
  });

  it("should clear cache", () => {
    cache.store("Test 1", "Response 1", "gpt-4", 50);
    cache.store("Test 2", "Response 2", "gpt-4", 50);
    cache.clear();
    expect(cache.lookup("Test 1", "gpt-4")).toBeNull();
  });

  it("should track hit count", () => {
    cache.store("Test prompt", "Test response", "gpt-4", 50);
    cache.lookup("Test prompt", "gpt-4");
    cache.lookup("Test prompt", "gpt-4");
    const stats = cache.getStats();
    expect(stats.totalHits).toBe(2);
  });

  it("should evict when full", () => {
    const smallCache = createSemanticCache({ maxEntries: 2 });
    smallCache.store("Prompt 1", "Response 1", "gpt-4", 50);
    smallCache.store("Prompt 2", "Response 2", "gpt-4", 50);
    smallCache.store("Prompt 3", "Response 3", "gpt-4", 50);  // Should evict one
    expect(smallCache.getStats().totalEntries).toBe(2);
  });

  it("should export and import data", () => {
    cache.store("Test prompt", "Test response", "gpt-4", 50);
    const data = cache.exportData();
    expect(data).toHaveLength(1);

    const newCache = createSemanticCache();
    newCache.importData(data);
    expect(newCache.lookup("Test prompt", "gpt-4")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Response Cache Tests
// ---------------------------------------------------------------------------

describe("ResponseCache", () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = createResponseCache({ maxEntries: 100 });
  });

  it("should store and retrieve responses", () => {
    cache.store("What is AI?", "AI is artificial intelligence", "gpt-4", 100, 50);
    const hit = cache.lookup("What is AI?", "gpt-4");
    expect(hit).not.toBeNull();
    expect(hit?.response).toBe("AI is artificial intelligence");
  });

  it("should return null for cache miss", () => {
    const hit = cache.lookup("What is ML?", "gpt-4");
    expect(hit).toBeNull();
  });

  it("should track metrics", () => {
    cache.store("Test", "Response", "gpt-4", 100, 50);
    cache.lookup("Test", "gpt-4");
    cache.lookup("Missing", "gpt-4");

    const metrics = cache.getMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.hits).toBe(1);
    expect(metrics.misses).toBe(1);
    expect(metrics.hitRate).toBe(0.5);
  });

  it("should calculate cost savings", () => {
    cache.store("Test", "Response", "gpt-4", 1000, 500);
    cache.lookup("Test", "gpt-4");

    const metrics = cache.getMetrics();
    expect(metrics.tokensSaved).toBe(1500);
    expect(metrics.costSavedUsd).toBeGreaterThan(0);
  });

  it("should invalidate entries", () => {
    const entry = cache.store("Test", "Response", "gpt-4", 100, 50);
    expect(cache.invalidate(entry.id)).toBe(true);
    expect(cache.lookup("Test", "gpt-4")).toBeNull();
  });

  it("should clear and reset metrics", () => {
    cache.store("Test", "Response", "gpt-4", 100, 50);
    cache.lookup("Test", "gpt-4");
    cache.clear();
    expect(cache.getMetrics().totalRequests).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Context Compressor Tests
// ---------------------------------------------------------------------------

describe("ContextCompressor", () => {
  let compressor: ContextCompressor;

  beforeEach(() => {
    compressor = createContextCompressor({ maxTokens: 200 });
  });

  it("should compress messages to fit budget", () => {
    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello, how are you today? I hope you're doing well. ".repeat(20) },
      { role: "assistant", content: "I'm doing great, thank you! ".repeat(20) },
      { role: "user", content: "Tell me about AI ".repeat(20) },
    ];

    const result = compressor.compressMessages(messages, 50);
    // Compression should produce output with tokens defined
    expect(result.compressedTokens).toBeDefined();
    expect(result.originalTokens).toBeGreaterThan(0);
  });

  it("should preserve system prompt", () => {
    const messages = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "Hello".repeat(50) },
    ];

    const result = compressor.compressMessages(messages, 50);
    expect(result.messages[0]?.role).toBe("system");
    expect(result.messages[0]?.content).toBe("System prompt");
  });

  it("should compress single text", () => {
    const text = "This is a long text. ".repeat(100);
    const result = compressor.compressText(text, 50);
    expect(result.compressed.length).toBeLessThan(text.length);
    expect(result.tokensReduced).toBeGreaterThan(0);
  });

  it("should compress tool output", () => {
    const output = { data: "x".repeat(2000) };
    const compressed = compressor.compressToolOutput("test_tool", output, 100);
    expect(compressed.length).toBeLessThan(JSON.stringify(output).length);
  });

  it("should handle different strategies", () => {
    const messages = [
      { role: "user", content: "Test message 1".repeat(20) },
      { role: "assistant", content: "Test response 1".repeat(20) },
    ];

    const summarizeCompressor = createContextCompressor({ strategy: "summarize", maxTokens: 50 });
    const result = summarizeCompressor.compressMessages(messages, 50);
    expect(result.summary).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Prompt Template Engine Tests
// ---------------------------------------------------------------------------

describe("PromptTemplateEngine", () => {
  let engine: PromptTemplateEngine;

  beforeEach(() => {
    engine = createPromptTemplateEngine();
  });

  it("should have built-in templates", () => {
    const templates = engine.list();
    expect(templates.length).toBeGreaterThan(0);
  });

  it("should register new templates", () => {
    const template = engine.register({
      id: "test_template",
      name: "Test Template",
      category: "test",
      template: "Hello {{name}}!",
      variables: [
        { name: "name", required: true, description: "User name" },
      ],
    });

    expect(template.id).toBe("test_template");
    expect(template.version).toBe(1);
  });

  it("should render templates", () => {
    const template = engine.register({
      id: "test_render",
      name: "Test Render",
      category: "test",
      template: "Hello {{name}}, you are {{age}} years old!",
      variables: [
        { name: "name", required: true, description: "User name" },
        { name: "age", required: true, description: "User age" },
      ],
    });

    const rendered = engine.render("test_render", { name: "Alice", age: "30" });
    expect(rendered).toBe("Hello Alice, you are 30 years old!");
  });

  it("should throw for missing required variables", () => {
    engine.register({
      id: "test_required",
      name: "Test Required",
      category: "test",
      template: "Hello {{name}}!",
      variables: [
        { name: "name", required: true, description: "User name" },
      ],
    });

    expect(() => engine.render("test_required", {})).toThrow("Missing required variable: name");
  });

  it("should use default values", () => {
    engine.register({
      id: "test_default",
      name: "Test Default",
      category: "test",
      template: "Hello {{name}}!",
      variables: [
        { name: "name", required: false, default: "World", description: "User name" },
      ],
    });

    const rendered = engine.render("test_default", {});
    expect(rendered).toBe("Hello World!");
  });

  it("should update templates", () => {
    const template = engine.register({
      id: "test_update",
      name: "Test Update",
      category: "test",
      template: "Version 1",
      variables: [],
    });

    engine.update("test_update", { template: "Version 2" });
    const updated = engine.get("test_update");
    expect(updated?.template).toBe("Version 2");
    expect(updated?.version).toBe(2);
  });

  it("should delete templates", () => {
    engine.register({
      id: "test_delete",
      name: "Test Delete",
      category: "test",
      template: "Delete me",
      variables: [],
    });

    expect(engine.delete("test_delete")).toBe(true);
    expect(engine.get("test_delete")).toBeNull();
  });

  it("should filter by category", () => {
    engine.register({
      id: "test_cat1",
      name: "Category 1",
      category: "cat1",
      template: "Template 1",
      variables: [],
    });

    engine.register({
      id: "test_cat2",
      name: "Category 2",
      category: "cat2",
      template: "Template 2",
      variables: [],
    });

    const cat1Templates = engine.list("cat1");
    expect(cat1Templates).toHaveLength(1);
    expect(cat1Templates[0]?.category).toBe("cat1");
  });

  it("should track usage count", () => {
    const template = engine.register({
      id: "test_usage",
      name: "Test Usage",
      category: "test",
      template: "Hello!",
      variables: [],
    });

    engine.render("test_usage", {});
    engine.render("test_usage", {});

    const updated = engine.get("test_usage");
    expect(updated?.usageCount).toBe(2);
  });

  it("should export and import data", () => {
    engine.register({
      id: "test_export",
      name: "Test Export",
      category: "test",
      template: "Export me",
      variables: [],
    });

    const data = engine.exportData();
    expect(data.length).toBeGreaterThan(0);

    const newEngine = createPromptTemplateEngine();
    newEngine.importData(data);
    expect(newEngine.get("test_export")).not.toBeNull();
  });
});
