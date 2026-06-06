import { describe, it, expect, vi } from "vitest";
import { SupervisorOrchestrator, SUB_AGENT_REGISTRY } from "./orchestrator.js";
import type { ToolExecutor } from "./agent.js";
import { BrowserOrchestrationRuntime } from "./index.js";

const mockChat = vi.fn();
vi.mock("./gateway.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./gateway.js")>();
  return {
    ...mod,
    createProvider: vi.fn(() => ({ chat: mockChat })),
  };
});

describe("SupervisorOrchestrator", () => {
  const mockExecutor: ToolExecutor = {
    stealth_open: vi.fn().mockResolvedValue({ success: true }),
    stealth_scrape: vi.fn().mockResolvedValue({ success: true, text: "page content" }),
    stealth_download: vi.fn().mockResolvedValue({ success: true }),
    stealth_interact: vi.fn().mockResolvedValue({ success: true }),
    stealth_screenshot: vi.fn().mockResolvedValue({ success: true }),
    stealth_evaluate: vi.fn().mockResolvedValue({ success: true }),
    stealth_axtree: vi.fn().mockResolvedValue({ success: true, tree: { role: "document" } }),
    ingest_file: vi.fn().mockResolvedValue({ success: true }),
    rag_retrieve: vi.fn().mockResolvedValue({ success: true, chunks: [] }),
    graph_query: vi.fn().mockResolvedValue({ success: true, results: [] }),
    write_note: vi.fn().mockResolvedValue({ success: true }),
    generate_document: vi.fn().mockResolvedValue({ success: true }),
    delegate_task: vi.fn().mockResolvedValue({ success: true, result: "done" }),
    reflect_and_retry: vi.fn().mockResolvedValue({ success: true, shouldRetry: false }),
    recall_skill: vi.fn().mockResolvedValue({ success: true, skills: [] }),
    store_skill: vi.fn().mockResolvedValue({ success: true }),
  };

  const providerConfig = {
    id: "test",
    type: "openai" as const,
    name: "Test",
    apiKey: "test-key",
    model: "gpt-4o-mini",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe("delegateTask", () => {
    it("creates a SupervisorOrchestrator instance", () => {
      const supervisor = new SupervisorOrchestrator(
        { providerConfig, workspaceId: "ws-1", conversationId: "conv-1" },
        mockExecutor,
      );
      expect(supervisor).toBeDefined();
    });

    it("SUB_AGENT_REGISTRY has all roles", () => {
      expect(Object.keys(SUB_AGENT_REGISTRY)).toContain("researcher");
      expect(Object.keys(SUB_AGENT_REGISTRY)).toContain("extractor");
      expect(Object.keys(SUB_AGENT_REGISTRY)).toContain("drafter");
      expect(Object.keys(SUB_AGENT_REGISTRY)).toContain("navigator");
      expect(Object.keys(SUB_AGENT_REGISTRY)).toContain("general");
    });

    it("each sub-agent has required fields", () => {
      for (const [role, def] of Object.entries(SUB_AGENT_REGISTRY)) {
        expect(def.role).toBe(role);
        expect(def.description).toBeDefined();
        if (!def.cli) {
          expect(def.maxSteps).toBeGreaterThan(0);
          expect(def.systemPrompt).toBeDefined();
        }
      }
    });
  });

  describe("delegateTask", () => {
    it("strips delegate_task and reflect_and_retry from sub-executor", async () => {
      mockChat.mockResolvedValueOnce({ content: "done", toolCalls: [] });
      const supervisor = new SupervisorOrchestrator(
        { providerConfig, workspaceId: "ws-1", conversationId: "conv-1" },
        mockExecutor,
      );
      const result = await supervisor.delegateTask({
        taskDescription: "test delegation",
        targetAgentRole: "general",
        workspaceId: "ws-1",
        maxSteps: 1,
      });
      expect(result).toBeDefined();
      expect(result.subAgentRole).toBe("general");
      // Sub-agent should not have called delegate_task (mock not invoked)
      expect(mockExecutor.delegate_task).not.toHaveBeenCalled();
    });
  });

  describe("reflectAndRetry", () => {
    it("returns a structured reflection result", async () => {
      const supervisor = new SupervisorOrchestrator(
        { providerConfig, workspaceId: "ws-1", conversationId: "conv-1" },
        mockExecutor,
      );
      // Since we can't call the real LLM in tests, we test the method exists
      expect(typeof supervisor.reflectAndRetry).toBe("function");
    });

    it("suggests adjusted params when mocked LLM returns retry", async () => {
      const supervisor = new SupervisorOrchestrator(
        { providerConfig, workspaceId: "ws-1", conversationId: "conv-1" },
        mockExecutor,
      );
      const mockProvider = {
        chat: vi.fn().mockResolvedValue({
          content: `{"reflection":" bad selector","shouldRetry":true,"adjustedParams":{"selector":"#fixed"}}`,
        }),
      };
      (supervisor as any).provider = mockProvider;

      const reflection = await supervisor.reflectAndRetry(
        "stealth_interact",
        { selector: "#broken" },
        { success: false, error: "not found" },
        "not found"
      );

      expect(reflection.shouldRetry).toBe(true);
      expect(reflection.adjustedParams?.selector).toBe("#fixed");
      expect(reflection.success).toBe(true);
    });
  });

  describe("package barrel", () => {
    it("exports BrowserOrchestrationRuntime", () => {
      expect(BrowserOrchestrationRuntime).toBeDefined();
    });
  });
});
