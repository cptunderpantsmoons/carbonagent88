/**
 * Context Compressor — Smart Summarization for Context Reduction
 *
 * Control Corridor:
 * - Owns: Message compression, fact extraction, tool output compression
 * - Must NOT own: LLM provider instantiation
 *
 * Provides intelligent context compression to reduce token usage while
 * preserving important information.
 */

import { EventEmitter } from "node:events";
import { estimateTokens } from "../memory/token-counter.js";

// ---------------------------------------------------------------------------
// Compression Types
// ---------------------------------------------------------------------------

export type CompressionStrategy = "summarize" | "extract_facts" | "truncate" | "hybrid";

export interface CompressorConfig {
  strategy: CompressionStrategy;
  maxTokens: number;
  preserveRecent: number;
  preserveSystem: boolean;
  compressionRatio: number;
}

export interface CompressedContext {
  messages: Array<{ role: string; content: string }>;
  summary: string;
  factsExtracted: string[];
  tokensReduced: number;
  compressionRatio: number;
  originalTokens: number;
  compressedTokens: number;
}

export interface CompressionResult {
  original: string;
  compressed: string;
  tokensReduced: number;
  factsExtracted: string[];
}

// ---------------------------------------------------------------------------
// Context Compressor
// ---------------------------------------------------------------------------

export class ContextCompressor extends EventEmitter {
  private config: CompressorConfig;

  constructor(config: Partial<CompressorConfig> = {}) {
    super();
    this.config = {
      strategy: config.strategy ?? "hybrid",
      maxTokens: config.maxTokens ?? 4000,
      preserveRecent: config.preserveRecent ?? 6,
      preserveSystem: config.preserveSystem ?? true,
      compressionRatio: config.compressionRatio ?? 0.5,
    };
  }

  // ---------------------------------------------------------------------------
  // Message Compression
  // ---------------------------------------------------------------------------

  /**
   * Compress a message array to fit within token budget.
   */
  compressMessages(
    messages: Array<{ role: string; content: string }>,
    maxTokens?: number,
  ): CompressedContext {
    const limit = maxTokens ?? this.config.maxTokens;
    const originalTokens = this.estimateMessageTokens(messages);

    if (originalTokens <= limit) {
      return {
        messages,
        summary: "",
        factsExtracted: [],
        tokensReduced: 0,
        compressionRatio: 1,
        originalTokens,
        compressedTokens: originalTokens,
      };
    }

    // Separate system, old, and recent messages
    const systemMessage = this.config.preserveSystem ? messages[0] : null;
    const recentMessages = messages.slice(-this.config.preserveRecent);
    const oldMessages = systemMessage
      ? messages.slice(1, -this.config.preserveRecent)
      : messages.slice(0, -this.config.preserveRecent);

    // Compress old messages
    const compressed = this.compressMessageGroup(oldMessages);

    // Rebuild message array
    const newMessages = systemMessage
      ? [systemMessage, ...compressed.messages, ...recentMessages]
      : [...compressed.messages, ...recentMessages];

    const compressedTokens = this.estimateMessageTokens(newMessages);

    return {
      messages: newMessages,
      summary: compressed.summary,
      factsExtracted: compressed.facts,
      tokensReduced: originalTokens - compressedTokens,
      compressionRatio: compressedTokens / originalTokens,
      originalTokens,
      compressedTokens,
    };
  }

  /**
   * Compress a group of messages.
   */
  private compressMessageGroup(
    messages: Array<{ role: string; content: string }>,
  ): { messages: Array<{ role: string; content: string }>; summary: string; facts: string[] } {
    if (messages.length === 0) {
      return { messages: [], summary: "", facts: [] };
    }

    switch (this.config.strategy) {
      case "summarize":
        return this.summarizeStrategy(messages);
      case "extract_facts":
        return this.extractFactsStrategy(messages);
      case "truncate":
        return this.truncateStrategy(messages);
      case "hybrid":
      default:
        return this.hybridStrategy(messages);
    }
  }

  // ---------------------------------------------------------------------------
  // Compression Strategies
  // ---------------------------------------------------------------------------

  private summarizeStrategy(
    messages: Array<{ role: string; content: string }>,
  ): { messages: Array<{ role: string; content: string }>; summary: string; facts: string[] } {
    // Create a summary of all messages
    const summary = this.generateSummary(messages);
    const facts = this.extractKeyFacts(messages);

    return {
      messages: [{ role: "system", content: `[Summary]\n${summary}` }],
      summary,
      facts,
    };
  }

  private extractFactsStrategy(
    messages: Array<{ role: string; content: string }>,
  ): { messages: Array<{ role: string; content: string }>; summary: string; facts: string[] } {
    const facts = this.extractKeyFacts(messages);

    // Keep only messages with important content
    const importantMessages = messages.filter(msg => {
      const content = msg.content.toLowerCase();
      return content.includes("important") ||
             content.includes("critical") ||
             content.includes("error") ||
             content.includes("decision");
    });

    // If no important messages, keep the last few
    const keptMessages = importantMessages.length > 0
      ? importantMessages.slice(-3)
      : messages.slice(-2);

    const factMessage = {
      role: "system",
      content: `[Key Facts]\n${facts.map(f => `- ${f}`).join("\n")}`,
    };

    return {
      messages: [factMessage, ...keptMessages],
      summary: "",
      facts,
    };
  }

  private truncateStrategy(
    messages: Array<{ role: string; content: string }>,
  ): { messages: Array<{ role: string; content: string }>; summary: string; facts: string[] } {
    // Simply truncate each message
    const truncated = messages.map(msg => ({
      role: msg.role,
      content: msg.content.length > 200
        ? msg.content.slice(0, 200) + "..."
        : msg.content,
    }));

    return {
      messages: truncated,
      summary: "",
      facts: [],
    };
  }

  private hybridStrategy(
    messages: Array<{ role: string; content: string }>,
  ): { messages: Array<{ role: string; content: string }>; summary: string; facts: string[] } {
    // Combine summarization and fact extraction
    const summary = this.generateSummary(messages);
    const facts = this.extractKeyFacts(messages);

    // Keep the most recent message intact
    const recent = messages.slice(-1);

    // Create summary message
    const summaryMessage = {
      role: "system",
      content: `[Context Summary]\n${summary}\n\n[Key Facts]\n${facts.map(f => `- ${f}`).join("\n")}`,
    };

    return {
      messages: [summaryMessage, ...recent],
      summary,
      facts,
    };
  }

  // ---------------------------------------------------------------------------
  // Text Compression
  // ---------------------------------------------------------------------------

  /**
   * Compress a single text string.
   */
  compressText(text: string, maxTokens?: number): CompressionResult {
    const limit = maxTokens ?? Math.floor(this.config.maxTokens * 0.3);
    const originalTokens = estimateTokens(text);

    if (originalTokens <= limit) {
      return {
        original: text,
        compressed: text,
        tokensReduced: 0,
        factsExtracted: [],
      };
    }

    // Strategy: take first sentence of each paragraph + key facts
    const paragraphs = text.split(/\n\n+/);
    const compressed = paragraphs
      .map(p => {
        const sentences = p.split(/[.!?]+/).filter(s => s.trim().length > 0);
        return sentences[0]?.trim() ?? p.slice(0, 100);
      })
      .filter(s => s.length > 0)
      .join("\n");

    const facts = this.extractKeyFacts([{ role: "user", content: text }]);
    const compressedTokens = estimateTokens(compressed);

    return {
      original: text,
      compressed,
      tokensReduced: originalTokens - compressedTokens,
      factsExtracted: facts,
    };
  }

  /**
   * Compress tool output.
   */
  compressToolOutput(
    _toolName: string,
    output: unknown,
    maxTokens?: number,
  ): string {
    const outputStr = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    const limit = maxTokens ?? 500;

    if (estimateTokens(outputStr) <= limit) {
      return outputStr;
    }

    // Truncate with indication
    const truncated = outputStr.slice(0, limit * 4);  // ~4 chars per token
    return `${truncated}\n\n[Truncated: output was ${estimateTokens(outputStr)} tokens]`;
  }

  // ---------------------------------------------------------------------------
  // Fact Extraction
  // ---------------------------------------------------------------------------

  private generateSummary(messages: Array<{ role: string; content: string }>): string {
    const points: string[] = [];

    for (const msg of messages.slice(-5)) {  // Last 5 messages
      const truncated = msg.content.slice(0, 150);
      if (truncated.length > 0) {
        points.push(`[${msg.role}]: ${truncated}${msg.content.length > 150 ? "..." : ""}`);
      }
    }

    return points.join("\n") || "Previous context";
  }

  private extractKeyFacts(messages: Array<{ role: string; content: string }>): string[] {
    const facts: string[] = [];

    for (const msg of messages) {
      const content = msg.content;

      // Extract sentences that look like facts
      const sentences = content.split(/[.!?]+/);
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length > 20 && trimmed.length < 200) {
          // Simple heuristic: if it contains "is", "are", "was", "were", it might be a fact
          if (/\b(is|are|was|were|has|have|had|will|would|can|could|should)\b/i.test(trimmed)) {
            facts.push(trimmed);
          }
        }
      }
    }

    // Deduplicate and limit
    const uniqueFacts = [...new Set(facts)];
    return uniqueFacts.slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
    return messages.reduce((sum, msg) => sum + estimateTokens(msg.content) + 4, 0);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createContextCompressor(config?: Partial<CompressorConfig>): ContextCompressor {
  return new ContextCompressor(config);
}
