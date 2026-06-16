import { describe, it, expect, beforeEach, vi } from "vitest";
import { EnterpriseAgentHarness } from "./enterprise-harness.js";
import { ApprovalCoordinator } from "./harness/approval-coordinator.js";
import type { EnterpriseHarnessConfig, AgentTask } from "./enterprise-harness.js";

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
  role: "planner",
  input: {},
  priority: 50,
};

describe("EnterpriseAgentHarness approvals", () => {
  let harness: EnterpriseAgentHarness;
  let coordinator: ApprovalCoordinator;

  beforeEach(() => {
    coordinator = new ApprovalCoordinator({ defaultTimeoutMs: 5000 });
    harness = new EnterpriseAgentHarness({ ...testConfig, approvalCoordinator: coordinator });
    harness.addProvider("mock", mockProvider as any);
  });

  it("executes a watch-mode plan without pausing", async () => {
    const plan = await harness.createExecutionPlan([testTask]);
    const result = await harness.executePlan({ ...plan, supervisionMode: "watch" });
    expect(result.status).toBe("completed");
  });

  it("pauses confirm-mode plans until the user approves", async () => {
    const plan = await harness.createExecutionPlan([testTask]);
    const execution = harness.executePlan({ ...plan, sessionId: "550e8400-e29b-41d4-a716-446655440100", supervisionMode: "confirm" });

    let pending: ReturnType<typeof coordinator.listPending> = [];
    for (let i = 0; i < 20; i++) {
      pending = coordinator.listPending("550e8400-e29b-41d4-a716-446655440100");
      if (pending.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(pending.length).toBe(1);
    expect(pending[0]?.title).toContain("Execute task");

    coordinator.approve(pending[0]!.correlationId);
    const result = await execution;
    expect(result.status).toBe("completed");
  });

  it("halts confirm-mode plans when the user rejects", async () => {
    const plan = await harness.createExecutionPlan([testTask]);
    const execution = harness.executePlan({ ...plan, sessionId: "550e8400-e29b-41d4-a716-446655440101", supervisionMode: "confirm" });

    let pending: ReturnType<typeof coordinator.listPending> = [];
    for (let i = 0; i < 20; i++) {
      pending = coordinator.listPending("550e8400-e29b-41d4-a716-446655440101");
      if (pending.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(pending.length).toBe(1);

    coordinator.reject(pending[0]!.correlationId, "do not run");
    const result = await execution;
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("plan approval denied");
  });
});
