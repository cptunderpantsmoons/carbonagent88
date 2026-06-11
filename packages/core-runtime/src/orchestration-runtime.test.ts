import { describe, expect, it, vi } from "vitest";
import { OrchestrationRuntime } from "./harness.js";
import { HarnessRegistry } from "./harness.js";
import type { Harness, HarnessExecutionResult } from "./harness.js";

class FakeHarness implements Harness {
  id = "fake";
  name = "Fake Agent";
  type = "local" as const;
  capabilities = [{ name: "test", description: "testing capability" }];
  status: "idle" | "running" | "completed" | "failed" = "idle";

  async spawn(): Promise<HarnessExecutionResult> {
    return { success: true, output: "done", artifacts: [] };
  }
}

function createOrchestrationRuntime(overrides: Partial<ConstructorParameters<typeof OrchestrationRuntime>[0]> = {}) {
  const onEvent = vi.fn();
  const saveWorkingSet = vi.fn().mockResolvedValue(undefined);
  const delegateSpecialist = vi.fn().mockResolvedValue({ success: true, result: "final output" });
  const harnessRegistry = new HarnessRegistry();
  harnessRegistry.register(new FakeHarness());

  const executor = {
    stealth_open: vi.fn().mockResolvedValue({ success: true }),
    stealth_scrape: vi.fn().mockResolvedValue({ success: true, text: "" }),
    stealth_download: vi.fn().mockResolvedValue({ success: true }),
    ingest_file: vi.fn().mockResolvedValue({ success: true, documentId: "doc-1" }),
    rag_retrieve: vi.fn().mockResolvedValue({ success: true, chunks: [] }),
  };

  const planner = vi.fn().mockResolvedValue([{ harnessId: "fake", summary: "Test plan", source: "test", query: "q", url: "about:blank" }]);
  const validator = vi.fn().mockResolvedValue({ ok: true, gaps: [] });
  const judge = vi.fn().mockResolvedValue({ complete: true, gaps: [], summary: "Sufficient" });

  return {
    onEvent,
    saveWorkingSet,
    delegateSpecialist,
    harnessRegistry,
    executor,
    planner,
    validator,
    judge,
    runtime: new OrchestrationRuntime({
      maxRounds: 3,
      harnessRegistry,
      executor,
      onEvent,
      saveWorkingSet,
      delegateSpecialist,
      planner,
      validator,
      judge,
      ...overrides,
    }),
  };
}

describe("OrchestrationRuntime", () => {
  it("passes qualityGates to judgment_requested event payload", async () => {
    const { runtime, onEvent, judge } = createOrchestrationRuntime();

    await runtime.run({
      sessionId: "550e8400-e29b-41d4-a716-446655440040",
      workspaceId: "550e8400-e29b-41d4-a716-446655440041",
      conversationId: "550e8400-e29b-41d4-a716-446655440042",
      runId: "550e8400-e29b-41d4-a716-446655440043",
      goal: "Prove quality gates reach runtime",
      supervisionMode: "watch",
      root: { kind: "outlook-thread", threadId: "t-1", threadSubject: "Test", mailbox: "test@example.com" },
      qualityGates: ["At least 2 sources required", "Numeric totals must match"],
    });

    const judgmentRequested = onEvent.mock.calls.find((call) => call[0].kind === "judgment_requested");
    expect(judgmentRequested).toBeDefined();
    expect(judgmentRequested[0].payload.qualityGates).toEqual([
      "At least 2 sources required",
      "Numeric totals must match",
    ]);

    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          qualityGates: ["At least 2 sources required", "Numeric totals must match"],
        }),
      })
    );
  });

  it("executes multiple harness plans in parallel", async () => {
    const { runtime, onEvent } = createOrchestrationRuntime({
      planner: vi.fn().mockResolvedValue([
        { harnessId: "fake", summary: "Plan A", source: "src-a", query: "a", url: "about:blank" },
        { harnessId: "fake", summary: "Plan B", source: "src-b", query: "b", url: "about:blank" },
      ]),
    });

    const result = await runtime.run({
      sessionId: "550e8400-e29b-41d4-a716-446655440050",
      workspaceId: "550e8400-e29b-41d4-a716-446655440051",
      conversationId: "550e8400-e29b-41d4-a716-446655440052",
      runId: "550e8400-e29b-41d4-a716-446655440053",
      goal: "Multi-harness evidence",
      supervisionMode: "watch",
      root: { kind: "outlook-thread", threadId: "t-2", threadSubject: "Multi", mailbox: "test@example.com" },
    });

    expect(result.status).toBe("completed");
    const completedEvents = onEvent.mock.calls.filter((call) => call[0].kind === "harness_action_completed");
    expect(completedEvents).toHaveLength(2);
  });

  it("merges failed harness results as synthetic gaps", async () => {
    class FailingHarness implements Harness {
      id = "failing";
      name = "Failing Agent";
      type = "local" as const;
      capabilities = [{ name: "fail", description: "always fails" }];
      status: "idle" | "running" | "completed" | "failed" = "idle";
      async spawn(): Promise<HarnessExecutionResult> {
        throw new Error("network timeout");
      }
    }

    const harnessRegistry = new HarnessRegistry();
    harnessRegistry.register(new FailingHarness());
    const { runtime, onEvent, saveWorkingSet } = createOrchestrationRuntime({
      harnessRegistry,
      planner: vi.fn().mockResolvedValue([{ harnessId: "failing", summary: "Failing plan", source: "src-f", query: "f", url: "about:blank" }]),
    });

    await runtime.run({
      sessionId: "550e8400-e29b-41d4-a716-446655440060",
      workspaceId: "550e8400-e29b-41d4-a716-446655440061",
      conversationId: "550e8400-e29b-41d4-a716-446655440062",
      runId: "550e8400-e29b-41d4-a716-446655440063",
      goal: "Observe failure handling",
      supervisionMode: "watch",
      root: { kind: "outlook-thread", threadId: "t-3", threadSubject: "Fail", mailbox: "test@example.com" },
    });

    const workingSetUpdate = onEvent.mock.calls.find((call) => call[0].kind === "working_set_updated");
    expect(workingSetUpdate).toBeDefined();
    const gaps = (workingSetUpdate[0].payload as { gaps?: string[] }).gaps ?? [];
    expect(gaps.some((g: string) => g.includes("network timeout"))).toBe(true);
    expect(saveWorkingSet).toHaveBeenCalled();
  });
});
