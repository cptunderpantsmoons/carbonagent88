export {};

declare global {
  interface Window {
    carbonAPI: {
      invoke(request: Record<string, unknown>): Promise<unknown>;
      onViewportFrame?: (callback: (frame: unknown) => void) => () => void;
      onAgentTopology?: (callback: (data: unknown) => void) => () => void;
      onAXTree?: (callback: (data: unknown) => void) => () => void;
      onWatcherAnalytics?: (callback: (data: unknown) => void) => () => void;
    };
    __setActiveView__?: (name: string) => void;
    __openRunInspector__?: (runId: string) => void;
  }
}
