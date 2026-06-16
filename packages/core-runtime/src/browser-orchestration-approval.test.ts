import { describe, expect, it, vi } from "vitest";
import { BrowserOrchestrationRuntime } from "./browser-orchestration.js";
import { ApprovalCoordinator } from "./harness/approval-coordinator.js";

function createRuntime(overrides: Partial<ConstructorParameters<typeof BrowserOrchestrationRuntime>[0]> = {}) {
  const onEvent = vi.fn();
  const saveWorkingSet = vi.fn().mockResolvedValue(undefined);
  const delegateSpecialist = vi.fn().mockResolvedValue({ success: true, result: "statement.md" });
  const browserTools = {
    stealth_open: vi.fn().mockResolvedValue({ success: true }),
    stealth_scrape: vi.fn().mockResolvedValue({ success: true, text: "Xero invoice total: 1200" }),
    stealth_download: vi.fn().mockResolvedValue({ success: true, filePath: "/tmp/report.xlsx" }),
    ingest_file: vi.fn().mockResolvedValue({ success: true, documentId: "doc-1" }),
    rag_retrieve: vi.fn().mockResolvedValue({ success: true, chunks: [] }),
  };

  return {
    onEvent,
    saveWorkingSet,
    delegateSpecialist,
    browserTools,
    runtime: new BrowserOrchestrationRuntime({
      maxRounds: 3,
      onEvent,
      saveWorkingSet,
      delegateSpecialist,
      browserTools,
      planner: vi.fn().mockResolvedValue([
        { summary: "Search Xero for invoice totals", source: "xero", query: "Acme invoice totals", url: "https://go.xero.com/AccountsReceivable/Search.aspx?q=Acme" },
      ]),
      validator: vi.fn().mockResolvedValue({ ok: false, gaps: ["Need Xero totals"] }),
      judge: vi.fn().mockResolvedValue({ complete: true, gaps: [], summary: "Evidence is sufficient" }),
      ...overrides,
    }),
  };
}

const baseInput = {
  sessionId: "550e8400-e29b-41d4-a716-446655440050",
  workspaceId: "550e8400-e29b-41d4-a716-446655440051",
  conversationId: "550e8400-e29b-41d4-a716-446655440052",
  runId: "550e8400-e29b-41d4-a716-446655440053",
  goal: "Collect evidence",
  root: { kind: "outlook-thread" as const, threadId: "t-1", threadSubject: "Evidence", mailbox: "finance@client.com" },
};

describe("BrowserOrchestrationRuntime approvals", () => {
  it("watch mode does not pause", async () => {
    const coordinator = new ApprovalCoordinator();
    const { runtime, browserTools } = createRuntime({ approvalCoordinator: coordinator });

    const result = await runtime.run({ ...baseInput, supervisionMode: "watch" });

    expect(result.status).toBe("completed");
    expect(browserTools.stealth_open).toHaveBeenCalled();
  });

  it("confirm mode pauses until approved", async () => {
    const coordinator = new ApprovalCoordinator({ defaultTimeoutMs: 5000 });
    const { runtime, browserTools, onEvent } = createRuntime({ approvalCoordinator: coordinator });

    const runPromise = runtime.run({ ...baseInput, supervisionMode: "confirm" });

    // Wait until the approval request is pending.
    let pending: ReturnType<typeof coordinator.listPending> = [];
    for (let i = 0; i < 20; i++) {
      pending = coordinator.listPending(baseInput.sessionId);
      if (pending.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(pending.length).toBe(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "judgment_requested" }));

    expect(browserTools.stealth_open).not.toHaveBeenCalled();

    coordinator.approve(pending[0]!.correlationId);
    const result = await runPromise;

    expect(result.status).toBe("completed");
    expect(browserTools.stealth_open).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "judgment_returned" }));
  });

  it("confirm mode halts when rejected", async () => {
    const coordinator = new ApprovalCoordinator({ defaultTimeoutMs: 5000 });
    const { runtime, browserTools, onEvent } = createRuntime({ approvalCoordinator: coordinator });

    const runPromise = runtime.run({ ...baseInput, supervisionMode: "confirm" });

    let pending: ReturnType<typeof coordinator.listPending> = [];
    for (let i = 0; i < 20; i++) {
      pending = coordinator.listPending(baseInput.sessionId);
      if (pending.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(pending.length).toBe(1);

    coordinator.reject(pending[0]!.correlationId, "nope");
    const result = await runPromise;

    expect(result.status).toBe("failed");
    expect(browserTools.stealth_open).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "output_rejected" }));
  });
});
