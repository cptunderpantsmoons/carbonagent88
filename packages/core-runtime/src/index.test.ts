import { describe, it, expect } from "vitest";
import {
  createProvider,
  AnthropicProvider,
  OpenAIProvider,
  CustomOpenAIProvider,
} from "../src/index";
import type { AIProviderConfig } from "@carbon-agent/shared-schemas";

describe("LLM Gateway", () => {
  const anthropicConfig: AIProviderConfig = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    type: "anthropic",
    name: "Claude Test",
    apiKey: "sk-ant-test",
    model: "claude-sonnet-4-20250514",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const openaiConfig: AIProviderConfig = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    type: "openai",
    name: "OpenAI Test",
    apiKey: "sk-openai-test",
    model: "gpt-4o",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const customConfig: AIProviderConfig = {
    id: "550e8400-e29b-41d4-a716-446655440002",
    type: "custom-openai",
    name: "Local LLM",
    apiKey: "local-key",
    baseUrl: "http://localhost:1234/v1",
    model: "llama-3.1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe("createProvider", () => {
    it("creates Anthropic provider", () => {
      const p = createProvider(anthropicConfig);
      expect(p).toBeInstanceOf(AnthropicProvider);
      expect(p.type).toBe("anthropic");
      expect(p.name).toBe("Claude Test");
    });

    it("creates OpenAI provider", () => {
      const p = createProvider(openaiConfig);
      expect(p).toBeInstanceOf(OpenAIProvider);
      expect(p.type).toBe("openai");
    });

    it("creates Custom OpenAI provider", () => {
      const p = createProvider(customConfig);
      expect(p).toBeInstanceOf(CustomOpenAIProvider);
      expect(p.type).toBe("custom-openai");
    });

    it("throws on unsupported type", () => {
      expect(() =>
        createProvider({ ...anthropicConfig, type: "unknown" as any }),
      ).toThrow("Unsupported provider type");
    });
  });

  describe("CustomOpenAIProvider", () => {
    it("requires baseUrl", () => {
      expect(
        () =>
          new CustomOpenAIProvider({
            ...customConfig,
            baseUrl: undefined,
          } as any),
      ).toThrow("Custom OpenAI provider requires baseUrl");
    });
  });

  describe("Provider interface", () => {
    it("all providers have required properties", () => {
      const providers = [
        createProvider(anthropicConfig),
        createProvider(openaiConfig),
        createProvider(customConfig),
      ];
      for (const p of providers) {
        expect(p.id).toBeDefined();
        expect(p.name).toBeDefined();
        expect(p.type).toBeDefined();
        expect(typeof p.chat).toBe("function");
        expect(typeof p.stream).toBe("function");
        expect(typeof p.testConnection).toBe("function");
      }
    });
  });
});
