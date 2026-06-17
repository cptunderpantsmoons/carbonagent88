import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  registeredHandler: undefined as ((event: unknown, request: unknown) => Promise<unknown>) | undefined,
  sessionActive: true,
  documentsDir: path.join(os.tmpdir(), "carbon-documents"),
  vaultDir: path.join(os.tmpdir(), "carbon-vault"),
}));

const mockDb = {
  listProviders: vi.fn().mockResolvedValue([]),
  getProvider: vi.fn(),
  createProvider: vi.fn().mockResolvedValue(undefined),
  listProfiles: vi.fn().mockResolvedValue([]),
  getProfile: vi.fn(),
  createProfile: vi.fn().mockResolvedValue(undefined),
  listWorkspaces: vi.fn().mockResolvedValue([]),
  listWorkspacesForUser: vi.fn().mockResolvedValue([]),
  createWorkspace: vi.fn().mockResolvedValue(undefined),
  getWorkspace: vi.fn(),
  listDocuments: vi.fn().mockResolvedValue([]),
  listSkills: vi.fn().mockResolvedValue([]),
  ensureDefaultTenantAndAdmin: vi.fn().mockResolvedValue({ tenantId: "t1", adminUserId: "u1", adminRoleId: "r1" }),
  getUserById: vi.fn().mockResolvedValue({ id: "u1", tenant_id: "t1", email: "a@b.com", name: "Admin", active: 1, role_id: "r1", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }),
  getUserByEmail: vi.fn(),
  getRole: vi.fn(),
  listRoles: vi.fn().mockResolvedValue([]),
  listUsersForTenant: vi.fn().mockResolvedValue([]),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn().mockResolvedValue(undefined),
  addTenantMember: vi.fn().mockResolvedValue(undefined),
  listTenantMembers: vi.fn().mockResolvedValue([]),
  listPermissionsForRole: vi.fn().mockResolvedValue([]),
  countRunningRuns: vi.fn().mockResolvedValue(0),
  getRun: vi.fn(),
  createRun: vi.fn(),
  updateRunStatus: vi.fn(),
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
  shell: {
    openPath: vi.fn().mockResolvedValue(""),
    showItemInFolder: vi.fn(),
  },
}));

vi.mock("@carbon-agent/local-store", () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  initSkillsTable: vi.fn().mockResolvedValue(undefined),
  initMemoryTable: vi.fn().mockResolvedValue(undefined),
  initModelRolesTable: vi.fn().mockResolvedValue(undefined),
  createRunLog: vi.fn().mockReturnValue("/tmp/run.jsonl"),
  readRunLog: vi.fn().mockReturnValue([]),
  getVaultDir: vi.fn((workspaceId: string) => path.join(mockState.vaultDir, workspaceId)),
  getDocumentsDir: vi.fn(() => mockState.documentsDir),
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
    listProfiles = mockDb.listProfiles;
    getProfile = mockDb.getProfile;
    createProfile = mockDb.createProfile;
    listWorkspaces = mockDb.listWorkspaces;
    listWorkspacesForUser = mockDb.listWorkspacesForUser;
    createWorkspace = mockDb.createWorkspace;
    getWorkspace = mockDb.getWorkspace;
    listDocuments = mockDb.listDocuments;
    listSkills = mockDb.listSkills;
    ensureDefaultTenantAndAdmin = mockDb.ensureDefaultTenantAndAdmin;
    getUserById = mockDb.getUserById;
    getUserByEmail = mockDb.getUserByEmail;
    getRole = mockDb.getRole;
    listRoles = mockDb.listRoles;
    listUsersForTenant = mockDb.listUsersForTenant;
    createUser = mockDb.createUser;
    updateUser = mockDb.updateUser;
    deleteUser = mockDb.deleteUser;
    addTenantMember = mockDb.addTenantMember;
    listTenantMembers = mockDb.listTenantMembers;
    listPermissionsForRole = mockDb.listPermissionsForRole;
    countRunningRuns = mockDb.countRunningRuns;
    getRun = mockDb.getRun;
    createRun = mockDb.createRun;
    updateRunStatus = mockDb.updateRunStatus;
  },
}));

vi.mock("@carbon-agent/core-runtime", () => ({
  createProvider: vi.fn(() => ({ testConnection: vi.fn().mockResolvedValue({ ok: true }) })),
  ApprovalCoordinator: class {
    requestApproval = vi.fn().mockResolvedValue({ decision: "approved" });
    approve = vi.fn().mockReturnValue(true);
    reject = vi.fn().mockReturnValue(true);
    listPending = vi.fn().mockReturnValue([]);
    loadFromDb = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock("@carbon-agent/ingestion", () => ({
  scanDocumentsDir: vi.fn(() => []),
}));

vi.mock("./auth.js", () => ({
  verifySession: vi.fn(async (token: string) => {
    if (!mockState.sessionActive || !token) return null;
    return { userId: "u1", tenantId: "t1", roleId: "r1" };
  }),
  login: vi.fn(),
  logout: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue("x"),
  setAuthDb: vi.fn(),
}));

vi.mock("./document-generator.js", () => ({
  generateDocument: vi.fn().mockResolvedValue({ filePath: "/tmp/out.md", finalContent: "content" }),
}));

vi.mock("./agent-runner.js", () => ({
  runAgent: vi.fn().mockResolvedValue({ runStatus: "completed", fullResponse: "done", runId: "r1" }),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withAuth(req: Record<string, unknown>): Record<string, unknown> {
  return { ...req, authToken: "valid-session-token" };
}

// ---------------------------------------------------------------------------

describe("ipc-handlers security — resolveVaultPath", () => {
  beforeEach(() => {
    mockState.sessionActive = true;
    vi.clearAllMocks();
  });

  it("allows normal relative path within vault", async () => {
    const workspaceId = "ws-vault-test-1";
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "vault/read",
      workspaceId,
      filePath: "notes/test.md",
    }));
    expect((response as { type: string }).type).toBe("vault/read.success");
  });

  it("rejects ../../etc/passwd path traversal", async () => {
    const workspaceId = "ws-vault-test-2";
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "vault/read",
      workspaceId,
      filePath: "../../etc/passwd",
    }));
    expect(response).toMatchObject({
      type: "error",
      code: expect.any(String),
    });
  });

  it("rejects absolute path outside vault", async () => {
    const workspaceId = "ws-vault-test-3";
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "vault/read",
      workspaceId,
      filePath: "/etc/shadow",
    }));
    expect(response).toMatchObject({
      type: "error",
      code: expect.any(String),
    });
  });

  it("rejects vault/write with path traversal", async () => {
    const workspaceId = "ws-vault-test-4";
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "vault/write",
      workspaceId,
      filePath: "../../etc/malicious",
      content: "evil",
    }));
    expect(response).toMatchObject({
      type: "error",
      code: expect.any(String),
    });
  });
});

// ---------------------------------------------------------------------------

describe("ipc-handlers security — document/open path validation", () => {
  beforeEach(() => {
    mockState.sessionActive = true;
    vi.clearAllMocks();
  });

  it("allows document/open with valid path inside documents dir", async () => {
    const { shell } = await import("electron");
    vi.mocked(shell.openPath).mockResolvedValue("");
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "document/open",
      filePath: path.join(mockState.documentsDir, "report.md"),
    }));
    expect((response as { type: string }).type).toBe("document/open.success");
  });

  it("rejects document/open with path outside documents dir (PATH_TRAVERSAL)", async () => {
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "document/open",
      filePath: "/etc/passwd",
    }));
    expect(response).toEqual({
      type: "error",
      error: "Access denied: file outside allowed directory",
      code: "PATH_TRAVERSAL",
    });
  });

  it("rejects document/open with ../../ traversal", async () => {
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "document/open",
      filePath: path.join(mockState.documentsDir, "../../etc/shadow"),
    }));
    expect(response).toEqual({
      type: "error",
      error: "Access denied: file outside allowed directory",
      code: "PATH_TRAVERSAL",
    });
  });
});

// ---------------------------------------------------------------------------

describe("ipc-handlers security — document/reveal path validation", () => {
  beforeEach(() => {
    mockState.sessionActive = true;
    vi.clearAllMocks();
  });

  it("allows document/reveal with valid path inside documents dir", async () => {
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "document/reveal",
      filePath: path.join(mockState.documentsDir, "report.pdf"),
    }));
    expect((response as { type: string }).type).toBe("document/reveal.success");
  });

  it("rejects document/reveal with path outside documents dir (PATH_TRAVERSAL)", async () => {
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "document/reveal",
      filePath: "/etc/shadow",
    }));
    expect(response).toEqual({
      type: "error",
      error: "Access denied: file outside allowed directory",
      code: "PATH_TRAVERSAL",
    });
  });
});

// ---------------------------------------------------------------------------

describe("ipc-handlers security — stampOwnership table validation", () => {
  // stampOwnership is an internal function that interpolates table names into SQL.
  // We test it indirectly by triggering a code path that calls it (provider/create)
  // and verifying the table name is used correctly.
  beforeEach(() => {
    mockState.sessionActive = true;
    vi.clearAllMocks();
  });

  it("provider/create stamps ownership on ai_providers table", async () => {
    mockDb.getProvider.mockResolvedValue({
      id: "prov-test-1",
      type: "anthropic",
      name: "Test",
      base_url: null,
      model: "claude-sonnet-4",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "provider/create",
      data: {
        type: "anthropic",
        name: "Test",
        apiKey: "sk-test",
        model: "claude-sonnet-4",
      },
    }));

    expect((response as { type: string }).type).toBe("provider/create.success");
    // runStmt should have been called with a valid table name
    const { runStmt } = await import("@carbon-agent/local-store");
    expect(runStmt).toHaveBeenCalled();
    const call = vi.mocked(runStmt).mock.calls[0];
    expect(call?.[1]).toContain("ai_providers");
  });
});

// ---------------------------------------------------------------------------

describe("ipc-handlers security — admin/tenant/members/remove", () => {
  beforeEach(() => {
    mockState.sessionActive = true;
    vi.clearAllMocks();
  });

  it("removes a tenant member by deleting the user", async () => {
    mockDb.deleteUser.mockResolvedValue(undefined);
    const response = await mockState.registeredHandler?.({}, withAuth({
      type: "admin/tenant/members/remove",
      tenantId: "t1",
      userId: "user-to-remove",
    }));
    expect((response as { type: string }).type).toBe("admin/tenant/members/remove.success");
    expect(mockDb.deleteUser).toHaveBeenCalledWith("user-to-remove");
  });
});

// ---------------------------------------------------------------------------

describe("ipc-handlers security — unauthorized access", () => {
  beforeEach(() => {
    mockState.sessionActive = true;
    vi.clearAllMocks();
  });

  it("rejects protected routes without authToken", async () => {
    const response = await mockState.registeredHandler?.({}, {
      type: "workspace/list",
    });
    expect(response).toEqual({ type: "error", error: "Unauthorized", code: "UNAUTHORIZED" });
  });

  it("rejects with invalid authToken", async () => {
    mockState.sessionActive = false;
    const response = await mockState.registeredHandler?.({}, {
      type: "workspace/list",
      authToken: "invalid-token",
    });
    expect(response).toEqual({ type: "error", error: "Unauthorized", code: "UNAUTHORIZED" });
  });
});