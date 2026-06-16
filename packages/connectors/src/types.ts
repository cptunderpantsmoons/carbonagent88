/**
 * Connector framework shared types.
 */

export type ConnectorType =
  | "directory"
  | "rest"
  | "email"
  | "calendar"
  | "pm"
  | "database";

export interface ConnectorConfig {
  id: string;
  name: string;
  workspaceId: string;
  type: ConnectorType;
  enabled: boolean;
  /** Cron expression or one-off trigger descriptor. */
  schedule?: string | null;
  /** Encrypted credential blob. */
  credentialsEncrypted?: string | null;
  /** Plain runtime options (safe to persist unencrypted). */
  options?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface TypedConnectorConfig<T extends Record<string, unknown>> extends ConnectorConfig {
  options?: T;
}

export interface ConnectorRunState {
  cursor?: string | null;
  lastItemId?: string | null;
  lastSyncAt?: string | null;
  page?: number | null;
  /** Opaque adapter-specific state. */
  payload?: Record<string, unknown> | null;
}

export interface GraphNodeLike {
  id: string;
  workspaceId: string;
  name: string;
  entityType: string;
  properties?: Record<string, unknown>;
  embedding?: number[];
}

export interface GraphEdgeLike {
  id: string;
  workspaceId: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  weight?: number;
  properties?: Record<string, unknown>;
  documentId?: string;
}

export interface MemoryAdapter {
  storeGraphNode(node: GraphNodeLike): void;
  storeGraphEdge(edge: GraphEdgeLike): void;
  recordEvent(
    type: "conversation" | "task" | "tool_use" | "decision" | "error",
    summary: string,
    details?: Record<string, unknown>,
    outcome?: "success" | "failure" | "partial",
  ): void;
}

export interface SyncRunnerMemoryAdapter extends MemoryAdapter {
  updateConnectorState(
    connectorId: string,
    workspaceId: string,
    state: ConnectorRunState,
  ): void | Promise<void>;
  getConnectorState(
    connectorId: string,
    workspaceId: string,
  ): ConnectorRunState | undefined | Promise<ConnectorRunState | undefined>;
}

export interface ConnectorItemIngester {
  ingest(item: ConnectorItem, config: ConnectorConfig, memoryAdapter: SyncRunnerMemoryAdapter): Promise<void>;
}

export interface ConnectorAttachment {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  content?: Uint8Array | string;
}

export interface ConnectorItem {
  id: string;
  sourceType: string;
  title: string;
  body: string;
  timestamp: string;
  url?: string | null;
  attachments?: ConnectorAttachment[];
  /** Raw adapter payload preserved for traceability. */
  raw?: unknown;
  /** Stable content hash used for deduplication. */
  contentHash?: string;
}

export interface ConnectorFetchResult<T extends ConnectorRunState = ConnectorRunState> {
  items: ConnectorItem[];
  nextState?: T;
  hasMore?: boolean;
}

export interface ConnectorAdapter {
  readonly type: ConnectorType;
  fetch(
    config: ConnectorConfig,
    state: ConnectorRunState,
    signal?: AbortSignal,
  ): Promise<ConnectorFetchResult>;
}

export interface ConnectorSyncRun {
  id: string;
  connectorId: string;
  workspaceId: string;
  startedAt: string;
  finishedAt?: string | null;
  status: "success" | "failed" | "partial" | "running";
  itemsProcessed: number;
  errorMessage?: string | null;
}
