/**
 * Graph Memory Persistence Helpers
 *
 * Wraps CarbonDatabase graph methods into a persistence adapter that can be
 * injected into core-runtime GraphMemory via callbacks. This preserves the
 * dependency boundary: core-runtime never imports local-store.
 */

import type { CarbonDatabase } from "./sqlite.js";

export interface GraphNode {
  id: string;
  workspaceId: string;
  name: string;
  entityType: string;
  properties: Record<string, unknown>;
  embedding: number[];
  mentionCount: number;
  createdAt: string;
}

export interface GraphEdge {
  id: string;
  workspaceId: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  weight: number;
  properties: Record<string, unknown>;
  documentId?: string;
  createdAt: string;
}

export interface GraphPersistenceAdapter {
  load(workspaceId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  save(workspaceId: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void>;
  deleteNode(id: string): Promise<void>;
  deleteEdge(id: string): Promise<void>;
}

function parseProperties(json: string | unknown): Record<string, unknown> {
  try {
    return JSON.parse(String(json ?? "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseEmbedding(json: string | unknown): number[] {
  try {
    return JSON.parse(String(json ?? "[]")) as number[];
  } catch {
    return [];
  }
}

export function mapNodeRow(row: Record<string, unknown>): GraphNode {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    entityType: String(row.entity_type),
    properties: parseProperties(row.properties_json),
    embedding: parseEmbedding(row.embedding_json),
    mentionCount: Number(row.mention_count ?? 1),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export function mapEdgeRow(row: Record<string, unknown>): GraphEdge {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sourceId: String(row.source_id),
    targetId: String(row.target_id),
    relationType: String(row.relation_type),
    weight: Number(row.weight ?? 0.5),
    properties: parseProperties(row.properties_json),
    documentId: row.document_id == null ? undefined : String(row.document_id),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

/**
 * Creates a persistence adapter backed by a CarbonDatabase instance.
 */
export function createGraphPersistenceAdapter(db: CarbonDatabase): GraphPersistenceAdapter {
  return {
    async load(workspaceId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
      const nodeRows = await db.listGraphNodes(workspaceId);
      const edgeRows = await db.listGraphEdges(workspaceId);
      return {
        nodes: nodeRows.map((row) => mapNodeRow(row)),
        edges: edgeRows.map((row) => mapEdgeRow(row)),
      };
    },

    async save(workspaceId: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
      for (const node of nodes) {
        await db.mergeGraphNode({
          id: node.id,
          workspaceId: node.workspaceId,
          type: node.entityType,
          label: node.name,
          properties: node.properties,
          embedding: node.embedding,
          mentionCount: node.mentionCount,
        });
      }
      const existingEdges = await db.listGraphEdges(workspaceId) as Array<Record<string, unknown>>;
      const edgeIdSet = new Set(edges.map((e) => e.id));
      for (const row of existingEdges) {
        if (!edgeIdSet.has(String(row.id))) {
          await db.deleteGraphEdge(String(row.id));
        }
      }
      for (const edge of edges) {
        // Ensure endpoints exist before storing the edge; the database cascade
        // constraint requires both source and target nodes to be present.
        await db.mergeGraphNode({
          id: edge.sourceId,
          workspaceId,
          type: "unknown",
          label: edge.sourceId,
        });
        await db.mergeGraphNode({
          id: edge.targetId,
          workspaceId,
          type: "unknown",
          label: edge.targetId,
        });
        await db.deleteGraphEdge(edge.id);
        await db.storeGraphEdge({
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          relationType: edge.relationType,
          workspaceId: edge.workspaceId,
          documentId: edge.documentId,
          weight: edge.weight,
          properties: edge.properties,
        });
      }
    },

    async deleteNode(id: string): Promise<void> {
      await db.deleteGraphNode(id);
    },

    async deleteEdge(id: string): Promise<void> {
      await db.deleteGraphEdge(id);
    },
  };
}
