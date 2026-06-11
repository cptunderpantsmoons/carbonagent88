import { describe, expect, it, vi } from "vitest";
import { BrowserOrchestrationRuntime } from "./browser-orchestration.js";

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
      planner: vi.fn()
        .mockResolvedValueOnce([{ summary: "Search SharePoint for linked budget", source: "sharepoint", query: "Month end close budget", url: "https://tenant.sharepoint.com/_layouts/15/search.aspx?q=Month+end+close+budget" }])
        .mockResolvedValueOnce([{ summary: "Search Xero for invoice totals", source: "xero", query: "Acme invoice totals", url: "https://go.xero.com/AccountsReceivable/Search.aspx?q=Acme" }]),
      validator: vi.fn().mockResolvedValue({ ok: true, gaps: [] }),
      judge: vi.fn()
        .mockResolvedValueOnce({ complete: false, gaps: ["Need Xero totals"], summary: "Evidence is incomplete" })
        .mockResolvedValueOnce({ complete: true, gaps: [], summary: "Evidence is sufficient" }),
      ...overrides,
    }),
  };
}

describe("BrowserOrchestrationRuntime", () => {
  it("loops planner -> browser -> validator -> judge until sufficient", async () => {
    const { runtime, onEvent, saveWorkingSet } = createRuntime();

    const result = await runtime.run({
      sessionId: "550e8400-e29b-41d4-a716-446655440040",
      workspaceId: "550e8400-e29b-41d4-a716-446655440041",
      conversationId: "550e8400-e29b-41d4-a716-446655440042",
      runId: "550e8400-e29b-41d4-a716-446655440043",
      goal: "Prepare financial evidence pack",
      supervisionMode: "watch",
      root: { kind: "outlook-thread", threadId: "t-1", threadSubject: "Month end", mailbox: "finance@client.com" },
    });

    expect(result.status).toBe("completed");
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "plan_updated" }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "judgment_returned" }));
    expect(saveWorkingSet).toHaveBeenCalled();
  });

  it("routes specialist generation only after judge completion", async () => {
    const { runtime, delegateSpecialist } = createRuntime();

    await runtime.run({
      sessionId: "550e8400-e29b-41d4-a716-446655440050",
      workspaceId: "550e8400-e29b-41d4-a716-446655440051",
      conversationId: "550e8400-e29b-41d4-a716-446655440052",
      runId: "550e8400-e29b-41d4-a716-446655440053",
      goal: "Build a financial statement from validated inputs",
      supervisionMode: "watch",
      root: { kind: "outlook-thread", threadId: "t-2", threadSubject: "Statement pack", mailbox: "finance@client.com" },
    });

    expect(delegateSpecialist).toHaveBeenCalledWith(expect.objectContaining({
      role: expect.stringMatching(/claude-code|codex|general/),
      workspaceId: "550e8400-e29b-41d4-a716-446655440051",
    }));
  });

  it("fails the session when max rounds are exhausted", async () => {
    const { runtime, delegateSpecialist } = createRuntime({
      maxRounds: 2,
      judge: vi.fn().mockResolvedValue({ complete: false, gaps: ["Still missing source evidence"], summary: "Not complete" }),
    });

    const result = await runtime.run({
      sessionId: "550e8400-e29b-41d4-a716-446655440060",
      workspaceId: "550e8400-e29b-41d4-a716-446655440061",
      conversationId: "550e8400-e29b-41d4-a716-446655440062",
      runId: "550e8400-e29b-41d4-a716-446655440063",
      goal: "Collect evidence",
      supervisionMode: "watch",
      root: { kind: "outlook-thread", threadId: "t-3", threadSubject: "Evidence", mailbox: "finance@client.com" },
    });

    expect(result.status).toBe("failed");
    expect(delegateSpecialist).not.toHaveBeenCalled();
  });
});
