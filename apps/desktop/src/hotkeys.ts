/**
 * Global hotkey registration using Electron built-ins.
 *
 * node-global-key-listener is installed as an optional helper, but
 * Electron's globalShortcut is always available and sufficient for the
 * daemon feature. This module keeps the dependency chain simple and testable.
 */

import { globalShortcut } from "electron";
import { loadEnv, buildConfig } from "./env.js";

export interface HotkeyHandlers {
  captureKey: () => void;
  toggleKey: () => void;
  quickAction?: () => void;
}

export function registerHotkeys(
  accelerators: { captureKey?: string; toggleKey?: string },
  handlers: HotkeyHandlers,
): { registered: string[]; failed: string[] } {
  const cfg = buildConfig(loadEnv());
  const captureKey = accelerators.captureKey ?? cfg.hotkeyCapture;
  const toggleKey = accelerators.toggleKey ?? cfg.hotkeyToggle;

  const registered: string[] = [];
  const failed: string[] = [];

  if (!globalShortcut.isRegistered(captureKey)) {
    const ok = globalShortcut.register(captureKey, handlers.captureKey);
    ok ? registered.push(captureKey) : failed.push(captureKey);
  } else {
    registered.push(captureKey);
  }

  if (!globalShortcut.isRegistered(toggleKey)) {
    const ok = globalShortcut.register(toggleKey, handlers.toggleKey);
    ok ? registered.push(toggleKey) : failed.push(toggleKey);
  } else {
    registered.push(toggleKey);
  }

  return { registered, failed };
}

export function registerSingleHotkey(
  name: string,
  accelerator: string,
  handler: () => void,
): boolean {
  if (globalShortcut.isRegistered(accelerator)) {
    globalShortcut.unregister(accelerator);
  }
  const ok = globalShortcut.register(accelerator, handler);
  if (!ok) {
    console.warn(`[hotkeys] failed to register ${name}: ${accelerator}`);
  }
  return ok;
}

export function unregisterSingleHotkey(accelerator: string): void {
  globalShortcut.unregister(accelerator);
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll();
}
