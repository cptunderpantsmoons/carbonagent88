/**
 * Connector framework — lightweight dependency-free adapters.
 */

export {
  DirectoryConnector,
  type DirectoryConnectorConfig,
  type DirectoryConnectorOptions,
} from "./directory-connector.js";

export { RestConnector, type RestConnectorConfig, type RestConnectorOptions } from "./rest-connector.js";

export {
  resolveConnectorAdapter,
  listConnectorTypes,
  isConnectorTypeImplemented,
} from "./adapters.js";

export {
  runConnectorSync,
  memoryAdapterForWorkspace,
  type SyncRunnerDatabase,
  type MemoryAdapterDatabase,
} from "./sync-runner.js";

export type {
  ConnectorType,
  ConnectorConfig,
  ConnectorRunState,
  ConnectorItem,
  ConnectorAttachment,
  ConnectorFetchResult,
  ConnectorAdapter,
  ConnectorSyncRun,
  MemoryAdapter,
  SyncRunnerMemoryAdapter,
  ConnectorItemIngester,
  GraphNodeLike,
  GraphEdgeLike,
} from "./types.js";
