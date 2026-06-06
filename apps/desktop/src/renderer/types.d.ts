export {};

declare global {
  interface Window {
    carbonAPI: {
      invoke(request: Record<string, unknown>): Promise<unknown>;
      onViewportFrame?: (callback: (frame: { profileId: string; mimeType: string; base64: string }) => void) => () => void;
      onAgentTopology?: (callback: (data: { runId: string; nodes: Array<{ id: string; label: string; status: string; x: number; y: number }>; edges: Array<{ from: string; to: string }> }) => void) => () => void;
      onAXTree?: (callback: (data: { profileId: string; tree: { role: string; name?: string; value?: string; axNodeId: string; children?: unknown[] }; activeNodeId?: string }) => void) => () => void;
      onWatcherAnalytics?: (callback: (data: { runs: Array<{ watcherId: string; watcherName: string; startedAt: string; completedAt?: string; success: boolean }> }) => void) => () => void;
      onVaultChange?: (callback: (data: { workspaceId: string; filePath: string; content: string }) => void) => () => void;
      onSessionUpdate?: (callback: (data: { sessionId: string; status: string; currentGoal: string }) => void) => () => void;
      onSessionWorkingSet?: (callback: (data: { sessionId: string; documents: unknown[]; gaps: string[]; provenanceScore: number }) => void) => () => void;
    };
    __setActiveView__?: (name: string) => void;
    __openRunInspector__?: (runId: string) => void;
  }
}
