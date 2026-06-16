import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const { emittedAnomalies, storedEvents } = vi.hoisted(() => ({
  emittedAnomalies: [] as unknown[],
  storedEvents: [] as Array<Record<string, unknown>>,
}));

vi.mock("electron", () => ({
  BrowserWindow: class {},
}));

vi.mock("./desktop-events.js", () => ({
  emitWatcherAnalytics: vi.fn(),
  emitAnomalyDetected: vi.fn((payload: unknown) => emittedAnomalies.push(payload)),
}));

vi.mock("./agent-runner.js", () => ({
  runAgent: vi.fn(),
}));

vi.mock("@carbon-agent/local-store", () => {
  class CarbonDatabase {
    listAnomalyRulesForWatcher = vi.fn(async (watcherId: string) => {
      if (watcherId === "w-1") {
        return [
          {
            id: "rule-1",
            watcher_id: "w-1",
            metric: "new_file_count",
            operator: "gt",
            threshold: 2,
            window_minutes: 60,
            severity: "warning",
            enabled: 1,
            target_id: null,
          },
          {
            id: "rule-2",
            watcher_id: "w-1",
            metric: "file_size",
            operator: "gt",
            threshold: 100,
            window_minutes: 60,
            severity: "critical",
            enabled: 1,
            target_id: null,
          },
        ];
      }
      return [];
    });
    findEpisodicEvents = vi.fn(async (opts: { workspaceId: string; types?: string; after?: string; limit?: number }) => {
      return storedEvents.filter((e) => {
        if (e.workspace_id !== opts.workspaceId) return false;
        if (opts.types && e.type !== opts.types) return false;
        if (opts.after && new Date(String(e.created_at)) < new Date(opts.after)) return false;
        return true;
      });
    });
    storeEpisodicEvent = vi.fn(async (event: { id: string; workspaceId: string; type: string; summary: string; details?: Record<string, unknown>; outcome: string; importance?: number }) => {
      storedEvents.unshift({
        id: event.id,
        workspace_id: event.workspaceId,
        type: event.type,
        summary: event.summary,
        details_json: JSON.stringify(event.details ?? {}),
        outcome: event.outcome,
        importance: event.importance ?? 0.5,
        created_at: new Date().toISOString(),
      });
    });
    listWatchersForWorkspace = vi.fn().mockResolvedValue([]);
    listConnectorRuns = vi.fn().mockResolvedValue([]);
  }

  return {
    CarbonDatabase,
    initDatabase: vi.fn(),
  };
});

import { WatcherManager } from "./watcher-manager.js";

describe("WatcherManager anomaly rules", () => {
  beforeAll(() => {
    storedEvents.length = 0;
    emittedAnomalies.length = 0;
  });

  afterAll(() => {
    storedEvents.length = 0;
    emittedAnomalies.length = 0;
  });

  it("triggers rules that breach thresholds", async () => {
    const manager = new WatcherManager();

    // Seed recent filesystem events
    storedEvents.push(
      { id: "e1", workspace_id: "ws-1", type: "task", summary: "f1", details_json: JSON.stringify({ source: "filesystem" }), outcome: "success", created_at: new Date().toISOString() },
      { id: "e2", workspace_id: "ws-1", type: "task", summary: "f2", details_json: JSON.stringify({ source: "filesystem" }), outcome: "success", created_at: new Date().toISOString() },
      { id: "e3", workspace_id: "ws-1", type: "task", summary: "f3", details_json: JSON.stringify({ source: "filesystem" }), outcome: "success", created_at: new Date().toISOString() },
    );

    const triggered = await manager.evaluateRulesForWatcher("w-1", "ws-1", {
      fileSize: 500,
      runSuccess: true,
    });

    expect(triggered.length).toBe(2);
    expect(triggered.some((t) => t.metric === "new_file_count" && t.severity === "warning")).toBe(true);
    expect(triggered.some((t) => t.metric === "file_size" && t.severity === "critical")).toBe(true);
    expect(emittedAnomalies.length).toBe(2);
  });

  it("does not trigger rules below thresholds", async () => {
    emittedAnomalies.length = 0;
    storedEvents.length = 0;
    const manager = new WatcherManager();

    storedEvents.push(
      { id: "e1", workspace_id: "ws-1", type: "task", summary: "f1", details_json: JSON.stringify({ source: "filesystem" }), outcome: "success", created_at: new Date().toISOString() },
    );

    const triggered = await manager.evaluateRulesForWatcher("w-1", "ws-1", {
      fileSize: 10,
      runSuccess: true,
    });

    expect(triggered.length).toBe(0);
    expect(emittedAnomalies.length).toBe(0);
  });

  it("records anomaly_detected episodic events when triggering", async () => {
    storedEvents.length = 0;
    emittedAnomalies.length = 0;
    const manager = new WatcherManager();

    storedEvents.push(
      { id: "e1", workspace_id: "ws-1", type: "task", summary: "f1", details_json: JSON.stringify({ source: "filesystem" }), outcome: "success", created_at: new Date().toISOString() },
      { id: "e2", workspace_id: "ws-1", type: "task", summary: "f2", details_json: JSON.stringify({ source: "filesystem" }), outcome: "success", created_at: new Date().toISOString() },
      { id: "e3", workspace_id: "ws-1", type: "task", summary: "f3", details_json: JSON.stringify({ source: "filesystem" }), outcome: "success", created_at: new Date().toISOString() },
      { id: "e4", workspace_id: "ws-1", type: "task", summary: "f4", details_json: JSON.stringify({ source: "filesystem" }), outcome: "success", created_at: new Date().toISOString() },
    );

    await manager.evaluateRulesForWatcher("w-1", "ws-1", { runSuccess: true });

    const anomalyEvents = storedEvents.filter((e) => e.type === "error" && (e.summary as string).includes("Anomaly detected"));
    expect(anomalyEvents.length).toBeGreaterThan(0);
  });
});
