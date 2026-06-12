import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WatcherManager } from "./watcher-manager.js";
import { setWatcherManager } from "./ipc-handlers.js";
import { setMainWindow } from "./desktop-events.js";
import { initAutoUpdater } from "./auto-updater.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({ width: 1400, height: 900, webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  setMainWindow(mainWindow);
  mainWindow.on("closed", () => {
    if (mainWindow === null) return;
    mainWindow = null;
    setMainWindow(null);
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  const wm = new WatcherManager();
  setWatcherManager(wm);
  await wm.initAll();
  await initAutoUpdater();
});

app.on("before-quit", async () => {
  const { closeAllBrowsers } = await import("@carbon-agent/cloak-bridge");
  await closeAllBrowsers();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
