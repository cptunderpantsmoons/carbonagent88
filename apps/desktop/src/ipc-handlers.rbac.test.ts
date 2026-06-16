import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";

const mockState = vi.hoisted(() => ({
  registeredHandler: undefined as ((event: unknown, request: unknown) => Promise<unknown>) | undefined,
  sessionActive: true,
}));

const mockDb = {
  listProviders: vi.fn(),
  getProvider: vi.fn(),
  createProvider: vi.fn().mockResolvedValue(undefined),
  listProfiles: vi.fn(),
  getProfile: vi.fn(),
  createProfile: vi.fn().mockResolvedValue(undefined),
  listWorkspaces: vi.fn(),
  listWorkspacesForUser: vi.fn(),
  createWorkspace: vi.fn().mockResolvedValue(undefined),
  getWorkspace: vi.fn(),
  ensureDefaultTenantAndAdmin: vi.fn().mockResolvedValue({ tenantId: "t1", adminUserId: "u1", adminRoleId: "r1" }),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn().mockResolvedValue({ id: "u1", tenant_id: "t1", email: "a@b.com", name: "Admin", active: 1, role_id: "r1", created_at: "2026-06-06T00:00:00.000Z", updated_at: "2026-06-06T00:00:00.000Z" }),
  getRole: vi.fn(),
  listPermissionsForRole: vi.fn(),
};

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((_channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>) => {
      mockState.registeredHandler = handler;
    }),
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
    listProfiles = mockDb.listProfiles;
    getProfile = mockDb.getProfile;
    createProfile = mockDb.createProfile;
    listWorkspaces = mockDb.listWorkspaces;
    listWorkspacesForUser = mockDb.listWorkspacesForUser;
    createWorkspace = mockDb.createWorkspace;
    getWorkspace = mockDb.getWorkspace;
    ensureDefaultTenantAndAdmin = mockDb.ensureDefaultTenantAndAdmin;
    getUserById = mockDb.getUserById;
    getUserByEmail = mockDb.getUserByEmail;
    getRole = mockDb.getRole;
    listPermissionsForRole = mockDb.listPermissionsForRole;
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

vi.mock("./auth.js", () => ({
  verifySession: vi.fn(async (token: string) => {
    if (!mockState.sessionActive || !token) return null;
    return { userId: "u1", tenantId: "t1", roleId: "r1" };
  }),
  login: vi.fn().mockResolvedValue({ token: "login-token", session: { userId: "u1", tenantId: "t1", roleId: "r1" } }),
  logout: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue("x"),
  setAuthDb: vi.fn(),
}));

import "./ipc-handlers.js";

describe("ipc-handlers rbac gating", () => {
  beforeEach(() => {
    mockState.sessionActive = true;
  });

  it("rejects protected requests without authToken", async () => {
    const response = await mockState.registeredHandler?.({}, { type: "workspace/list" });
    expect(response).toEqual({ type: "error", error: "Unauthorized", code: "UNAUTHORIZED" });
  });

  it("allows auth/login without a token", async () => {
    const response = await mockState.registeredHandler?.({}, { type: "auth/login", email: "a@b.com", password: "secret" });
    expect((response as { type: string })?.type).not.toBe("error");
    if (response && typeof response === "object" && "type" in response) {
      expect((response as { type: string }).type).not.toBe("error");
    }
  });

  it("allows authenticated workspace requests", async () => {
    mockDb.listWorkspacesForUser.mockResolvedValue([{ id: "ws-1", name: "Only Mine", tenant_id: "t1" }]);
    const response = await mockState.registeredHandler?.({}, { type: "workspace/list", authToken: "valid" });
    expect(response).toEqual({ type: "workspace/list.success", data: [{ id: "ws-1", name: "Only Mine", tenant_id: "t1" }] });
  });

  it("denies memory, skills, and graph access when user is not a workspace member", async () => {
    const { canAccessWorkspace } = await import("@carbon-agent/local-store");
    vi.mocked(canAccessWorkspace).mockResolvedValue(false);

    const memoryResponse = await mockState.registeredHandler?.({}, {
      type: "memory/list",
      authToken: "valid",
      workspaceId: "00000000-0000-0000-0000-000000000002",
    });
    expect(memoryResponse).toEqual({ type: "error", error: "Forbidden", code: "FORBIDDEN" });

    const skillsResponse = await mockState.registeredHandler?.({}, {
      type: "skills/list",
      authToken: "valid",
      workspaceId: "00000000-0000-0000-0000-000000000002",
    });
    expect(skillsResponse).toEqual({ type: "error", error: "Forbidden", code: "FORBIDDEN" });

    const graphResponse = await mockState.registeredHandler?.({}, {
      type: "graph/list",
      authToken: "valid",
      workspaceId: "00000000-0000-0000-0000-000000000002",
    });
    expect(graphResponse).toEqual({ type: "error", error: "Forbidden", code: "FORBIDDEN" });
  });

  it("denies inactive session", async () => {
    mockState.sessionActive = false;
    const response = await mockState.registeredHandler?.({}, { type: "provider/list", authToken: "invalid" });
    expect(response).toEqual({ type: "error", error: "Unauthorized", code: "UNAUTHORIZED" });
  });
});
