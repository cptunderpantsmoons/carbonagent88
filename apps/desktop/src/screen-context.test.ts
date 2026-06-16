import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSources: vi.fn(),
  mockGetPrimaryDisplay: vi.fn(),
}));

vi.mock("electron", () => ({
  desktopCapturer: {
    getSources: state.mockGetSources,
  },
  screen: {
    getPrimaryDisplay: state.mockGetPrimaryDisplay,
  },
  app: {
    getPath: vi.fn(() => "/tmp"),
    isPackaged: false,
  },
  Tray: class {},
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => true })), createEmpty: vi.fn() },
}));

vi.mock("./desktop-events.js", () => ({
  emitScreenContext: state.mockSend,
  emitActiveWindowChanged: vi.fn(),
}));

import { createScreenContextService } from "./screen-context.js";

describe("screen-context service", () => {
  beforeEach(() => {
    state.mockSend.mockClear();
    state.mockGetSources.mockReset();
    state.mockGetPrimaryDisplay.mockReset();
    process.env.SCREEN_CAPTURE_PRIVACY_MODE = "false";
  });

  afterEach(() => {
    delete process.env.SCREEN_CAPTURE_PRIVACY_MODE;
  });

  it("returns fallback active window using process.title", async () => {
    state.mockGetPrimaryDisplay.mockReturnValue({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    const svc = createScreenContextService({ useNativeActiveWindow: false, useNativeScreenshot: false });
    const window = await svc.getActiveWindow();
    expect(window).not.toBeNull();
    expect(window?.title).toBe(process.title);
    expect(window?.app).toBe(process.title);
  });

  it("returns blurred placeholder in privacy mode", async () => {
    process.env.SCREEN_CAPTURE_PRIVACY_MODE = "true";
    state.mockGetPrimaryDisplay.mockReturnValue({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    const svc = createScreenContextService({ useNativeActiveWindow: false, useNativeScreenshot: false });
    const ctx = await svc.captureActiveWindow();
    expect(ctx?.image).toBeDefined();
    expect(ctx?.image?.mimeType).toBe("image/png");
    expect(typeof ctx?.image?.base64).toBe("string");
  });

  it("emits screen context payload on capture", async () => {
    state.mockGetPrimaryDisplay.mockReturnValue({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    state.mockGetSources.mockResolvedValue([
      {
        id: "screen:1",
        name: "Screen 1",
        thumbnail: {
          isEmpty: () => false,
          toPNG: () => Buffer.from("fake-png"),
        },
      },
    ]);

    const svc = createScreenContextService({ useNativeActiveWindow: false });
    const ctx = await svc.captureActiveWindow("profile-1");
    expect(ctx).not.toBeNull();
    expect(state.mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "profile-1",
        window: expect.objectContaining({ title: process.title }),
        image: expect.objectContaining({ mimeType: "image/png" }),
      }),
    );
  });

  it("starts and stops capture loop", async () => {
    state.mockGetPrimaryDisplay.mockReturnValue({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    state.mockGetSources.mockResolvedValue([]);
    const svc = createScreenContextService({ useNativeActiveWindow: false, useNativeScreenshot: false });
    svc.startCaptureLoop(10);
    expect(svc.isCapturing()).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    svc.stopCaptureLoop();
    expect(svc.isCapturing()).toBe(false);
  });
});
