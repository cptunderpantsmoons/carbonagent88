import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const mockState = vi.hoisted(() => ({
  registeredHandler: undefined as ((event: unknown, request: unknown) => Promise<unknown>) | undefined,
  sessionCancel: vi.fn(),
  resolveSessionRun: undefined as ((value: { runStatus: "completed"; fullResponse: string; runId: string }) => void) | undefined,
}));

const mockDb = {
  listProviders: vi.fn(),
  createProvider: vi.fn().mockResolvedValue(undefined),
  getProvider: vi.fn(),
  listDocuments: vi.fn(),
  listSkills: vi.fn(),
  createOrchestrationSession: vi.fn().mockResolvedValue(undefined),
  getOrchestrationSession: vi.fn().mockResolvedValue({
    id: "550e8400-e29b-41d4-a716-446655440022",
    workspace_id: "550e8400-e29b-41d4-a716-446655440020",
    conversation_id: "550e8400-e29b-41d4-a716-446655440021",
    run_id: "550e8400-e29b-41d4-a716-446655440023",
    root_json: JSON.stringify({ kind: "outlook-thread", threadId: "t-1", threadSubject: "Month end", mailbox: "finance@client.com" }),
    supervision_mode: "watch",
    status: "draft",
    current_goal: "Collect and prepare reporting inputs",
    completion_summary: null,
    created_at: "2026-06-06T00:00:00.000Z",
    updated_at: "2026-06-06T00:00:00.000Z",
  }),
  listSessionEvents: vi.fn().mockResolvedValue([]),
  getSessionWorkingSet: vi.fn().mockResolvedValue(undefined),
  countRunningRuns: vi.fn().mockResolvedValue(0),
  getRun: vi.fn().mockResolvedValue({
    id: "550e8400-e29b-41d4-a716-446655440023",
    provider_id: "550e8400-e29b-41d4-a716-446655440024",
  }),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
};

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((_channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>) => {
      mockState.registeredHandler = handler;
    }),
  },
}));

vi.mock("@carbon-agent/local-store", () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  initSkillsTable: vi.fn().mockResolvedValue(undefined),
  initMemoryTable: vi.fn().mockResolvedValue(undefined),
  initModelRolesTable: vi.fn().mockResolvedValue(undefined),
  createRunLog: vi.fn().mockReturnValue("/tmp/run.jsonl"),
  readRunLog: vi.fn().mockReturnValue([
    { id: "e1", runId: "run-1", type: "tool_call_start", timestamp: "2026-06-06T00:00:00.000Z", payload: { tool_name: "stealth_open" } },
    { id: "e2", runId: "run-1", type: "tool_call_end", timestamp: "2026-06-06T00:00:01.000Z", payload: { tool_name: "stealth_open", output: { success: true } } },
  ]),
  getVaultDir: vi.fn((workspaceId: string) => path.join(os.tmpdir(), `vault-${workspaceId}`)),
  getDocumentsDir: vi.fn(() => path.join(os.tmpdir(), "carbon-documents")),
  dbListMemories: vi.fn().mockResolvedValue([]),
  dbDeleteMemory: vi.fn().mockResolvedValue(undefined),
  dbExportSkills: vi.fn().mockResolvedValue([]),
  dbImportSkills: vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
  dbSetModelRole: vi.fn().mockResolvedValue(undefined),
  dbListModelRoles: vi.fn().mockResolvedValue([]),
  dbDeleteModelRole: vi.fn().mockResolvedValue(undefined),
  dbGetModelRole: vi.fn().mockResolvedValue(undefined),
  CarbonDatabase: class {
    listProviders = mockDb.listProviders;
    createProvider = mockDb.createProvider;
    getProvider = mockDb.getProvider;
    listDocuments = mockDb.listDocuments;
    listSkills = mockDb.listSkills;
    getProviderWithKey = vi.fn();
    createOrchestrationSession = mockDb.createOrchestrationSession;
    getOrchestrationSession = mockDb.getOrchestrationSession;
    listSessionEvents = mockDb.listSessionEvents;
    getSessionWorkingSet = mockDb.getSessionWorkingSet;
    countRunningRuns = mockDb.countRunningRuns;
    getRun = mockDb.getRun;
    updateRunStatus = mockDb.updateRunStatus;
    updateOrchestrationSessionStatus = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock("@carbon-agent/core-runtime", () => ({
  createProvider: vi.fn(() => ({ testConnection: vi.fn().mockResolvedValue({ ok: true }) })),
}));

vi.mock("@carbon-agent/ingestion", () => ({
  scanDocumentsDir: vi.fn(() => [
    { path: "/tmp/carbon-documents/alpha.md", name: "alpha.md", sizeBytes: 11, mimeType: "text/plain" },
  ]),
}));

vi.mock("./document-generator.js", () => ({
  generateDocument: vi.fn().mockResolvedValue({ filePath: "/tmp/carbon-documents/out.md", finalContent: "content" }),
}));

const runAgentMock = vi.hoisted(() => vi.fn().mockResolvedValue({ runStatus: "completed", fullResponse: "done", runId: "run-1" }));
vi.mock("./agent-runner.js", () => ({
  runAgent: runAgentMock,
}));

vi.mock("./session-events.js", () => ({
  emitSessionUpdate: vi.fn(),
  emitSessionWorkingSet: vi.fn(),
  emitSessionEvent: vi.fn(),
}));

vi.mock("./watcher-manager.js", () => ({
  WatcherManager: class {
    sync = vi.fn();
    stop = vi.fn();
    executeNow = vi.fn().mockResolvedValue(undefined);
    initAll = vi.fn().mockResolvedValue(undefined);
  },
}));

import "./ipc-handlers.js";

describe("ipc-handlers real routes", () => {
  beforeEach(() => {
    mockState.sessionCancel.mockReset();
    mockState.resolveSessionRun = undefined;
    runAgentMock.mockReset();
    runAgentMock.mockResolvedValue({ runStatus: "completed", fullResponse: "done", runId: "run-1" });
    mockDb.listProviders.mockReset();
    mockDb.createProvider.mockReset();
    mockDb.createProvider.mockResolvedValue(undefined);
    mockDb.getProvider.mockReset();
    mockDb.updateRunStatus.mockReset();
    mockDb.updateRunStatus.mockResolvedValue(undefined);
    mockDb.countRunningRuns.mockReset();
    mockDb.countRunningRuns.mockResolvedValue(0);
    mockDb.listDocuments.mockReset();
    mockDb.listSkills.mockReset();
  });

  it("returns public camelCase provider records", async () => {
    mockDb.listProviders.mockResolvedValue([
      {
        id: "550e8400-e29b-41d4-a716-446655440010",
        type: "custom-openai",
        name: "Umans Fast",
        base_url: "https://llm.example.test/v1",
        model: "umans-fast",
        created_at: "2026-06-06T00:00:00.000Z",
        updated_at: "2026-06-06T00:00:00.000Z",
      },
    ]);

    const response = await mockState.registeredHandler?.({}, { type: "provider/list" });

    expect(response).toEqual({
      type: "provider/list.success",
      data: [{
        id: "550e8400-e29b-41d4-a716-446655440010",
        type: "custom-openai",
        name: "Umans Fast",
        baseUrl: "https://llm.example.test/v1",
        model: "umans-fast",
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z",
      }],
    });
  });

  it("returns the created provider under data", async () => {
    mockDb.getProvider.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440011",
      type: "openai",
      name: "OpenAI",
      base_url: null,
      model: "gpt-4.1",
      created_at: "2026-06-06T00:00:00.000Z",
      updated_at: "2026-06-06T00:00:00.000Z",
    });

    const response = await mockState.registeredHandler?.({}, {
      type: "provider/create",
      data: {
        type: "openai",
        name: "OpenAI",
        apiKey: "sk-test",
        model: "gpt-4.1",
      },
    });

    expect(response).toMatchObject({
      type: "provider/create.success",
      data: {
        id: "550e8400-e29b-41d4-a716-446655440011",
        type: "openai",
        name: "OpenAI",
        baseUrl: undefined,
        model: "gpt-4.1",
      },
    });
  });

  it("lists vault files from the selected workspace directory", async () => {
    const workspaceId = "550e8400-e29b-41d4-a716-446655440001";
    const vaultDir = path.join(os.tmpdir(), `vault-${workspaceId}`);
    fs.mkdirSync(path.join(vaultDir, "nested"), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, "Alpha.md"), "# Alpha");
    fs.writeFileSync(path.join(vaultDir, "nested", "Beta.md"), "# Beta");

    const response = await mockState.registeredHandler?.({}, { type: "vault/list", workspaceId });
    expect(response).toEqual({ type: "vault/list.success", files: ["Alpha.md", "nested/Beta.md"] });
  });

  it("lists documents with file metadata", async () => {
    const workspaceId = "550e8400-e29b-41d4-a716-446655440002";
    mockDb.listDocuments.mockResolvedValue([
      {
        id: "doc-1",
        workspace_id: workspaceId,
        title: "Alpha",
        content: "Alpha content",
        file_path: "/tmp/carbon-documents/alpha.md",
        mime_type: "text/plain",
        size_bytes: 11,
        created_at: "2026-06-06T00:00:00.000Z",
      },
    ]);

    const response = await mockState.registeredHandler?.({}, { type: "document/list", workspaceId });
    expect(response).toMatchObject({
      type: "document/list.success",
      data: expect.arrayContaining([
        expect.objectContaining({
          id: "doc-1",
          workspaceId,
          filePath: "/tmp/carbon-documents/alpha.md",
        }),
      ]),
    });
  });

  it("returns run events from the JSONL log", async () => {
    const response = await mockState.registeredHandler?.({}, { type: "run/events", id: "550e8400-e29b-41d4-a716-446655440003" });
    expect(response).toMatchObject({
      type: "run/events.success",
      events: expect.arrayContaining([
        expect.objectContaining({ type: "tool_call_start" }),
        expect.objectContaining({ type: "tool_call_end" }),
      ]),
    });
  });

  it("lists learned skills from the persistent store", async () => {
    const workspaceId = "550e8400-e29b-41d4-a716-446655440004";
    mockDb.listSkills.mockResolvedValue([
      {
        id: "skill-1",
        workspace_id: workspaceId,
        trigger: "inspect a portal",
        name: "portal_inspect",
        description: "Inspect a portal",
        tool_sequence_json: "[]",
        success_count: 4,
        failure_count: 1,
        pinned: 1,
        created_at: "2026-06-06T00:00:00.000Z",
        updated_at: "2026-06-06T00:00:00.000Z",
      },
    ]);

    const response = await mockState.registeredHandler?.({}, { type: "skills/list", workspaceId });
    expect(response).toMatchObject({
      type: "skills/list.success",
      data: expect.arrayContaining([
        expect.objectContaining({
          id: "skill-1",
          workspaceId,
          successCount: 4,
          failureCount: 1,
        }),
      ]),
    });
  });

  it("creates an orchestration session", async () => {
    const response = await mockState.registeredHandler?.({}, {
      type: "session/create",
      workspaceId: "550e8400-e29b-41d4-a716-446655440020",
      conversationId: "550e8400-e29b-41d4-a716-446655440021",
      runId: "550e8400-e29b-41d4-a716-446655440022",
      root: { kind: "outlook-thread", threadId: "t-1", threadSubject: "Month end", mailbox: "finance@client.com" },
      supervisionMode: "watch",
      goal: "Collect and prepare reporting inputs",
    });

    expect(response).toMatchObject({
      type: "session/create.success",
      data: expect.objectContaining({
        supervisionMode: "watch",
        currentGoal: "Collect and prepare reporting inputs",
      }),
    });
  });

  it("returns working-set and event snapshots", async () => {
    const events = await mockState.registeredHandler?.({}, { type: "session/events", id: "550e8400-e29b-41d4-a716-446655440022" });
    const workingSet = await mockState.registeredHandler?.({}, { type: "session/working-set", id: "550e8400-e29b-41d4-a716-446655440022" });
    expect(events).toMatchObject({ type: "session/events.success" });
    expect(workingSet).toMatchObject({ type: "session/working-set.success" });
  });

  it("registers a running orchestration session so it can be cancelled", async () => {
    runAgentMock.mockImplementationOnce(async (input: { onRuntime?: (runtime: { cancel(): void }) => void }) => {
      input.onRuntime?.({ cancel: mockState.sessionCancel });
      return await new Promise<{ runStatus: "completed"; fullResponse: string; runId: string }>((resolve) => {
        mockState.resolveSessionRun = resolve;
      });
    });

    const startPromise = mockState.registeredHandler?.({}, {
      type: "session/start",
      id: "550e8400-e29b-41d4-a716-446655440022",
    });

    let stats: unknown;
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
      stats = await mockState.registeredHandler?.({}, { type: "stats/list" });
      if ((stats as { activeRuns?: number } | undefined)?.activeRuns === 1) break;
    }
    expect(stats).toMatchObject({ type: "stats/list.success", activeRuns: 1 });

    await mockState.registeredHandler?.({}, {
      type: "run/cancel",
      id: "550e8400-e29b-41d4-a716-446655440023",
    });

    expect(mockState.sessionCancel).toHaveBeenCalledTimes(1);
    mockState.resolveSessionRun?.({ runStatus: "completed", fullResponse: "done", runId: "550e8400-e29b-41d4-a716-446655440023" });
    await startPromise;
  });
});
