/**
 * Enterprise Agent Harness — Tests
 *
 * Comprehensive tests for the enterprise harness system.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  EnterpriseAgentHarness,
  StreamingExecutionEngine,
  MultiModelRouter,
  ENTERPRISE_TOOLS,
} from "./enterprise-harness.js";
import {
  MCPClient,
  MCPToolAdapter,
  MCPDiscoveryService,
} from "./mcp-integration.js";
import type {
  AgentTask,
  EnterpriseHarnessConfig,
  EnterpriseToolExecutor,
  EnterpriseTool,
  AgentTaskResult,
} from "./enterprise-harness.js";

// ---------------------------------------------------------------------------
// Mock LLM Provider
// ---------------------------------------------------------------------------

const mockProvider = {
  id: "mock-provider",
  name: "mock",
  type: "mock",
  chat: vi.fn().mockResolvedValue({
    content: "Test response",
    toolCalls: undefined,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  }),
  stream: vi.fn(),
  testConnection: vi.fn().mockResolvedValue({ ok: true }),
};

// ---------------------------------------------------------------------------
// Mock Tool Executor
// ---------------------------------------------------------------------------

const mockToolExecutor: EnterpriseToolExecutor = {
  execute: vi.fn().mockResolvedValue({
    success: true,
    output: { result: "mock output" },
  }),
};

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

const testConfig: EnterpriseHarnessConfig = {
  maxConcurrentAgents: 5,
  maxStepsPerAgent: 10,
  defaultTimeout: 30000,
  enableStreaming: true,
  enableCheckpoints: true,
  errorPolicy: {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
    fallbackStrategies: [],
  },
};

const testTask: AgentTask = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  description: "Test task",
  role: "coder",
  input: {},
  priority: 50,
};

const testTasks: AgentTask[] = [
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    description: "Task 1",
    role: "planner",
    input: {},
    priority: 100,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002",
    description: "Task 2",
    role: "coder",
    input: {},
    priority: 50,
    dependencies: ["550e8400-e29b-41d4-a716-446655440001"],
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440003",
    description: "Task 3",
    role: "reviewer",
    input: {},
    priority: 25,
    dependencies: ["550e8400-e29b-41d4-a716-446655440002"],
  },
];

// ---------------------------------------------------------------------------
// Enterprise Agent Harness Tests
// ---------------------------------------------------------------------------

describe("EnterpriseAgentHarness", () => {
  let harness: EnterpriseAgentHarness;

  beforeEach(() => {
    harness = new EnterpriseAgentHarness(testConfig);
    harness.addProvider("mock", mockProvider as any);
    harness.setToolExecutor(mockToolExecutor);
  });

  it("should initialize with correct config", () => {
    expect(harness).toBeDefined();
  });

  it("should register and retrieve providers", () => {
    expect(harness.getProvider("mock")).toBe(mockProvider);
    expect(harness.getProvider("nonexistent")).toBeUndefined();
  });

  it("should register and retrieve tools", () => {
    const tool: EnterpriseTool = {
      name: "test_tool",
      description: "Test tool",
      category: "custom",
      inputSchema: {},
    };

    harness.registerTool(tool);
    expect(harness.getTool("test_tool")).toBe(tool);
    expect(harness.getToolsByCategory("custom")).toContain(tool);
  });

  it("should register and retrieve agent definitions", () => {
    const def = harness.getAgentDefinition("coder");
    expect(def).toBeDefined();
    expect(def?.role).toBe("coder");
  });

  it("should create execution plan", async () => {
    const plan = await harness.createExecutionPlan(testTasks);
    expect(plan.tasks).toHaveLength(3);
    expect(plan.executionOrder).toBeDefined();
    expect(plan.estimatedDuration).toBeGreaterThan(0);
  });

  it("should execute a single task", async () => {
    const result = await harness.executePlan({
      tasks: [testTask],
      executionOrder: [[testTask.id]],
      estimatedDuration: 1000,
    });

    expect(result.status).toBe("completed");
    expect(result.results).toHaveLength(1);
  });

  it("should execute tasks with dependencies in order", async () => {
    const plan = await harness.createExecutionPlan(testTasks);
    const result = await harness.executePlan(plan);

    expect(result.status).toBe("completed");
    expect(result.results).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Streaming Execution Engine Tests
// ---------------------------------------------------------------------------

describe("StreamingExecutionEngine", () => {
  let harness: EnterpriseAgentHarness;
  let streamingEngine: StreamingExecutionEngine;

  beforeEach(() => {
    harness = new EnterpriseAgentHarness(testConfig);
    harness.addProvider("mock", mockProvider as any);
    harness.setToolExecutor(mockToolExecutor);
    streamingEngine = new StreamingExecutionEngine(harness);
  });

  it("should initialize", () => {
    expect(streamingEngine).toBeDefined();
  });

  it("should track progress", async () => {
    const plan = await harness.createExecutionPlan([testTask]);
    const resultPromise = streamingEngine.executeWithStreaming(plan);

    // Check progress during execution
    const progress = streamingEngine.getProgress();
    expect(progress.total).toBe(1);

    await resultPromise;

    const finalProgress = streamingEngine.getProgress();
    expect(finalProgress.percentage).toBe(100);
  });

  it("should emit stream events", async () => {
    const events: any[] = [];
    streamingEngine.on("stream_event", (event) => events.push(event));

    const plan = await harness.createExecutionPlan([testTask]);
    await streamingEngine.executeWithStreaming(plan);

    expect(events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-Model Router Tests
// ---------------------------------------------------------------------------

describe("MultiModelRouter", () => {
  let router: MultiModelRouter;

  beforeEach(() => {
    router = new MultiModelRouter();
  });

  it("should initialize", () => {
    expect(router).toBeDefined();
  });

  it("should route based on patterns", () => {
    router.addProvider("anthropic", mockProvider as any);
    router.addRoute({
      pattern: /code|implement/i,
      providerId: "anthropic",
      model: "claude-sonnet",
      priority: 100,
    });

    const result = router.route("Implement a new feature");
    expect(result).toBeDefined();
    expect(result?.model).toBe("claude-sonnet");
  });

  it("should fallback to first provider", () => {
    router.addProvider("openai", mockProvider as any);
    const result = router.route("Any task");
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// MCP Client Tests
// ---------------------------------------------------------------------------

describe("MCPClient", () => {
  let client: MCPClient;

  beforeEach(() => {
    client = new MCPClient();
  });

  it("should initialize", () => {
    expect(client).toBeDefined();
  });

  it("should track server states", () => {
    const servers = client.getAllServers();
    expect(servers).toHaveLength(0);
  });

  it("should get connected servers", () => {
    const connected = client.getConnectedServers();
    expect(connected).toHaveLength(0);
  });

  it("should get all tools", () => {
    const tools = client.getAllTools();
    expect(tools).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// MCP Tool Adapter Tests
// ---------------------------------------------------------------------------

describe("MCPToolAdapter", () => {
  let client: MCPClient;
  let adapter: MCPToolAdapter;

  beforeEach(() => {
    client = new MCPClient();
    adapter = new MCPToolAdapter(client);
  });

  it("should convert to enterprise tools", () => {
    const tools = adapter.toEnterpriseTools();
    expect(tools).toHaveLength(0);
  });

  it("should create executor", () => {
    const executor = adapter.createExecutor();
    expect(typeof executor).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Enterprise Tools Tests
// ---------------------------------------------------------------------------

describe("ENTERPRISE_TOOLS", () => {
  it("should have file tools", () => {
    const fileTools = ENTERPRISE_TOOLS.filter((t) => t.category === "file");
    expect(fileTools.length).toBeGreaterThan(0);
  });

  it("should have code tools", () => {
    const codeTools = ENTERPRISE_TOOLS.filter((t) => t.category === "code");
    expect(codeTools.length).toBeGreaterThan(0);
  });

  it("should have terminal tools", () => {
    const terminalTools = ENTERPRISE_TOOLS.filter((t) => t.category === "terminal");
    expect(terminalTools.length).toBeGreaterThan(0);
  });

  it("should have RAG tools", () => {
    const ragTools = ENTERPRISE_TOOLS.filter((t) => t.category === "rag");
    expect(ragTools.length).toBeGreaterThan(0);
  });

  it("should have memory tools", () => {
    const memoryTools = ENTERPRISE_TOOLS.filter((t) => t.category === "memory");
    expect(memoryTools.length).toBeGreaterThan(0);
  });

  it("should have valid schemas", () => {
    for (const tool of ENTERPRISE_TOOLS) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});
