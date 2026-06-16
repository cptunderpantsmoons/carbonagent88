/**
 * Connector adapter registry.
 */

import { DirectoryConnector } from "./directory-connector.js";
import { RestConnector } from "./rest-connector.js";
import type { ConnectorAdapter, ConnectorType } from "./types.js";

function stubAdapter(type: ConnectorType): ConnectorAdapter {
  return {
    type,
    async fetch() {
      throw new Error(`Connector adapter '${type}' is not implemented yet`);
    },
  };
}

const registry: Record<ConnectorType, () => ConnectorAdapter> = {
  directory: () => new DirectoryConnector(),
  rest: () => new RestConnector(),
  email: () => stubAdapter("email"),
  calendar: () => stubAdapter("calendar"),
  pm: () => stubAdapter("pm"),
  database: () => stubAdapter("database"),
};

export function resolveConnectorAdapter(type: ConnectorType): ConnectorAdapter {
  const factory = registry[type];
  if (!factory) {
    throw new Error(`Unknown connector type: ${type}`);
  }
  return factory();
}

export function listConnectorTypes(): ConnectorType[] {
  return Object.keys(registry) as ConnectorType[];
}

export function isConnectorTypeImplemented(type: ConnectorType): boolean {
  return type === "directory" || type === "rest";
}
