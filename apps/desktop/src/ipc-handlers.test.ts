import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const mockState = vi.hoisted(() => ({
  registeredHandler: undefined as ((event: unknown, request: unknown) => Promise<unknown>) | undefined,
}));

const mockDb = {
  listDocuments: vi.fn(),
  listSkills: vi.fn(),
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
    listDocuments = mockDb.listDocuments;
    listSkills = mockDb.listSkills;
    getProviderWithKey = vi.fn();
    getProvider = vi.fn();
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

vi.mock("./agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({ runStatus: "completed", fullResponse: "done", runId: "run-1" }),
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
    mockDb.listDocuments.mockReset();
    mockDb.listSkills.mockReset();
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
});
