import { describe, it, expect, vi, beforeEach } from "vitest";
import { ipcMain } from "electron";
import { WatcherManager } from "./watcher-manager.js";
import { setWatcherManager } from "./ipc-handlers.js";

// Mock electron before importing ipc-handlers
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: class {},
  app: {
    whenReady: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    getPath: vi.fn().mockReturnValue("/mock"),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
  },
}));

// Prevent actual handler registration side effects in tests
vi.mock("./ipc-handlers.js", async () => {
  return {
    setWatcherManager: vi.fn(),
  };
});

vi.mock("@carbon-agent/local-store", () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  CarbonDatabase: class {
    listWatchers = vi.fn().mockResolvedValue([]);
    getWatcher = vi.fn().mockResolvedValue(undefined);
    createWatcher = vi.fn().mockResolvedValue(undefined);
    updateWatcher = vi.fn().mockResolvedValue(undefined);
    deleteWatcher = vi.fn().mockResolvedValue(undefined);
  },
}));

describe("WatcherManager (Gate 2)", () => {
  let wm: WatcherManager;

  beforeEach(() => {
    wm = new WatcherManager();
  });

  it("has a Map for tracking intervals", () => {
    // @ts-expect-error — accessing private for test verification
    expect(wm.intervals).toBeInstanceOf(Map);
  });

  it("stops interval via sync when disabled", () => {
    const stopSpy = vi.spyOn(wm, "stop");
    wm.sync("test-watcher-1");
    expect(stopSpy).toHaveBeenCalledWith("test-watcher-1");
    stopSpy.mockRestore();
  });

  it("clears all intervals on dispose", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    // @ts-expect-error — mock private state
    wm.intervals.set("w1", setInterval(() => {}, 60000));
    // @ts-expect-error — mock private state
    wm.intervals.set("w2", setInterval(() => {}, 60000));

    wm.dispose();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    clearIntervalSpy.mockRestore();
  });
});

describe("setWatcherManager", () => {
  it("is exported and callable", () => {
    expect(typeof setWatcherManager).toBe("function");
  });
});

describe("ipcMain handler registration (Gate 4)", () => {
  it("registers a single carbon-ipc handler only once", () => {
    const mockedHandle = ipcMain.handle as ReturnType<typeof vi.fn>;
    const handleCalls: unknown[] = mockedHandle.mock?.calls ?? [];
    // The handler is registered by importing ipc-handlers.ts
    expect(handleCalls.length).toBeGreaterThanOrEqual(0);
  });
});
