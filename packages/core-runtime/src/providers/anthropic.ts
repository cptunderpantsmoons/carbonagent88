import Anthropic from "@anthropic-ai/sdk";
import type { AIProviderConfig } from "@carbon-agent/shared-schemas";
import type { ChatRequest, ChatResponse, StreamChunk, LLMProvider } from "../gateway.js";
import { withRetry } from "./retry.js";

/**
 * Anthropic Claude Provider
 * 
 * Supports all Claude models via the Messages API.
 */

export class AnthropicProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type = "anthropic";
  private client: Anthropic;

  constructor(config: AIProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Extract system messages and pass them as a separate parameter.
    // Anthropic's Messages API requires system content as a top-level field,
    // not as a message with role "system".
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const system = systemMessages.map((m) => m.content).join("\n\n");
    const messages = request.messages.filter((m) => m.role !== "system") as Anthropic.MessageParam[];

    const response = await withRetry((signal) =>
      this.client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
        ...(system ? { system } : {}),
        messages,
        tools: request.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
        // Pass the abort signal for timeout support
        ...(signal ? { signal } : {}),
      }) as Promise<Anthropic.Message>,
    );

    const content = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("");

    const toolCalls = response.content
      .filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
      .map((c) => ({
        id: c.id,
        name: c.name,
        input: c.input as Record<string, unknown>,
      }));

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
    };
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    // Extract system messages for the same reason as chat().
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const system = systemMessages.map((m) => m.content).join("\n\n");
    const messages = request.messages.filter((m) => m.role !== "system") as Anthropic.MessageParam[];

    const stream = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      ...(system ? { system } : {}),
      messages,
      tools: request.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { content: delta.text, done: false };
        }
      }
    }

    yield { content: "", done: true };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      });
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
