import { describe, it, expect, vi, beforeAll } from "vitest";

const state = vi.hoisted(() => ({
  registeredHandlers: new Map<string, (event: unknown, request: unknown) => Promise<unknown>>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>) => {
      state.registeredHandlers.set(channel, handler);
    }),
  },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => []);
  },
  app: {
    getPath: vi.fn(() => "/tmp"),
    isPackaged: false,
  },
  desktopCapturer: { getSources: vi.fn().mockResolvedValue([]) },
  screen: { getPrimaryDisplay: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, id: 1 })) },
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false),
  },
  Tray: class {
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    isDestroyed = () => false;
  },
  Menu: { buildFromTemplate: vi.fn(() => ({})) },
  nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => true })), createEmpty: vi.fn() },
}));

vi.mock("@carbon-agent/local-store", () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  initSkillsTable: vi.fn().mockResolvedValue(undefined),
  initMemoryTable: vi.fn().mockResolvedValue(undefined),
  initModelRolesTable: vi.fn().mockResolvedValue(undefined),
  CarbonDatabase: class {
    ensureDefaultTenantAndAdmin = vi.fn().mockResolvedValue({});
    getUserById = vi.fn().mockResolvedValue({ id: "u1", tenantId: "t1", roleId: "r1" });
    getRole = vi.fn().mockResolvedValue({ id: "r1" });
    getRoleByName = vi.fn().mockResolvedValue(undefined);
    listRoles = vi.fn().mockResolvedValue([]);
    assignPermission = vi.fn().mockResolvedValue(undefined);
  },
  hasPermission: vi.fn().mockResolvedValue(true),
  canAccessWorkspace: vi.fn().mockResolvedValue(true),
  runStmt: vi.fn(),
  ensureDb: vi.fn().mockReturnValue({}),
  dbExportSkills: vi.fn(),
  dbImportSkills: vi.fn(),
  dbSetModelRole: vi.fn(),
  dbListModelRoles: vi.fn(),
  dbDeleteModelRole: vi.fn(),
  dbGetModelRole: vi.fn(),
}));

vi.mock("./auth.js", () => ({
  verifySession: vi.fn().mockResolvedValue({ userId: "u1", tenantId: "t1", roleId: "r1" }),
  login: vi.fn(),
  logout: vi.fn(),
  hashPassword: vi.fn(),
  setAuthDb: vi.fn(),
}));

vi.mock("./approval-coordinator.js", () => ({
  createApprovalCoordinator: vi.fn(),
  getApprovalCoordinator: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
  loadPendingApprovalsFromDb: vi.fn().mockResolvedValue(undefined),
}));

import "./ipc-handlers.js";

async function invoke(type: string, payload: Record<string, unknown> = {}) {
  const handler = state.registeredHandlers.get("carbon-ipc");
  if (!handler) throw new Error("carbon-ipc handler not registered");
  return handler(
    {},
    { authToken: "token", type, ...payload },
  ) as Promise<{ type: string; data?: unknown; error?: string }>;
}

describe("screen-context IPC handlers", () => {
  beforeAll(() => {
    process.env.SCREEN_CAPTURE_PRIVACY_MODE = "false";
  });

  it("returns active window", async () => {
    const resp = await invoke("screen-context/get-active-window");
    expect(resp.type).toBe("screen-context/get-active-window.success");
    const data = resp.data as { window: { title: string; app: string } };
    expect(data.window.title).toBe(process.title);
    expect(data.window.app).toBe(process.title);
  });

  it("captures current window", async () => {
    const resp = await invoke("screen-context/capture-window", { profileId: "p1" });
    expect(resp.type).toBe("screen-context/capture-window.success");
    const data = resp.data as { window: { title: string }; image?: { base64: string } };
    expect(data.window.title).toBe(process.title);
    expect(data.image).toBeDefined();
    expect(typeof data.image?.base64).toBe("string");
  });

  it("starts and stops polling", async () => {
    const start = await invoke("screen-context/start-polling", { intervalMs: 100 });
    expect(start.type).toBe("screen-context/start-polling.success");
    const stop = await invoke("screen-context/stop-polling");
    expect(stop.type).toBe("screen-context/stop-polling.success");
  });

  it("returns daemon config", async () => {
    const resp = await invoke("daemon/get-config");
    expect(resp.type).toBe("daemon/get-config.success");
    const data = resp.data as { daemonMode: boolean; trayEnabled: boolean; hotkeyCapture: string };
    expect(typeof data.daemonMode).toBe("boolean");
    expect(typeof data.trayEnabled).toBe("boolean");
    expect(typeof data.hotkeyCapture).toBe("string");
  });
});
