import { describe, it, expect, beforeEach, vi } from "vitest";
import { EnterpriseAgentHarness, ENTERPRISE_TOOLS } from "./enterprise-harness.js";
import type { EnterpriseHarnessConfig, EnterpriseToolExecutor, AgentTask, EnterpriseTool } from "./enterprise-harness.js";

const testConfig: EnterpriseHarnessConfig = {
  maxConcurrentAgents: 2,
  maxStepsPerAgent: 10,
  defaultTimeout: 30000,
  enableStreaming: false,
  enableCheckpoints: false,
  errorPolicy: {
    maxRetries: 0,
    retryDelay: 0,
    backoffMultiplier: 1,
    fallbackStrategies: [],
  },
};

const mockToolExecutor: EnterpriseToolExecutor = {
  execute: vi.fn().mockResolvedValue({
    success: true,
    output: { result: "ok" },
  }),
};

describe("EnterpriseAgentHarness permission enforcement", () => {
  it("filters available tools by permission resolver", () => {
    const harness = new EnterpriseAgentHarness(testConfig);
    harness.registerTool({
      name: "browser_tool",
      description: "Browser tool",
      category: "browser",
      inputSchema: {},
      permissions: ["tools:browser"],
    });
    harness.registerTool({
      name: "open_tool",
      description: "Open tool",
      category: "rag",
      inputSchema: {},
    });

    const available = harness.listTools((perm) => perm === "tools:browser");
    expect(available.map((t) => t.name)).toEqual(["browser_tool", "open_tool"]);

    const noBrowser = harness.listTools((perm) => perm !== "tools:browser");
    expect(noBrowser.map((t) => t.name)).toEqual(["open_tool"]);
  });

  it("does not execute a tool when resolver rejects it", async () => {
    const harness = new EnterpriseAgentHarness({
      ...testConfig,
      permissionResolver: () => false,
    });
    harness.addProvider("mock", {
      id: "mock",
      name: "mock",
      type: "mock",
      chat: vi.fn().mockResolvedValue({
        content: "",
        toolCalls: [{ id: "1", name: "protected_action", input: {} }],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
      stream: vi.fn(),
      testConnection: vi.fn(),
    } as any);
    harness.setToolExecutor(mockToolExecutor);
    harness.registerTool({
      name: "protected_action",
      description: "A protected action",
      category: "custom",
      inputSchema: {},
      permissions: ["skills:admin"],
    });
    harness.registerAgentDefinition({
      role: "custom",
      name: "Custom",
      description: "Custom agent",
      systemPrompt: "You are a custom agent.",
      tools: ["protected_action"],
      maxSteps: 5,
      maxTokens: 1024,
      temperature: 0.5,
    });

    const task: AgentTask = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      description: "Run protected action",
      role: "custom",
      input: {},
      priority: 50,
    };

    await harness.executePlan({
      tasks: [task],
      executionOrder: [[task.id]],
      estimatedDuration: 1000,
    });

    expect(mockToolExecutor.execute).not.toHaveBeenCalled();
  });

  it("uses permissions supplied at registration time", () => {
    const harness = new EnterpriseAgentHarness(testConfig);
    harness.registerTool({
      name: "custom_skill",
      description: "Custom skill tool",
      category: "custom",
      inputSchema: {},
      permissions: ["skills:admin"],
    } as EnterpriseTool);

    const listed = harness.listTools((perm) => perm === "skills:admin");
    expect(listed.map((t) => t.name)).toEqual(["custom_skill"]);
  });
});
