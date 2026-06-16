/**
 * CachingProvider — LLM Provider Cache Wrapper
 *
 * Control Corridor:
 * - Owns: Cache lookup/store orchestration around an inner LLM provider
 * - Must NOT own: Provider instantiation, prompt construction beyond deterministic serialization
 *
 * Wraps any LLMProvider with response and semantic cache layers.
 */

import type {
  LLMProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
} from "../gateway.js";
import type { ResponseCache } from "./response-cache.js";
import type { SemanticCache } from "./semantic-cache.js";

export interface CachingProviderOptions {
  responseCache?: ResponseCache;
  semanticCache?: SemanticCache;
}

export class CachingProvider implements LLMProvider {
  private inner: LLMProvider;
  private responseCache?: ResponseCache;
  private semanticCache?: SemanticCache;

  get id(): string {
    return this.inner.id;
  }

  get name(): string {
    return this.inner.name;
  }

  get type(): string {
    return this.inner.type;
  }

  constructor(inner: LLMProvider, options: CachingProviderOptions = {}) {
    this.inner = inner;
    this.responseCache = options.responseCache;
    this.semanticCache = options.semanticCache;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const prompt = JSON.stringify(request.messages);
    const model = request.model;

    // 1. Exact response cache lookup
    const responseHit = this.responseCache?.lookup(prompt, model);
    if (responseHit) {
      return {
        content: responseHit.response,
        usage: {
          inputTokens: responseHit.inputTokens,
          outputTokens: responseHit.outputTokens,
          totalTokens: responseHit.inputTokens + responseHit.outputTokens,
        },
      };
    }

    // 2. Semantic cache lookup
    const semanticHit = this.semanticCache?.lookup(prompt, model);
    if (semanticHit) {
      return {
        content: semanticHit.entry.response,
      };
    }

    // 3. Fallback to inner provider
    const response = await this.inner.chat(request);
    const content = response.content;

    // 4. Store in response cache with usage metadata
    if (this.responseCache && response.usage) {
      this.responseCache.store(
        prompt,
        content,
        model,
        response.usage.inputTokens,
        response.usage.outputTokens,
      );
    }

    // 5. Store in semantic cache with estimated token count
    if (this.semanticCache) {
      const tokenCount = Math.ceil(content.length / 4);
      this.semanticCache.store(prompt, content, model, tokenCount);
    }

    return response;
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    yield* this.inner.stream(request);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    return this.inner.testConnection();
  }
}

export function createCachingProvider(
  inner: LLMProvider,
  options?: CachingProviderOptions,
): CachingProvider {
  return new CachingProvider(inner, options);
}
