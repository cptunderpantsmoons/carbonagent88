import { describe, it, expect, vi } from "vitest";
import { AgentRuntime } from "./agent.js";
import type { ToolExecutor, ToolDefinition } from "./agent.js";
import type { LLMProvider } from "./gateway.js";

const mockProvider = {
  id: "mock",
  name: "mock",
  type: "mock",
  chat: vi.fn(),
  stream: vi.fn(),
  testConnection: vi.fn(),
} as unknown as LLMProvider;

const runConfigBase = {
  providerOverride: mockProvider,
  runId: "run-1",
  workspaceId: "00000000-0000-0000-0000-000000000000",
  conversationId: "conv-1",
  maxSteps: 5,
};

const executor: ToolExecutor = {
  stealth_open: vi.fn().mockResolvedValue({ ok: true }),
  stealth_scrape: vi.fn(),
  stealth_download: vi.fn(),
  stealth_interact: vi.fn(),
  stealth_screenshot: vi.fn(),
  stealth_evaluate: vi.fn(),
  stealth_axtree: vi.fn(),
  graph_query: vi.fn(),
  generate_document: vi.fn(),
  recall_skill: vi.fn(),
  store_skill: vi.fn(),
  vault_read: vi.fn(),
  vault_write: vi.fn(),
  vault_link: vi.fn(),
  ingest_file: vi.fn(),
  rag_retrieve: vi.fn(),
  write_note: vi.fn(),
  delegate_task: vi.fn(),
  memory_recall: vi.fn(),
  memory_store: vi.fn(),
};

describe("AgentRuntime tool permission enforcement", () => {
  it("denies a tool call when the resolver returns false", async () => {
    const tools: ToolDefinition[] = [
      {
        name: "protected_tool",
        description: "A protected tool",
        inputSchema: { type: "object" },
        permissions: ["admin-only"],
      },
    ];

    const runtime = new AgentRuntime(
      {
        ...runConfigBase,
        tools,
        permissionResolver: () => false,
      },
      executor,
    );

    const result = await (runtime as unknown as { executeTool(name: string, input: Record<string, unknown>): Promise<unknown> }).executeTool("protected_tool", {});

    expect(result).toEqual({
      success: false,
      output: null,
      error: "Permission denied",
      permissionDenied: true,
    });
    expect(executor.stealth_open).not.toHaveBeenCalled();
  });

  it("allows a tool call when the resolver returns true", async () => {
    const tools: ToolDefinition[] = [
      {
        name: "stealth_open",
        description: "Open tool",
        inputSchema: { type: "object" },
        permissions: ["allowed"],
      },
    ];

    const runtime = new AgentRuntime(
      {
        ...runConfigBase,
        tools,
        permissionResolver: () => true,
      },
      executor,
    );

    await (runtime as unknown as { executeTool(name: string, input: Record<string, unknown>): Promise<unknown> }).executeTool("stealth_open", { profileId: "p", url: "https://example.com" });

    expect(executor.stealth_open).toHaveBeenCalledWith({ profileId: "p", url: "https://example.com" });
  });

  it("preserves existing behavior when no resolver is supplied", async () => {
    const runtime = new AgentRuntime(runConfigBase, executor);

    await (runtime as unknown as { executeTool(name: string, input: Record<string, unknown>): Promise<unknown> }).executeTool("stealth_open", { profileId: "p", url: "https://example.com" });

    expect(executor.stealth_open).toHaveBeenCalledWith({ profileId: "p", url: "https://example.com" });
  });
});
