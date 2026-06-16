/**
 * Working Memory — Token-Aware Context Window
 *
 * Control Corridor:
 * - Owns: Active conversation context, token budget management, smart compression
 * - Must NOT own: LLM provider instantiation, message construction
 *
 * Manages the active conversation context with token-aware rotation,
 * replacing the naive MAX_HISTORY=40 message-count-based approach.
 */

import { EventEmitter } from "node:events";
import {
  estimateTokens,
  ContextWindowManager,
  type TokenBudget,
} from "./token-counter.js";

// ---------------------------------------------------------------------------
// Working Memory Types
// ---------------------------------------------------------------------------

export interface WorkingMemoryConfig {
  maxTokens: number;
  compressThreshold: number;    // Percentage (0-1) at which to trigger compression
  preserveSystemPrompt: boolean;
  preserveRecentMessages: number;
  enableSummarization: boolean;
}

export interface WorkingMemoryState {
  messages: Array<{ role: string; content: string }>;
  tokenCount: number;
  maxTokens: number;
  compressionCount: number;
  lastCompressedAt?: string;
}

export interface CompressionResult {
  originalCount: number;
  compressedCount: number;
  tokensReduced: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Working Memory
// ---------------------------------------------------------------------------

export class WorkingMemory extends EventEmitter {
  private config: WorkingMemoryConfig;
  private contextManager: ContextWindowManager;
  private compressionCount: number = 0;
  private lastCompressedAt?: string;
  private compressionHistory: CompressionResult[] = [];

  constructor(config: Partial<WorkingMemoryConfig> = {}) {
    super();
    this.config = {
      maxTokens: config.maxTokens ?? 8192,
      compressThreshold: config.compressThreshold ?? 0.8,
      preserveSystemPrompt: config.preserveSystemPrompt ?? true,
      preserveRecentMessages: config.preserveRecentMessages ?? 6,
      enableSummarization: config.enableSummarization ?? true,
    };
    this.contextManager = new ContextWindowManager(this.config.maxTokens);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get the current messages.
   */
  getMessages(): Array<{ role: string; content: string }> {
    return this.contextManager.getMessages();
  }

  /**
   * Get the current token count.
   */
  getTokenCount(): number {
    return this.contextManager.getTokenCount();
  }

  /**
   * Get the token budget.
   */
  getBudget(): TokenBudget {
    return this.contextManager.getBudget();
  }

  /**
   * Add a message to working memory.
   * Automatically compresses if needed.
   */
  addMessage(message: { role: string; content: string }): void {
    const budget = this.getBudget();

    // Check if compression is needed
    if (budget.percentage >= this.config.compressThreshold * 100) {
      this.compress();
    }

    this.contextManager.addMessage(message);
    this.emit("message_added", { message, budget: this.getBudget() });
  }

  /**
   * Set the entire message history.
   */
  setMessages(messages: Array<{ role: string; content: string }>): void {
    this.contextManager.setMessages(messages);
    this.emit("messages_set", { count: messages.length });
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.contextManager.setMessages([]);
    this.compressionCount = 0;
    this.compressionHistory = [];
    this.emit("cleared");
  }

  /**
   * Get the full state for serialization.
   */
  getState(): WorkingMemoryState {
    return {
      messages: this.getMessages(),
      tokenCount: this.getTokenCount(),
      maxTokens: this.config.maxTokens,
      compressionCount: this.compressionCount,
      lastCompressedAt: this.lastCompressedAt,
    };
  }

  /**
   * Restore state from serialization.
   */
  restoreState(state: WorkingMemoryState): void {
    this.contextManager.setMessages(state.messages);
    this.compressionCount = state.compressionCount;
    this.lastCompressedAt = state.lastCompressedAt;
    this.emit("state_restored", { state });
  }

  /**
   * Get compression history.
   */
  getCompressionHistory(): CompressionResult[] {
    return [...this.compressionHistory];
  }

  // ---------------------------------------------------------------------------
  // Compression
  // ---------------------------------------------------------------------------

  /**
   * Compress the message history to free up token space.
   * Uses smart summarization to preserve important context.
   */
  compress(): CompressionResult {
    const messages = this.getMessages();
    const originalCount = messages.length;
    const originalTokens = this.getTokenCount();

    if (originalCount <= this.config.preserveRecentMessages + 1) {
      return {
        originalCount,
        compressedCount: originalCount,
        tokensReduced: 0,
        summary: "No compression needed",
      };
    }

    // Separate system prompt, old messages, and recent messages
    const systemMessage = this.config.preserveSystemPrompt ? messages[0] : null;
    const recentMessages = messages.slice(-this.config.preserveRecentMessages);
    const oldMessages = systemMessage
      ? messages.slice(1, -this.config.preserveRecentMessages)
      : messages.slice(0, -this.config.preserveRecentMessages);

    // Create summary of old messages
    const summary = this.summarizeMessages(oldMessages);
    const summaryMessage = { role: "system", content: `[Context Summary]\n${summary}` };

    // Rebuild message array
    const newMessages = systemMessage
      ? [systemMessage, summaryMessage, ...recentMessages]
      : [summaryMessage, ...recentMessages];

    this.contextManager.setMessages(newMessages);

    const compressedTokens = this.getTokenCount();
    const tokensReduced = originalTokens - compressedTokens;

    this.compressionCount++;
    this.lastCompressedAt = new Date().toISOString();

    const result: CompressionResult = {
      originalCount,
      compressedCount: newMessages.length,
      tokensReduced,
      summary,
    };

    this.compressionHistory.push(result);
    this.emit("compressed", result);

    return result;
  }

  /**
   * Summarize old messages into a concise context.
   */
  private summarizeMessages(messages: Array<{ role: string; content: string }>): string {
    const points: string[] = [];

    // Group messages by role
    const userMessages: string[] = [];
    const assistantMessages: string[] = [];
    const toolMessages: string[] = [];

    for (const msg of messages) {
      const truncated = msg.content.slice(0, 300);
      switch (msg.role) {
        case "user":
          userMessages.push(truncated);
          break;
        case "assistant":
          assistantMessages.push(truncated);
          break;
        case "tool":
        case "system":
          toolMessages.push(truncated);
          break;
      }
    }

    // Build summary
    if (userMessages.length > 0) {
      points.push(`User requests: ${userMessages.slice(-3).join("; ")}`);
    }
    if (assistantMessages.length > 0) {
      points.push(`Assistant actions: ${assistantMessages.slice(-3).join("; ")}`);
    }
    if (toolMessages.length > 0) {
      points.push(`Tool results: ${toolMessages.length} tool calls completed`);
    }

    return points.join("\n") || "Previous conversation context";
  }

  // ---------------------------------------------------------------------------
  // Context Injection
  // ---------------------------------------------------------------------------

  /**
   * Get the context window with injected memories.
   * Memories are injected as system messages before the user message.
   */
  getContextWithMemories(
    memories: Array<{ content: string; score: number }>,
    maxMemoryTokens: number = 1000,
  ): Array<{ role: string; content: string }> {
    const messages = this.getMessages();
    if (memories.length === 0) return messages;

    // Build memory injection
    let memoryTokens = 0;
    const memoryLines: string[] = [];

    for (const memory of memories) {
      const line = `- ${memory.content}`;
      const lineTokens = estimateTokens(line);
      if (memoryTokens + lineTokens > maxMemoryTokens) break;
      memoryLines.push(line);
      memoryTokens += lineTokens;
    }

    if (memoryLines.length === 0) return messages;

    const memoryContext = `[Relevant Context]\n${memoryLines.join("\n")}`;
    const memoryMessage = { role: "system", content: memoryContext };

    // Find the right place to inject (after system prompt, before first user message)
    const insertIndex = messages.findIndex(m => m.role === "user");
    if (insertIndex === -1) {
      return [...messages, memoryMessage];
    }

    return [
      ...messages.slice(0, insertIndex),
      memoryMessage,
      ...messages.slice(insertIndex),
    ];
  }

  /**
   * Get a sliding window of messages.
   */
  getWindow(maxTokens?: number): Array<{ role: string; content: string }> {
    return this.contextManager.getWindow(maxTokens);
  }
}

// ---------------------------------------------------------------------------
// Working Memory Factory
// ---------------------------------------------------------------------------

export function createWorkingMemory(config?: Partial<WorkingMemoryConfig>): WorkingMemory {
  return new WorkingMemory(config);
}

export function createWorkingMemoryForModel(model: string): WorkingMemory {
  // Default context window sizes for common models
  const contextSizes: Record<string, number> = {
    "claude-sonnet-4-20250514": 200000,
    "claude-opus-4-20250514": 200000,
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4": 8192,
    "gpt-3.5-turbo": 16385,
    "default": 8192,
  };

  const maxTokens = contextSizes[model] ?? contextSizes["default"]!;
  // Use 70% of context window for working memory (leave room for output)
  return new WorkingMemory({ maxTokens: Math.floor(maxTokens * 0.7) });
}
