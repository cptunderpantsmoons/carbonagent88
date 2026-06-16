/**
 * Token Counter — Proactive Token Management
 *
 * Control Corridor:
 * - Owns: Token counting, estimation, and budget management
 * - Must NOT own: LLM provider instantiation, message construction
 *
 * Provides tiktoken-based token counting for proactive context window
 * management, replacing the naive message-count-based rotation.
 */

// Simple token estimator using character-based heuristics
// In production, this would use tiktoken, but for now we use a fast heuristic

const CHARS_PER_TOKEN_ESTIMATE = 4;
const OVERHEAD_PER_MESSAGE = 4;  // <|im_start|>role\n etc.
const TOOL_CALL_OVERHEAD = 50;

export interface TokenBudget {
  total: number;
  used: number;
  remaining: number;
  percentage: number;
}

export interface TokenEstimate {
  tokens: number;
  method: "exact" | "estimated";
}

/**
 * Estimate token count for a string using character-based heuristic.
 * ~4 chars per token for English text (GPT/Claude family).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough estimation: 1 token per 4 chars, plus overhead for special tokens
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Count tokens in a chat message array.
 * Accounts for message framing overhead.
 */
export function countMessageTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0;
  for (const msg of messages) {
    total += OVERHEAD_PER_MESSAGE;
    total += estimateTokens(msg.content);
  }
  // Add conversation framing overhead
  total += 4;
  return total;
}

/**
 * Check if adding a message would exceed the token budget.
 */
export function wouldExceedBudget(
  currentMessages: Array<{ role: string; content: string }>,
  newMessage: { role: string; content: string },
  maxTokens: number,
): boolean {
  const currentTokens = countMessageTokens(currentMessages);
  const newTokens = estimateTokens(newMessage.content) + OVERHEAD_PER_MESSAGE;
  return currentTokens + newTokens > maxTokens;
}

/**
 * Calculate how many recent messages fit within a token budget.
 */
export function calculateFittingMessages(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): number {
  let tokenCount = 0;
  let count = 0;

  // Always include the first message (system prompt)
  if (messages.length > 0) {
    tokenCount += estimateTokens(messages[0]!.content) + OVERHEAD_PER_MESSAGE;
    count = 1;
  }

  // Add messages from the end (most recent) until budget is reached
  for (let i = messages.length - 1; i >= count; i--) {
    const msgTokens = estimateTokens(messages[i]!.content) + OVERHEAD_PER_MESSAGE;
    if (tokenCount + msgTokens > maxTokens) break;
    tokenCount += msgTokens;
    count++;
  }

  return count;
}

/**
 * Smart message rotation that preserves system prompt and recent context.
 * Returns a new array with messages that fit within the token budget.
 */
export function rotateMessages(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): Array<{ role: string; content: string }> {
  if (messages.length === 0) return [];

  const systemMessage = messages[0];
  const otherMessages = messages.slice(1);

  // If everything fits, return as-is
  const totalTokens = countMessageTokens(messages);
  if (totalTokens <= maxTokens) return [...messages];

  // Keep system message + as many recent messages as possible
  const systemTokens = estimateTokens(systemMessage!.content) + OVERHEAD_PER_MESSAGE;
  const availableForHistory = maxTokens - systemTokens;

  let recentTokens = 0;
  let recentCount = 0;

  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(otherMessages[i]!.content) + OVERHEAD_PER_MESSAGE;
    if (recentTokens + msgTokens > availableForHistory) break;
    recentTokens += msgTokens;
    recentCount++;
  }

  return [
    systemMessage!,
    ...otherMessages.slice(otherMessages.length - recentCount),
  ];
}

/**
 * Token budget manager for multi-agent systems.
 */
export class TokenBudgetManager {
  private maxTokens: number;
  private usedTokens: number = 0;
  private reservedTokens: number = 0;

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens;
  }

  getBudget(): TokenBudget {
    const available = this.maxTokens - this.usedTokens - this.reservedTokens;
    return {
      total: this.maxTokens,
      used: this.usedTokens + this.reservedTokens,
      remaining: Math.max(0, available),
      percentage: ((this.usedTokens + this.reservedTokens) / this.maxTokens) * 100,
    };
  }

  canFit(tokens: number): boolean {
    return this.getBudget().remaining >= tokens;
  }

  allocate(tokens: number): boolean {
    if (!this.canFit(tokens)) return false;
    this.usedTokens += tokens;
    return true;
  }

  reserve(tokens: number): boolean {
    if (!this.canFit(tokens)) return false;
    this.reservedTokens += tokens;
    return true;
  }

  releaseReserved(tokens: number): void {
    this.reservedTokens = Math.max(0, this.reservedTokens - tokens);
  }

  reset(): void {
    this.usedTokens = 0;
    this.reservedTokens = 0;
  }
}

/**
 * Context window manager that handles token-aware message management.
 */
export class ContextWindowManager {
  private maxTokens: number;
  private messages: Array<{ role: string; content: string }> = [];
  private tokenCount: number = 0;

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens;
  }

  getMessages(): Array<{ role: string; content: string }> {
    return [...this.messages];
  }

  getTokenCount(): number {
    return this.tokenCount;
  }

  getBudget(): TokenBudget {
    return {
      total: this.maxTokens,
      used: this.tokenCount,
      remaining: this.maxTokens - this.tokenCount,
      percentage: (this.tokenCount / this.maxTokens) * 100,
    };
  }

  addMessage(message: { role: string; content: string }): void {
    const msgTokens = estimateTokens(message.content) + OVERHEAD_PER_MESSAGE;

    // If adding this message would exceed budget, compress first
    if (this.tokenCount + msgTokens > this.maxTokens) {
      this.compress();
    }

    this.messages.push(message);
    this.tokenCount += msgTokens;
  }

  setMessages(messages: Array<{ role: string; content: string }>): void {
    this.messages = [...messages];
    this.tokenCount = countMessageTokens(messages);
  }

  /**
   * Compress message history by summarizing older messages.
   * Keeps the system prompt and recent messages intact.
   */
  compress(): void {
    if (this.messages.length <= 4) return;

    const systemMessage = this.messages[0];
    const recentMessages = this.messages.slice(-6); // Keep last 6 messages
    const oldMessages = this.messages.slice(1, -6);

    if (oldMessages.length === 0) return;

    // Create a summary of old messages
    const summary = this.summarizeMessages(oldMessages);
    const summaryMessage = { role: "system", content: `[Context Summary]\n${summary}` };

    this.messages = [systemMessage!, summaryMessage, ...recentMessages];
    this.tokenCount = countMessageTokens(this.messages);
  }

  private summarizeMessages(messages: Array<{ role: string; content: string }>): string {
    // Simple summarization: extract key points from messages
    const points: string[] = [];
    for (const msg of messages) {
      // Take first 200 chars of each message as a summary point
      const truncated = msg.content.slice(0, 200);
      if (truncated.length > 0) {
        points.push(`- [${msg.role}]: ${truncated}${msg.content.length > 200 ? "..." : ""}`);
      }
    }
    return points.join("\n");
  }

  /**
   * Get a sliding window of messages that fits within the token budget.
   */
  getWindow(maxTokens?: number): Array<{ role: string; content: string }> {
    const limit = maxTokens ?? this.maxTokens;
    return rotateMessages(this.messages, limit);
  }
}

/**
 * Estimate tokens for tool call input/output.
 */
export function estimateToolTokens(
  _toolName: string,
  input: Record<string, unknown>,
  output?: unknown,
): number {
  const inputStr = JSON.stringify(input);
  const outputStr = output ? JSON.stringify(output) : "";
  return estimateTokens(inputStr) + estimateTokens(outputStr) + TOOL_CALL_OVERHEAD;
}

/**
 * Calculate total tokens for an agent step (message + tool calls).
 */
export function estimateStepTokens(
  message: string,
  toolCalls?: Array<{ name: string; input: Record<string, unknown>; output?: unknown }>,
): number {
  let tokens = estimateTokens(message) + OVERHEAD_PER_MESSAGE;
  if (toolCalls) {
    for (const tc of toolCalls) {
      tokens += estimateToolTokens(tc.name, tc.input, tc.output);
    }
  }
  return tokens;
}
