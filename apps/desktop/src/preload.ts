/**
 * Electron Preload Script
 * 
 * Control Corridor:
 * - Owns: Safe typed IPC bridge (Zod validated on both sides)
 * - Must NOT own: Business logic, raw filesystem access
 * 
 * Exposes a minimal API to the renderer process.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { IpcRequest, IpcResponse } from "@carbon-agent/shared-schemas";

export interface CarbonAPI {
  invoke(request: IpcRequest): Promise<IpcResponse>;
  onViewportFrame?: (callback: (frame: { buffer: ArrayBufferLike; mimeType: string }) => void) => () => void;
  onAgentTopology?: (callback: (data: unknown) => void) => () => void;
  onAXTree?: (callback: (data: unknown) => void) => () => void;
  onWatcherAnalytics?: (callback: (data: unknown) => void) => () => void;
  onVaultChange?: (callback: (data: { vaultId: string; path: string; content: string }) => void) => () => void;
}

const api: CarbonAPI = {
  invoke: async (request: IpcRequest): Promise<IpcResponse> => {
    const response = await ipcRenderer.invoke("carbon-ipc", request);
    return response as IpcResponse;
  },
};

contextBridge.exposeInMainWorld("carbonAPI", api);
