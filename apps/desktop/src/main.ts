import { app, BrowserWindow, powerMonitor } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WatcherManager } from "./watcher-manager.js";
import { setWatcherManager } from "./ipc-handlers.js";
import { setMainWindow } from "./desktop-events.js";
import { initAutoUpdater } from "./auto-updater.js";
import { createTray, destroyTray } from "./tray.js";
import { registerHotkeys, unregisterAllHotkeys } from "./hotkeys.js";
import { createScreenContextService } from "./screen-context.js";
import { loadEnv, buildConfig } from "./env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({ width: 1400, height: 900, webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  setMainWindow(mainWindow);
  mainWindow.on("closed", () => {
    if (mainWindow === null) return;
    mainWindow = null;
    setMainWindow(null);
  });
  mainWindow.on("close", (event) => {
    const env = buildConfig(loadEnv());
    if (env.daemonMode && !isQuitting && mainWindow) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  const env = buildConfig(loadEnv());
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  const wm = new WatcherManager();
  setWatcherManager(wm);
  await wm.initAll();
  await initAutoUpdater();

  if (env.trayEnabled && mainWindow) {
    const screenCtx = createScreenContextService();
    createTray(mainWindow, {
      onCapture: () => { void screenCtx.captureActiveWindow(); },
      onQuickAction: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    });
  }

  if (env.daemonMode) {
    const screenCtx = createScreenContextService();
    const hotkeys = registerHotkeys(
      { captureKey: env.hotkeyCapture, toggleKey: env.hotkeyToggle },
      {
        captureKey: () => { void screenCtx.captureActiveWindow(); },
        toggleKey: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isVisible()) {
              mainWindow.hide();
            } else {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        },
      },
    );
    if (hotkeys.failed.length > 0) {
      console.warn("[main] failed to register hotkeys", hotkeys.failed);
    }

    if (env.screenCaptureIntervalMs > 0) {
      screenCtx.startCaptureLoop(env.screenCaptureIntervalMs);
    }

    // Idle detection: stop captures when user is inactive for more than 2 minutes.
    let idleTimer: ReturnType<typeof setInterval> | null = null;
    const IDLE_THRESHOLD_MS = 120_000;
    if (env.screenCaptureIntervalMs > 0 && typeof powerMonitor?.getSystemIdleTime === "function") {
      idleTimer = setInterval(() => {
        try {
          const idleMs = powerMonitor.getSystemIdleTime() * 1000;
          if (idleMs > IDLE_THRESHOLD_MS && screenCtx.isCapturing()) {
            screenCtx.stopCaptureLoop();
          } else if (idleMs <= IDLE_THRESHOLD_MS && !screenCtx.isCapturing()) {
            screenCtx.startCaptureLoop(env.screenCaptureIntervalMs);
          }
        } catch {
          // Ignore platforms where idle querying is unavailable.
        }
      }, Math.min(env.screenCaptureIntervalMs, IDLE_THRESHOLD_MS));
    }

    app.on("before-quit", () => {
      if (idleTimer) clearInterval(idleTimer);
    });
  }
});

app.on("before-quit", async () => {
  isQuitting = true;
  unregisterAllHotkeys();
  destroyTray();
  const { closeAllBrowsers } = await import("@carbon-agent/cloak-bridge");
  await closeAllBrowsers();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
