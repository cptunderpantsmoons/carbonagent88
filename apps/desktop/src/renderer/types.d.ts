import type { SessionEvent } from "@carbon-agent/shared-schemas";

export {};

/* Structural: used by renderer views to narrow IPC responses without breaking DOM code */
export type IpcResponse = {
  type: string;
  error?: string;
  code?: string;
  data?: unknown;
  jobs?: unknown[];
  events?: unknown[];
  status?: string;
  id?: string;
  [key: string]: unknown;
};

declare global {
  interface Window {
    carbonAPI: {
      invoke(request: Record<string, unknown>): Promise<IpcResponse>;
      onScreenContext?: (callback: (data: { profileId?: string; window: { title: string; app: string; bounds: { x: number; y: number; width: number; height: number }; timestamp: string }; image?: { mimeType: string; base64: string } }) => void) => () => void;
      onActiveWindowChanged?: (callback: (data: { window: { title: string; app: string; bounds: { x: number; y: number; width: number; height: number }; timestamp: string } }) => void) => () => void;
      onViewportFrame?: (callback: (frame: { profileId: string; mimeType: string; base64: string }) => void) => () => void;
      onAgentTopology?: (callback: (data: { runId: string; nodes: Array<{ id: string; label: string; status: string; x: number; y: number }>; edges: Array<{ from: string; to: string }> }) => void) => () => void;
      onAXTree?: (callback: (data: { profileId: string; tree: { role: string; name?: string; value?: string; axNodeId: string; children?: unknown[] }; activeNodeId?: string }) => void) => () => void;
      onWatcherAnalytics?: (callback: (data: { runs: Array<{ watcherId: string; watcherName: string; startedAt: string; completedAt?: string; success: boolean }> }) => void) => () => void;
      onVaultChange?: (callback: (data: { workspaceId: string; filePath: string; content: string }) => void) => () => void;
      onSessionUpdate?: (callback: (data: { sessionId: string; status: string; currentGoal: string }) => void) => () => void;
      onSessionWorkingSet?: (callback: (data: { sessionId: string; documents: unknown[]; gaps: string[]; provenanceScore: number }) => void) => () => void;
      onSessionEvent?: (callback: (data: { sessionId: string; event: SessionEvent }) => void) => () => void;
    };
    __setActiveView__?: (name: string) => void;
    __openRunInspector__?: (runId: string) => void;
  }
}
