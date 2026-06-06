import OpenAI from "openai";
import type { AIProviderConfig } from "@carbon-agent/shared-schemas";
import type { ChatRequest, ChatResponse, StreamChunk, LLMProvider } from "../gateway.js";

/**
 * Custom OpenAI-compatible Provider
 * 
 * For local LLMs (Ollama, LM Studio, etc.) and other OpenAI-compatible APIs.
 * Uses the same OpenAI SDK but with a custom base URL.
 */

export class CustomOpenAIProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type = "custom-openai";
  private client: OpenAI;

  constructor(config: AIProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    if (!config.baseUrl) {
      throw new Error("Custom OpenAI provider requires baseUrl");
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: request.tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    });

    const choice = response.choices[0];
    const message = choice?.message;

    const toolCalls = message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: message?.content ?? "",
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: request.tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { content: delta.content, done: false };
      }
    }

    yield { content: "", done: true };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.chat.completions.create({
        model: "gpt-4o-mini", // generic model for test
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }
}
