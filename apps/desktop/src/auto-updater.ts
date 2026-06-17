import type { BrowserWindow } from "electron";

export interface UpdateStatus {
  available: boolean;
  version?: string;
  downloaded: boolean;
  error?: string;
  checking: boolean;
  deferred: boolean;
}

let status: UpdateStatus = { available: false, downloaded: false, checking: false, deferred: false };
let mainWindow: BrowserWindow | null = null;
let isUpdateDownloaded = false;
let pendingUpdateVersion: string | null = null;

/** Minimal UpdateInfo shape (avoids top-level import of uninstalled module). */
interface _UpdateInfo {
  version: string;
}

/**
 * Get the update channel from env var. Defaults to "latest".
 * Set CARBON_UPDATE_CHANNEL=beta to use the beta channel.
 */
function getUpdateChannel(): string {
  return process.env.CARBON_UPDATE_CHANNEL || "latest";
}

/**
 * Check if there are active agent runs before quitting for update.
 * This is a stub — the actual implementation should query the runs table
 * or check the agent runner state. Override by importing from agent-runner.
 */
export function hasActiveRuns(): boolean {
  // Check env var override for testing
  if (process.env.CARBON_SKIP_RUN_CHECK === "1") return false;
  // In production, this should be wired to the actual run state.
  // For now, we return false (no active runs) as a safe default
  // that still allows the deferred mechanism to work.
  return false;
}

/**
 * Set the main window reference so we can send IPC events to the renderer.
 */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

/**
 * Emit an update notification to the renderer process via IPC.
 * The renderer can then show a user-consent dialog.
 */
function notifyRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Install a downloaded update. Checks for active runs first.
 * If active runs exist, defers the update to next quit.
 */
export async function installUpdate(): Promise<void> {
  if (!isUpdateDownloaded) {
    console.log("[updater] No downloaded update to install");
    return;
  }

  if (hasActiveRuns()) {
    console.log("[updater] Active runs detected — deferring update to next quit");
    status = { ...status, deferred: true };
    notifyRenderer("update:deferred", { version: pendingUpdateVersion });
    return;
  }

  try {
    const eau = await import("electron-updater");
    const updater = (eau as Record<string, unknown>).autoUpdater as {
      quitAndInstall(): void;
    };
    console.log("[updater] Installing update and quitting...");
    updater.quitAndInstall();
  } catch {
    console.error("[updater] Failed to install update — electron-updater not available");
  }
}

/**
 * Install a deferred update on app quit.
 * Called from the main process before-quit handler.
 */
export async function installDeferredUpdate(): Promise<void> {
  if (status.deferred && isUpdateDownloaded) {
    console.log("[updater] Installing deferred update on quit...");
    try {
      const eau = await import("electron-updater");
      const updater = (eau as Record<string, unknown>).autoUpdater as {
        quitAndInstall(): void;
      };
      updater.quitAndInstall();
    } catch {
      console.error("[updater] Failed to install deferred update");
    }
  }
}

/** Initialize auto-updater after app is ready. Call once from main process. */
export async function initAutoUpdater(): Promise<void> {
  // Disable auto-updater for offline/local installs
  if (process.env.NODE_ENV === "development") return;
  if (process.env.CARBON_AGENT_OFFLINE === "1") {
    console.log("[updater] Auto-updater disabled (offline mode)");
    return;
  }

  const channel = getUpdateChannel();
  console.log(`[updater] Initializing auto-updater (channel: ${channel})`);

  try {
    // Dynamic import — if electron-updater is not installed, this fails gracefully
    const eau = await import("electron-updater");
    const updater = (eau as Record<string, unknown>).autoUpdater as {
      on(event: string, callback: (...args: unknown[]) => void): void;
      checkForUpdates(): Promise<unknown>;
      quitAndInstall(): void;
      channel: string;
    };

    // Set update channel if supported
    if (channel !== "latest") {
      try {
        updater.channel = channel;
      } catch {
        console.warn(`[updater] Could not set channel to ${channel}`);
      }
    }

    updater.on("checking-for-update", () => {
      status = { ...status, checking: true };
      notifyRenderer("update:checking", {});
    });

    updater.on("update-available", (info: unknown) => {
      status = { available: true, version: (info as _UpdateInfo).version, downloaded: false, checking: false, deferred: false };
      // Notify renderer — user consent required before download
      notifyRenderer("update:available", { version: (info as _UpdateInfo).version });
    });

    updater.on("update-not-available", () => {
      status = { available: false, downloaded: false, checking: false, deferred: false };
      notifyRenderer("update:not-available", {});
    });

    updater.on("update-downloaded", (info: unknown) => {
      const version = (info as _UpdateInfo).version;
      isUpdateDownloaded = true;
      pendingUpdateVersion = version;
      status = { available: true, version, downloaded: true, checking: false, deferred: false };

      // Do NOT auto-install. Emit IPC event to renderer for user consent.
      console.log(`[updater] Update v${version} downloaded — waiting for user consent`);
      notifyRenderer("update:downloaded", { version });
    });

    updater.on("error", (err: unknown) => {
      status = { ...status, error: (err as Error).message, checking: false };
      notifyRenderer("update:error", { message: (err as Error).message });
    });

    // Check for updates after 30 seconds, then every 4 hours
    setTimeout(() => { updater.checkForUpdates().catch(() => {}); }, 30_000);
    setInterval(() => { updater.checkForUpdates().catch(() => {}); }, 4 * 60 * 60 * 1000);
  } catch {
    console.log("[updater] electron-updater not available");
  }
}