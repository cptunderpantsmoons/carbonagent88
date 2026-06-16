/**
 * CachingProvider Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMProvider, ChatRequest, ChatResponse } from "../gateway.js";
import { CachingProvider } from "./caching-provider.js";
import { ResponseCache, createResponseCache } from "./response-cache.js";
import { SemanticCache, createSemanticCache } from "./semantic-cache.js";

function createMockProvider(
  response: ChatResponse = {
    content: "hello",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  },
): LLMProvider {
  return {
    id: "mock",
    name: "mock-provider",
    type: "mock",
    chat: vi.fn().mockResolvedValue(response),
    stream: vi.fn().mockImplementation(async function* () {
      yield { content: "hello", done: false };
      yield { content: "", done: true };
    }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("CachingProvider", () => {
  let responseCache: ResponseCache;
  let semanticCache: SemanticCache;

  beforeEach(() => {
    responseCache = createResponseCache({ maxEntries: 100, defaultTtlMs: 60000 });
    semanticCache = createSemanticCache({ maxEntries: 100, defaultTtlMs: 60000 });
  });

  it("delegates id, name, and type to inner provider", () => {
    const inner = createMockProvider();
    const provider = new CachingProvider(inner);

    expect(provider.id).toBe(inner.id);
    expect(provider.name).toBe(inner.name);
    expect(provider.type).toBe(inner.type);
  });

  it("returns response cache hit without calling inner provider", async () => {
    const inner = createMockProvider();
    const provider = new CachingProvider(inner, { responseCache });
    const request: ChatRequest = {
      messages: [{ role: "user", content: "What is AI?" }],
      model: "gpt-4",
    };

    responseCache.store(
      JSON.stringify(request.messages),
      "AI is artificial intelligence",
      "gpt-4",
      10,
      5,
    );

    const result = await provider.chat(request);

    expect(result.content).toBe("AI is artificial intelligence");
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(inner.chat).not.toHaveBeenCalled();
  });

  it("returns semantic cache hit without calling inner provider", async () => {
    const inner = createMockProvider();
    const provider = new CachingProvider(inner, { semanticCache });
    const request: ChatRequest = {
      messages: [{ role: "user", content: "Explain quantum computing" }],
      model: "gpt-4",
    };

    semanticCache.store(
      JSON.stringify(request.messages),
      "Quantum computing uses qubits",
      "gpt-4",
      100,
    );

    const result = await provider.chat(request);

    expect(result.content).toBe("Quantum computing uses qubits");
    expect(inner.chat).not.toHaveBeenCalled();
  });

  it("calls inner provider on cache miss and stores result", async () => {
    const inner = createMockProvider({
      content: "Mocked response",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    const provider = new CachingProvider(inner, {
      responseCache,
      semanticCache,
    });
    const request: ChatRequest = {
      messages: [{ role: "user", content: "Hello" }],
      model: "gpt-4",
    };

    const result = await provider.chat(request);
    expect(result.content).toBe("Mocked response");
    expect(inner.chat).toHaveBeenCalledTimes(1);

    // Response cache should now contain the stored entry
    const responseHit = responseCache.lookup(
      JSON.stringify(request.messages),
      "gpt-4",
    );
    expect(responseHit).not.toBeNull();
    expect(responseHit?.response).toBe("Mocked response");

    // Semantic cache should also contain the stored entry
    const semanticHit = semanticCache.lookup(
      JSON.stringify(request.messages),
      "gpt-4",
    );
    expect(semanticHit).not.toBeNull();
    expect(semanticHit?.entry.response).toBe("Mocked response");

    // Second call should hit the response cache
    const cachedResult = await provider.chat(request);
    expect(cachedResult.content).toBe("Mocked response");
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });

  it("uses estimated token count for semantic cache store", async () => {
    const inner = createMockProvider({ content: "abcd" });
    const provider = new CachingProvider(inner, { semanticCache });
    const request: ChatRequest = {
      messages: [{ role: "user", content: "Hi" }],
      model: "gpt-4",
    };

    await provider.chat(request);

    const semanticHit = semanticCache.lookup(
      JSON.stringify(request.messages),
      "gpt-4",
    );
    expect(semanticHit).not.toBeNull();
    expect(semanticHit?.entry.tokenCount).toBe(1);
  });

  it("delegates stream and testConnection to inner provider", async () => {
    const inner = createMockProvider();
    const provider = new CachingProvider(inner);

    const chunks: string[] = [];
    for await (const chunk of provider.stream({ messages: [], model: "gpt-4" })) {
      chunks.push(chunk.content);
    }

    expect(inner.stream).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual(["hello", ""]);

    const connectionResult = await provider.testConnection();
    expect(inner.testConnection).toHaveBeenCalledTimes(1);
    expect(connectionResult).toEqual({ ok: true });
  });
});
