export interface UpdateStatus {
  available: boolean;
  version?: string;
  downloaded: boolean;
  error?: string;
  checking: boolean;
}

let status: UpdateStatus = { available: false, downloaded: false, checking: false };

/** Minimal UpdateInfo shape (avoids top-level import of uninstalled module). */
interface _UpdateInfo {
  version: string;
}

/** Initialize auto-updater after app is ready. Call once from main process. */
export async function initAutoUpdater(): Promise<void> {
  // Disable auto-updater for offline/local installs
  if (process.env.NODE_ENV === "development") return;
  if (process.env.CARBON_AGENT_OFFLINE === "1") {
    console.log("[updater] Auto-updater disabled (offline mode)");
    return;
  }

  try {
    // Dynamic import — if electron-updater is not installed, this fails gracefully
    const eau = await import("electron-updater");
    const updater = (eau as Record<string, unknown>).autoUpdater as {
      on(event: string, callback: (...args: unknown[]) => void): void;
      checkForUpdates(): Promise<unknown>;
      quitAndInstall(): void;
    };

    updater.on("checking-for-update", () => { status = { ...status, checking: true }; });
    updater.on("update-available", (info: unknown) => { status = { available: true, version: (info as _UpdateInfo).version, downloaded: false, checking: false }; });
    updater.on("update-not-available", () => { status = { available: false, downloaded: false, checking: false }; });
    updater.on("update-downloaded", (info: unknown) => { status = { available: true, version: (info as _UpdateInfo).version, downloaded: true, checking: false }; updater.quitAndInstall(); });
    updater.on("error", (err: unknown) => { status = { ...status, error: (err as Error).message, checking: false }; });

    setTimeout(() => { updater.checkForUpdates().catch(() => {}); }, 30_000);
    setInterval(() => { updater.checkForUpdates().catch(() => {}); }, 4 * 60 * 60 * 1000);
  } catch {
    console.log("[updater] electron-updater not available");
  }
}
