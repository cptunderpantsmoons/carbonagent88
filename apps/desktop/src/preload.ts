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
import type { DesktopAXTreeNode, DesktopTopologyEdge, DesktopTopologyNode, DesktopViewportFrame, DesktopWatcherRun } from "./desktop-events.js";

export interface CarbonAPI {
  invoke(request: IpcRequest): Promise<IpcResponse>;
  onViewportFrame?: (callback: (frame: DesktopViewportFrame) => void) => () => void;
  onAgentTopology?: (callback: (data: { runId: string; nodes: DesktopTopologyNode[]; edges: DesktopTopologyEdge[] }) => void) => () => void;
  onAXTree?: (callback: (data: { profileId: string; tree: DesktopAXTreeNode; activeNodeId?: string }) => void) => () => void;
  onWatcherAnalytics?: (callback: (data: { runs: DesktopWatcherRun[] }) => void) => () => void;
  onVaultChange?: (callback: (data: { workspaceId: string; filePath: string; content: string }) => void) => () => void;
}

function createListener<T>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const listener = (_event: unknown, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const api: CarbonAPI = {
  invoke: async (request: IpcRequest): Promise<IpcResponse> => {
    const response = await ipcRenderer.invoke("carbon-ipc", request);
    return response as IpcResponse;
  },
  onViewportFrame: createListener<DesktopViewportFrame>("carbon-event:viewport-frame"),
  onAgentTopology: createListener<{ runId: string; nodes: DesktopTopologyNode[]; edges: DesktopTopologyEdge[] }>("carbon-event:agent-topology"),
  onAXTree: createListener<{ profileId: string; tree: DesktopAXTreeNode; activeNodeId?: string }>("carbon-event:axtree"),
  onWatcherAnalytics: createListener<{ runs: DesktopWatcherRun[] }>("carbon-event:watcher-analytics"),
  onVaultChange: createListener<{ workspaceId: string; filePath: string; content: string }>("carbon-event:vault-change"),
};

contextBridge.exposeInMainWorld("carbonAPI", api);
