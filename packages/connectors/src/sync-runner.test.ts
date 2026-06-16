import { describe, it, expect, vi } from "vitest";
import { runConnectorSync, type SyncRunnerMemoryAdapter, type ConnectorConfig, type ConnectorItem } from "./index.js";
import type { ConnectorAdapter, ConnectorFetchResult, ConnectorRunState } from "./types.js";

describe("runConnectorSync", () => {
  it("fetches items, ingests them, records runs and updates state", async () => {
    const items: ConnectorItem[] = [
      { id: "i1", sourceType: "rest_item", title: "T1", body: "B1", timestamp: "2025-01-01T00:00:00Z" },
      { id: "i2", sourceType: "rest_item", title: "T2", body: "B2", timestamp: "2025-01-02T00:00:00Z" },
    ];

    const adapter: ConnectorAdapter = {
      type: "rest",
      fetch: vi.fn().mockResolvedValue({
        items,
        hasMore: false,
      } satisfies ConnectorFetchResult),
    };

    const runs: unknown[] = [];
    const stateUpdates: Array<{ connectorId: string; state: ConnectorRunState }> = [];
    const ingested: Array<{ item: ConnectorItem; config: ConnectorConfig }> = [];
    const recordedEvents: unknown[] = [];

    const memoryAdapter: SyncRunnerMemoryAdapter = {
      storeGraphNode: vi.fn(),
      storeGraphEdge: vi.fn(),
      recordEvent: vi.fn((type, summary, details, outcome) => {
        recordedEvents.push({ type, summary, details, outcome });
      }),
      updateConnectorState: vi.fn((connectorId, _workspaceId, state) => {
        stateUpdates.push({ connectorId, state });
      }),
      getConnectorState: vi.fn().mockReturnValue({ cursor: null }),
    };

    const db = {
      recordConnectorRun: vi.fn(async (run) => {
        runs.push(run);
      }),
      updateConnectorState: vi.fn(async (_connectorId, _workspaceId, state) => {
        stateUpdates.push({ connectorId: "conn-1", state });
      }),
      getConnectorState: vi.fn().mockResolvedValue(undefined),
    };

    const config: ConnectorConfig = {
      id: "conn-1",
      name: "test",
      workspaceId: "ws-1",
      type: "rest",
      enabled: true,
    };

    const result = await runConnectorSync(db, config, adapter, memoryAdapter, {
      ingester: {
        ingest: vi.fn(async (item, cfg) => {
          ingested.push({ item, config: cfg });
        }),
      },
    });

    expect(adapter.fetch).toHaveBeenCalledWith(config, expect.anything(), undefined);
    expect(ingested).toHaveLength(2);
    expect(result.status).toBe("success");
    expect(result.itemsProcessed).toBe(2);
    expect(runs).toHaveLength(2); // running + final
    expect(runs.some((r) => (r as { status: string }).status === "success")).toBe(true);
    expect(stateUpdates.length).toBeGreaterThan(0);
    expect(recordedEvents.length).toBeGreaterThan(0);
    expect(recordedEvents.some((e) => (e as { summary: string }).summary.includes("Connector sync"))).toBe(true);
  });

  it("records a failed run and continues to return a run object", async () => {
    const adapter: ConnectorAdapter = {
      type: "rest",
      fetch: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const memoryAdapter: SyncRunnerMemoryAdapter = {
      storeGraphNode: vi.fn(),
      storeGraphEdge: vi.fn(),
      recordEvent: vi.fn(),
      updateConnectorState: vi.fn(),
      getConnectorState: vi.fn(),
    };

    const db = {
      recordConnectorRun: vi.fn(),
      updateConnectorState: vi.fn(),
      getConnectorState: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runConnectorSync(
      db,
      { id: "conn-2", name: "test", workspaceId: "ws-1", type: "rest", enabled: true },
      adapter,
      memoryAdapter,
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("boom");
    expect(db.recordConnectorRun).toHaveBeenCalled();
  });
});
