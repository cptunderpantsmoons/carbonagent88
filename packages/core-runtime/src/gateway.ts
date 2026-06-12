/**
 * Core Runtime — LLM Gateway
 * 
 * Unified interface for all LLM providers. The Gateway abstracts away
 * provider-specific APIs so the agent loop only deals with one contract.
 * 
 * Control Corridor:
 * - core-runtime owns LLM routing, streaming, and token counting
 * - It does NOT own browser profiles or filesystem persistence
 */

import type { AIProviderConfig } from "@carbon-agent/shared-schemas";

// ---------------------------------------------------------------------------
// Common types (provider-agnostic)
// ---------------------------------------------------------------------------

export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface StreamChunk {
  content: string;
  toolCall?: Partial<ToolCall>;
  done: boolean;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type: string;

  /** Non-streaming chat completion */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /** Streaming chat completion (yields chunks) */
  stream(request: ChatRequest): AsyncGenerator<StreamChunk>;

  /** Quick connectivity test */
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { CustomOpenAIProvider } from "./providers/custom-openai.js";

export function createProvider(config: AIProviderConfig): LLMProvider {
  switch (config.type) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
      return new OpenAIProvider(config);
    case "custom-openai":
      return new CustomOpenAIProvider(config);
    default:
      throw new Error(`Unsupported provider type: ${(config as { type?: string }).type}`);
  }
}

export { AnthropicProvider, OpenAIProvider, CustomOpenAIProvider };
