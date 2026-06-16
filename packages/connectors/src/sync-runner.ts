/**
 * Incremental connector synchronization runner.
 */

import crypto from "node:crypto";
import type {
  ConnectorAdapter,
  ConnectorConfig,
  ConnectorItem,
  ConnectorItemIngester,
  ConnectorRunState,
  ConnectorSyncRun,
  MemoryAdapter,
  SyncRunnerMemoryAdapter,
} from "./types.js";

export interface SyncRunnerDatabase {
  getConnectorState(
    connectorId: string,
    workspaceId: string,
  ): Promise<ConnectorRunState | undefined>;
  updateConnectorState(
    connectorId: string,
    workspaceId: string,
    state: ConnectorRunState,
  ): Promise<void>;
  recordConnectorRun(run: ConnectorSyncRun): Promise<void>;
}

function idForConnectorItem(item: ConnectorItem, connectorId: string): string {
  const base = `${connectorId}:${item.id}:${item.contentHash ?? item.body.slice(0, 200)}`;
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 24);
}

/**
 * Runs a single connector sync to completion.
 */
export async function runConnectorSync(
  db: SyncRunnerDatabase,
  config: ConnectorConfig,
  adapter: ConnectorAdapter,
  memoryAdapter: SyncRunnerMemoryAdapter,
  options: { abortSignal?: AbortSignal; ingester?: ConnectorItemIngester } = {},
): Promise<ConnectorSyncRun> {
  const runId = crypto.randomUUID();
  const run: ConnectorSyncRun = {
    id: runId,
    connectorId: config.id,
    workspaceId: config.workspaceId,
    startedAt: new Date().toISOString(),
    status: "running",
    itemsProcessed: 0,
  };
  await db.recordConnectorRun(run);

  const start = new Date().toISOString();
  let state = (await db.getConnectorState(config.id, config.workspaceId)) ?? {};
  let totalItems = 0;
  let pageCount = 0;

  try {
    do {
      if (options.abortSignal?.aborted) {
        throw new Error("Sync aborted");
      }
      const result = await adapter.fetch(config, state, options.abortSignal);
      pageCount += 1;
      totalItems += result.items.length;

      for (const item of result.items) {
        idForConnectorItem(item, config.id);
        if (options.ingester) {
          await options.ingester.ingest(item, config, memoryAdapter);
        } else {
          memoryAdapter.storeGraphNode({
            id: crypto.randomUUID(),
            workspaceId: config.workspaceId,
            name: item.title || `${config.type}:${config.id}:${item.id}`,
            entityType: "connector_item",
            properties: {
              itemId: item.id,
              sourceType: item.sourceType,
              source: `${config.type}://${config.id}`,
              timestamp: item.timestamp,
            },
          });
        }
      }

      state = result.nextState ?? state;
      await db.updateConnectorState(config.id, config.workspaceId, state);

      if (!result.hasMore || result.items.length === 0) break;
      // Safety guard against runaway adapters.
      if (pageCount >= 100) break;
    } while (true);

    run.status = "success";
    run.itemsProcessed = totalItems;
    run.finishedAt = new Date().toISOString();
  } catch (err) {
    run.status = "failed";
    run.errorMessage = err instanceof Error ? err.message : String(err);
    run.itemsProcessed = totalItems;
    run.finishedAt = new Date().toISOString();
  }

  await db.recordConnectorRun(run);

  // Record a connector_sync episodic event.
  memoryAdapter.recordEvent(
    "task",
    `Connector sync ${config.name} (${config.type}) ${run.status}`,
    {
      connectorId: config.id,
      connectorName: config.name,
      connectorType: config.type,
      runId: run.id,
      itemsProcessed: totalItems,
      durationMs: new Date(run.finishedAt).getTime() - new Date(start).getTime(),
      errorMessage: run.errorMessage ?? null,
    },
    run.status === "success" ? "success" : "failure",
  );

  return run;
}

export interface MemoryAdapterDatabase {
  storeGraphNode(node: {
    id: string;
    workspaceId: string;
    type: string;
    label: string;
    properties?: Record<string, unknown>;
    embedding?: number[];
    mentionCount?: number;
  }): Promise<void>;
  storeGraphEdge(edge: {
    id: string;
    workspaceId: string;
    sourceId: string;
    targetId: string;
    relationType: string;
    documentId?: string | null;
    weight?: number;
    properties?: Record<string, unknown>;
  }): Promise<void>;
  storeEpisodicEvent(event: {
    id: string;
    workspaceId: string;
    type: string;
    summary: string;
    details?: Record<string, unknown>;
    outcome: string;
    embedding?: number[];
    importance?: number;
    createdAt?: string;
  }): Promise<void>;
  getConnectorState(
    connectorId: string,
    workspaceId: string,
  ): Promise<ConnectorRunState | undefined>;
  updateConnectorState(
    connectorId: string,
    workspaceId: string,
    state: ConnectorRunState,
  ): Promise<void>;
}

/**
 * Creates a SyncRunnerMemoryAdapter bound to a specific workspace.
 */
export function memoryAdapterForWorkspace(
  db: MemoryAdapterDatabase,
  workspaceId: string,
): SyncRunnerMemoryAdapter {
  return {
    storeGraphNode: (node) => {
      void db.storeGraphNode({
        id: node.id,
        workspaceId: node.workspaceId,
        type: node.entityType,
        label: node.name,
        properties: node.properties,
        embedding: node.embedding,
        mentionCount: node.properties?.mentionCount as number | undefined,
      });
    },
    storeGraphEdge: (edge) => {
      void db.storeGraphEdge({
        id: edge.id,
        workspaceId: edge.workspaceId,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        relationType: edge.relationType,
        documentId: edge.documentId,
        weight: edge.weight,
        properties: edge.properties,
      });
    },
    recordEvent: (type, summary, details, outcome) => {
      void db.storeEpisodicEvent({
        id: crypto.randomUUID(),
        workspaceId,
        type,
        summary,
        details,
        outcome: outcome ?? "success",
        embedding: [],
        importance: 0.5,
      });
    },
    updateConnectorState: (connectorId, ws, st) =>
      db.updateConnectorState(connectorId, ws, st),
    getConnectorState: (connectorId, ws) => db.getConnectorState(connectorId, ws),
  };
}

export { type MemoryAdapter, type ConnectorConfig, type ConnectorItem };
