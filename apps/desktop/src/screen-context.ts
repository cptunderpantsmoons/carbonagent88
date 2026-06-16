/**
 * Screen context service.
 *
 * Optional native helpers (active-win, screenshot-desktop) are loaded lazily.
 * If they fail or run in a headless/test environment, the code falls back to
 * Electron built-ins (desktopCapturer / screen) and process title so the
 * daemon feature can still compile and pass tests.
 */

import { desktopCapturer, screen, type Rectangle } from "electron";
import { loadEnv, buildConfig } from "./env.js";
import { emitScreenContext, emitActiveWindowChanged } from "./desktop-events.js";

export interface ActiveWindowInfo {
  title: string;
  app: string;
  bounds: Rectangle & { displayId?: string };
  timestamp: string;
}

export interface ScreenContext {
  window: ActiveWindowInfo;
  image?: {
    mimeType: string;
    base64: string;
  } | null;
}

export interface ScreenContextOptions {
  /** Base64 placeholder returned when privacy mode is enabled. */
  privacyBase64?: string;
  /** Base64 blank JPEG returned when screenshot fails. */
  fallbackBase64?: string;
  /** Active window source. */
  useNativeActiveWindow?: boolean;
  /** Screenshot source. */
  useNativeScreenshot?: boolean;
}

let activeWinActiveWindow: typeof import("active-win").activeWindow | null = null;
let screenshotModule: typeof import("screenshot-desktop") | null = null;

async function tryLoadNativeActiveWin(): Promise<typeof import("active-win").activeWindow | null> {
  if (activeWinActiveWindow) return activeWinActiveWindow;
  try {
    const mod = await import("active-win");
    activeWinActiveWindow = mod.activeWindow;
    return mod.activeWindow;
  } catch {
    return null;
  }
}

async function tryLoadNativeScreenshot(): Promise<typeof import("screenshot-desktop") | null> {
  if (screenshotModule) return screenshotModule;
  try {
    const mod = await import("screenshot-desktop");
    screenshotModule = mod;
    return mod;
  } catch {
    return null;
  }
}

export function buildFallbackWindow(): ActiveWindowInfo {
  const primary = screen.getPrimaryDisplay();
  return {
    title: process.title,
    app: process.title,
    bounds: {
      x: primary.bounds.x,
      y: primary.bounds.y,
      width: primary.bounds.width,
      height: primary.bounds.height,
    },
    timestamp: new Date().toISOString(),
  };
}

export function createScreenContextService(options: ScreenContextOptions = {}) {
  const env = buildConfig(loadEnv());
  const privacyMode = env.screenCapturePrivacyMode;
  const defaultPrivacyBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkqAcAAIUAgUW0RjgAAAAASUVORK5CYII=";
  const fallbackBase64 = options.fallbackBase64 ?? defaultPrivacyBase64;
  const privacyBase64 = options.privacyBase64 ?? defaultPrivacyBase64;

  let lastWindow: ActiveWindowInfo | null = null;
  let captureLoopTimer: ReturnType<typeof setInterval> | null = null;

  async function getActiveWindow(): Promise<ActiveWindowInfo | null> {
    if (options.useNativeActiveWindow !== false) {
      const activeWin = await tryLoadNativeActiveWin();
      if (activeWin) {
        try {
          const r = await activeWin();
          if (!r) throw new Error("active-win returned no data");
          const info: ActiveWindowInfo = {
            title: r.title,
            app: r.owner.name,
            bounds: {
              x: r.bounds.x,
              y: r.bounds.y,
              width: r.bounds.width,
              height: r.bounds.height,
              displayId: String(r.id ?? ""),
            },
            timestamp: new Date().toISOString(),
          };
          lastWindow = info;
          return info;
        } catch {
          // fall through
        }
      }
    }

    const info = buildFallbackWindow();
    lastWindow = info;
    return info;
  }

  async function captureDesktopCapturer(
    sourceId?: string,
  ): Promise<{ mimeType: string; base64: string } | null> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      const source = sourceId
        ? sources.find((s) => s.id === sourceId)
        : sources.find((s) => s.id.startsWith("screen:"));
      if (!source) return null;
      const thumb = source.thumbnail;
      if (!thumb || thumb.isEmpty()) return null;
      return {
        mimeType: "image/png",
        base64: thumb.toPNG().toString("base64"),
      };
    } catch {
      return null;
    }
  }

  async function captureNativeScreenshot(
    displayId?: string | number,
  ): Promise<{ mimeType: string; base64: string } | null> {
    const screenshot = await tryLoadNativeScreenshot();
    if (!screenshot) return null;
    try {
      const buf = await screenshot.default({ screen: displayId });
      if (!buf || (Buffer.isBuffer(buf) && buf.length === 0)) return null;
      return {
        mimeType: "image/jpeg",
        base64: Buffer.from(buf).toString("base64"),
      };
    } catch {
      return null;
    }
  }

  async function captureImage(window?: ActiveWindowInfo): Promise<{ mimeType: string; base64: string } | null> {
    if (privacyMode) {
      return { mimeType: "image/png", base64: privacyBase64 };
    }

    if (options.useNativeScreenshot !== false) {
      const native = await captureNativeScreenshot(window?.bounds.displayId);
      if (native) return native;
    }

    const fallback = await captureDesktopCapturer(window?.bounds.displayId);
    if (fallback) return fallback;

    return { mimeType: "image/png", base64: fallbackBase64 };
  }

  async function captureActiveWindow(profileId?: string): Promise<ScreenContext | null> {
    const window = await getActiveWindow();
    if (!window) return null;
    const image = await captureImage();
    const payload: ScreenContext = { window, image };
    emitScreenContext(profileId ? { profileId, ...payload } : payload);
    return payload;
  }

  async function captureFullScreen(profileId?: string): Promise<ScreenContext | null> {
    const primary = screen.getPrimaryDisplay();
    const window: ActiveWindowInfo = {
      title: "Full screen capture",
      app: process.title,
      bounds: primary.bounds,
      timestamp: new Date().toISOString(),
    };
    const image = await captureImage();
    const payload: ScreenContext = { window, image };
    emitScreenContext(profileId ? { profileId, ...payload } : payload);
    return payload;
  }

  async function detectAndEmitActiveWindow(): Promise<ActiveWindowInfo | null> {
    const window = await getActiveWindow();
    if (window && (!lastWindow || lastWindow.title !== window.title)) {
      emitActiveWindowChanged({ window });
    }
    return window;
  }

  function startCaptureLoop(intervalMs = env.screenCaptureIntervalMs): void {
    stopCaptureLoop();
    if (intervalMs <= 0) return;
    // Run immediately and then repeatedly.
    void detectAndEmitActiveWindow();
    void captureActiveWindow();
    captureLoopTimer = setInterval(() => {
      void detectAndEmitActiveWindow();
      void captureActiveWindow();
    }, intervalMs);
  }

  function stopCaptureLoop(): void {
    if (captureLoopTimer) {
      clearInterval(captureLoopTimer);
      captureLoopTimer = null;
    }
  }

  return {
    getActiveWindow,
    captureActiveWindow,
    captureFullScreen,
    startCaptureLoop,
    stopCaptureLoop,
    isCapturing: () => captureLoopTimer !== null,
  };
}
