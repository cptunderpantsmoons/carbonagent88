/**
 * Cache System — Barrel Exports
 *
 * Prompt caching and context compression components for Carbon Agent.
 */

// Semantic cache (exact + near-match)
export {
  SemanticCache,
  createSemanticCache,
  type SemanticCacheEntry,
  type SemanticCacheConfig,
  type CacheHit,
} from "./semantic-cache.js";

// Response cache (memoization)
export {
  ResponseCache,
  createResponseCache,
  type ResponseCacheEntry,
  type ResponseCacheConfig,
  type CacheMetrics,
} from "./response-cache.js";

// Context compressor
export {
  ContextCompressor,
  createContextCompressor,
  type CompressorConfig,
  type CompressedContext,
  type CompressionResult as TextCompressionResult,
  type CompressionStrategy,
} from "./context-compressor.js";

// Prompt templates
export {
  PromptTemplateEngine,
  createPromptTemplateEngine,
  type PromptTemplate,
  type TemplateVariable,
  type TemplateRenderOptions,
} from "./prompt-templates.js";
