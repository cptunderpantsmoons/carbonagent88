/**
 * System tray daemon.
 *
 * Keeps the app alive when the main window is closed in daemon mode,
 * exposes Show/Hide/Capture/Quick Action/Quit context actions, and
 * destroys cleanly on app quit.
 */

import { Tray, Menu, type BrowserWindow, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

let trayInstance: Tray | null = null;

function ensureTrayIcon(): string {
  const appPath = app.isPackaged ? app.getAppPath() : process.cwd();
  const assetsDir = path.join(appPath, "assets");
  const iconPath = path.join(assetsDir, "tray-icon.png");
  if (fs.existsSync(iconPath)) return iconPath;
  // Fallback: create a minimal transparent 1x1 PNG so Tray does not throw.
  const fallback = path.join(assetsDir, "tray-icon.png");
  const blankPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkqAcAAIUAgUW0RjgAAAAASUVORK5CYII=",
    "base64",
  );
  try {
    fs.writeFileSync(fallback, blankPng);
  } catch {
    // If assets dir not writable (e.g. packed in asar), ignore; Tray will use blank later.
  }
  return fallback;
}

export function createTray(
  mainWindow: BrowserWindow,
  handlers: {
    onCapture?: () => void;
    onQuickAction?: () => void;
  } = {},
): Tray {
  if (trayInstance && !trayInstance.isDestroyed()) return trayInstance;

  const iconPath = ensureTrayIcon();
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  trayInstance = new Tray(icon);
  trayInstance.setToolTip("Carbon Agent");

  const buildContextMenu = () =>
    Menu.buildFromTemplate([
      {
        label: "Show",
        click: () => {
          if (mainWindow.isDestroyed()) return;
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: "Hide",
        click: () => {
          if (mainWindow.isDestroyed()) return;
          mainWindow.hide();
        },
      },
      { type: "separator" },
      {
        label: "Capture",
        click: () => handlers.onCapture?.(),
      },
      {
        label: "Quick Action",
        click: () => handlers.onQuickAction?.(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]);

  trayInstance.setContextMenu(buildContextMenu());
  trayInstance.on("double-click", () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });

  return trayInstance;
}

export function getTray(): Tray | null {
  return trayInstance;
}

export function destroyTray(): void {
  if (trayInstance && !trayInstance.isDestroyed()) {
    trayInstance.destroy();
  }
  trayInstance = null;
}
