import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  registered: new Map<string, () => void>(),
}));

vi.mock("electron", () => ({
  globalShortcut: {
    register: vi.fn((accel: string, handler: () => void) => {
      state.registered.set(accel, handler);
      return true;
    }),
    unregister: vi.fn((accel: string) => state.registered.delete(accel)),
    unregisterAll: vi.fn(() => state.registered.clear()),
    isRegistered: vi.fn((accel: string) => state.registered.has(accel)),
  },
  app: {
    getPath: vi.fn(() => "/tmp"),
    isPackaged: false,
  },
}));

import { registerHotkeys, unregisterAllHotkeys } from "./hotkeys.js";
import type { HotkeyHandlers } from "./hotkeys.js";

describe("hotkeys", () => {
  beforeEach(() => {
    state.registered.clear();
    vi.clearAllMocks();
  });

  it("registers capture and toggle accelerators", () => {
    const handlers: HotkeyHandlers = {
      captureKey: vi.fn(),
      toggleKey: vi.fn(),
    };
    const result = registerHotkeys({ captureKey: "CmdOrCtrl+Shift+C", toggleKey: "CmdOrCtrl+Shift+X" }, handlers);
    expect(result.registered).toContain("CmdOrCtrl+Shift+C");
    expect(result.registered).toContain("CmdOrCtrl+Shift+X");
    expect(result.failed).toHaveLength(0);
    expect(state.registered.size).toBe(2);
  });

  it("calls handler when registered key is invoked", () => {
    const handlers: HotkeyHandlers = {
      captureKey: vi.fn(),
      toggleKey: vi.fn(),
    };
    registerHotkeys({ captureKey: "CmdOrCtrl+Shift+C", toggleKey: "CmdOrCtrl+Shift+X" }, handlers);
    const captureHandler = state.registered.get("CmdOrCtrl+Shift+C");
    expect(captureHandler).toBeDefined();
    captureHandler?.();
    expect(handlers.captureKey).toHaveBeenCalled();
  });

  it("unregisters all hotkeys", () => {
    const handlers: HotkeyHandlers = {
      captureKey: vi.fn(),
      toggleKey: vi.fn(),
    };
    registerHotkeys({ captureKey: "CmdOrCtrl+Shift+C", toggleKey: "CmdOrCtrl+Shift+X" }, handlers);
    expect(state.registered.size).toBe(2);
    unregisterAllHotkeys();
    expect(state.registered.size).toBe(0);
  });
});
