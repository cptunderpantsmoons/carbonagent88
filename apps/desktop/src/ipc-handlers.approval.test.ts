import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";

const mockState = vi.hoisted(() => ({
  registeredHandler: undefined as ((event: unknown, request: unknown) => Promise<unknown>) | undefined,
  authToken: "valid-session-token",
}));

function withAuth(req: Record<string, unknown>): Record<string, unknown> {
  return { ...req, authToken: mockState.authToken };
}

const mockDb = {
  listProviders: vi.fn(),
  createProvider: vi.fn().mockResolvedValue(undefined),
  getProvider: vi.fn(),
  listDocuments: vi.fn(),
  listSkills: vi.fn(),
  createOrchestrationSession: vi.fn().mockResolvedValue(undefined),
  getOrchestrationSession: vi.fn(),
  listSessionEvents: vi.fn().mockResolvedValue([]),
  getSessionWorkingSet: vi.fn().mockResolvedValue(undefined),
  countRunningRuns: vi.fn().mockResolvedValue(0),
  getRun: vi.fn(),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
  ensureDefaultTenantAndAdmin: vi.fn().mockResolvedValue({ tenantId: "t1", adminUserId: "u1", adminRoleId: "r1" }),
  listPendingApprovals: vi.fn().mockResolvedValue([]),
  savePendingApproval: vi.fn().mockResolvedValue(undefined),
  deletePendingApproval: vi.fn().mockResolvedValue(undefined),
};

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((_channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>) => {
      mockState.registeredHandler = handler;
    }),
  },
  app: {
    getPath: vi.fn(() => "/tmp"),
    isPackaged: false,
  },
  Notification: class {
    static isSupported() { return false; }
    show() { /* noop */ }
  },
}));

vi.mock("@carbon-agent/local-store", () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  initSkillsTable: vi.fn().mockResolvedValue(undefined),
  initMemoryTable: vi.fn().mockResolvedValue(undefined),
  initModelRolesTable: vi.fn().mockResolvedValue(undefined),
  createRunLog: vi.fn().mockReturnValue("/tmp/run.jsonl"),
  readRunLog: vi.fn().mockReturnValue([]),
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
  runStmt: vi.fn(),
  ensureDb: vi.fn(),
  hasPermission: vi.fn().mockResolvedValue(true),
  canAccessWorkspace: vi.fn().mockResolvedValue(true),
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
    ensureDefaultTenantAndAdmin = mockDb.ensureDefaultTenantAndAdmin;
    listPendingApprovals = mockDb.listPendingApprovals;
    savePendingApproval = mockDb.savePendingApproval;
    deletePendingApproval = mockDb.deletePendingApproval;
  },
}));

vi.mock("./auth.js", () => ({
  verifySession: vi.fn().mockResolvedValue({ userId: "u1", tenantId: "t1", roleId: "r1" }),
  login: vi.fn(),
  logout: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue("x"),
  setAuthDb: vi.fn(),
}));

vi.mock("@carbon-agent/ingestion", () => ({
  scanDocumentsDir: vi.fn(() => []),
}));

vi.mock("./document-generator.js", () => ({
  generateDocument: vi.fn().mockResolvedValue({ filePath: "/tmp/out.md", finalContent: "content" }),
}));

vi.mock("./agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({ runStatus: "completed", fullResponse: "done", runId: "run-1" }),
}));

vi.mock("./session-events.js", () => ({
  emitSessionUpdate: vi.fn(),
  emitSessionWorkingSet: vi.fn(),
  emitSessionEvent: vi.fn(),
}));

vi.mock("./desktop-events.js", () => ({
  emitApprovalRequested: vi.fn(),
  emitApprovalResolved: vi.fn(),
  emitVaultChange: vi.fn(),
  emitAgentTopology: vi.fn(),
  emitWatcherAnalytics: vi.fn(),
  emitAnomalyDetected: vi.fn(),
  startProfileTelemetry: vi.fn(),
  stopProfileTelemetry: vi.fn(),
  setMainWindow: vi.fn(),
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
import { createApprovalCoordinator, getApprovalCoordinator } from "./approval-coordinator.js";

describe("ipc-handlers approvals", () => {
  beforeEach(() => {
    createApprovalCoordinator();
  });

  const sessionId = "550e8400-e29b-41d4-a716-446655440200";

  it("lists empty pending approvals", async () => {
    const response = await mockState.registeredHandler?.({}, withAuth({ type: "session/approvals", sessionId }));
    expect(response).toEqual({ type: "session/approvals.success", approvals: [] });
  });

  it("approves a pending request via IPC", async () => {
    const coordinator = getApprovalCoordinator();
    const promise = coordinator.requestApproval(sessionId, "tool", "Approve via IPC", "summary");

    const pending = coordinator.listPending(sessionId);
    expect(pending).toHaveLength(1);

    const response = await mockState.registeredHandler?.(
      {},
      withAuth({ type: "session/approve", sessionId, correlationId: pending[0]!.correlationId }),
    );
    expect(response).toEqual({ type: "session/approve.success", approved: true });

    const result = await promise;
    expect(result.decision).toBe("approved");
  });

  it("rejects a pending request via IPC", async () => {
    const coordinator = getApprovalCoordinator();
    const promise = coordinator.requestApproval(sessionId, "tool", "Reject via IPC", "summary");

    const pending = coordinator.listPending(sessionId);
    expect(pending).toHaveLength(1);

    const response = await mockState.registeredHandler?.(
      {},
      withAuth({ type: "session/reject", sessionId, correlationId: pending[0]!.correlationId, reason: "risky" }),
    );
    expect(response).toEqual({ type: "session/reject.success", rejected: true });

    const result = await promise;
    expect(result.decision).toBe("rejected");
    expect(result.reason).toBe("risky");
  });

  it("lists pending approvals", async () => {
    const coordinator = getApprovalCoordinator();
    coordinator.requestApproval(sessionId, "plan", "Listed plan", "list summary");

    const response = await mockState.registeredHandler?.({}, withAuth({ type: "session/approvals", sessionId }));
    expect(response).toMatchObject({ type: "session/approvals.success" });
    expect((response as any).approvals.length).toBeGreaterThanOrEqual(1);
  });
});
