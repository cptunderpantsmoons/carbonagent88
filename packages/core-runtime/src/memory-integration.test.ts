/**
 * Memory Integration — AgentRuntime ↔ AgenticMemorySystem wiring
 *
 * Verifies that AgentRuntime routes memory_store/memory_recall tool calls
 * through an injected AgenticMemorySystem when one is provided, and falls back
 * to the executor callbacks otherwise.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentRuntime, type ToolExecutor } from "./agent.js";
import { createMemorySystem, type AgenticMemorySystem } from "./memory/index.js";

const mockChat = vi.fn();
vi.mock("./gateway.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./gateway.js")>();
  return {
    ...mod,
    createProvider: vi.fn(() => ({ chat: mockChat })),
  };
});

function createMockExecutor(): ToolExecutor {
  return {
    stealth_open: vi.fn().mockResolvedValue({ success: true }),
    stealth_scrape: vi.fn().mockResolvedValue({ success: true }),
    stealth_download: vi.fn().mockResolvedValue({ success: true }),
    stealth_interact: vi.fn().mockResolvedValue({ success: true }),
    stealth_screenshot: vi.fn().mockResolvedValue({ success: true }),
    stealth_evaluate: vi.fn().mockResolvedValue({ success: true }),
    stealth_axtree: vi.fn().mockResolvedValue({ success: true }),
    graph_query: vi.fn().mockResolvedValue({ success: true }),
    generate_document: vi.fn().mockResolvedValue({ success: true }),
    recall_skill: vi.fn().mockResolvedValue({ success: true }),
    store_skill: vi.fn().mockResolvedValue({ success: true }),
    vault_read: vi.fn().mockResolvedValue({ success: true }),
    vault_write: vi.fn().mockResolvedValue({ success: true }),
    vault_link: vi.fn().mockResolvedValue({ success: true }),
    ingest_file: vi.fn().mockResolvedValue({ success: true }),
    rag_retrieve: vi.fn().mockResolvedValue({ success: true }),
    write_note: vi.fn().mockResolvedValue({ success: true }),
    delegate_task: vi.fn().mockResolvedValue({ success: true }),
    memory_recall: vi.fn().mockResolvedValue({ success: true, results: [] }),
    memory_store: vi.fn().mockResolvedValue({ success: true }),
  };
}

const providerConfig = {
  id: "test",
  type: "openai" as const,
  name: "Test",
  apiKey: "test-key",
  model: "gpt-4o-mini",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("AgentRuntime memory integration", () => {
  let executor: ToolExecutor;
  let memory: AgenticMemorySystem;

  beforeEach(() => {
    executor = createMockExecutor();
    memory = createMemorySystem({ workspaceId: "ws-test" });
    mockChat.mockReset();
  });

  it("uses injected AgenticMemorySystem for memory_store and memory_recall", async () => {
    const storeSpy = vi.spyOn(memory, "storeMemory");
    const recallSpy = vi.spyOn(memory, "recallMemory");

    mockChat
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "call-1",
            name: "memory_store",
            input: {
              key: "api-auth",
              content: "API uses OAuth",
              workspaceId: "ws-test",
              tags: ["auth"],
            },
          },
          {
            id: "call-2",
            name: "memory_recall",
            input: {
              query: "authentication",
              workspaceId: "ws-test",
              limit: 3,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Done", toolCalls: [] });

    const runtime = new AgentRuntime(
      {
        providerConfig,
        runId: "run-mem-1",
        workspaceId: "ws-test",
        conversationId: "conv-mem-1",
        memory,
      },
      executor,
    );

    for await (const _event of runtime.run("store and recall a memory")) {
      // consume generator
    }

    expect(storeSpy).toHaveBeenCalledTimes(1);
    expect(storeSpy).toHaveBeenCalledWith("api-auth", "API uses OAuth", { source: "agent" });
    expect(recallSpy).toHaveBeenCalledTimes(1);
    expect(recallSpy).toHaveBeenCalledWith("authentication", 3);

    expect(executor.memory_store).not.toHaveBeenCalled();
    expect(executor.memory_recall).not.toHaveBeenCalled();
  });

  it("falls back to executor memory tools when no memory system is provided", async () => {
    mockChat
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "call-3",
            name: "memory_store",
            input: {
              key: "fallback",
              content: "Fallback memory",
              workspaceId: "ws-test",
            },
          },
          {
            id: "call-4",
            name: "memory_recall",
            input: {
              query: "fallback",
              workspaceId: "ws-test",
              limit: 5,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Done", toolCalls: [] });

    const runtime = new AgentRuntime(
      {
        providerConfig,
        runId: "run-mem-2",
        workspaceId: "ws-test",
        conversationId: "conv-mem-2",
      },
      executor,
    );

    for await (const _event of runtime.run("fallback memory")) {
      // consume generator
    }

    expect(executor.memory_store).toHaveBeenCalledTimes(1);
    expect(executor.memory_store).toHaveBeenCalledWith({
      key: "fallback",
      content: "Fallback memory",
      workspaceId: "ws-test",
      tags: undefined,
    });
    expect(executor.memory_recall).toHaveBeenCalledTimes(1);
    expect(executor.memory_recall).toHaveBeenCalledWith({
      query: "fallback",
      workspaceId: "ws-test",
      limit: 5,
    });
  });
});
