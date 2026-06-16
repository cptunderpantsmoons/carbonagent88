/**
 * Graph Memory — Entity-Relationship Knowledge Graph
 *
 * Control Corridor:
 * - Owns: Entity storage, relationship tracking, graph traversal
 * - Must NOT own: Embedding generation, database persistence
 *
 * Implements the pending GraphDatabase interface from graph.ts with
 * multi-hop traversal and contextual inference capabilities.
 */

import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Graph Memory Types
// ---------------------------------------------------------------------------

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

export interface GraphQuery {
  workspaceId: string;
  startNode?: string;
  relationType?: string;
  entityType?: string;
  maxDepth?: number;
  limit: number;
}

export interface GraphPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalWeight: number;
}

export interface GraphSearchResult {
  node: GraphNode;
  score: number;
  paths: GraphPath[];
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  byEntityType: Record<string, number>;
  byRelationType: Record<string, number>;
  averageDegree: number;
}

// ---------------------------------------------------------------------------
// Graph Persistence Interface
// ---------------------------------------------------------------------------

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphPersistence {
  load(workspaceId: string): Promise<GraphData>;
  save(workspaceId: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void>;
  deleteNode(id: string): Promise<void>;
  deleteEdge(id: string): Promise<void>;
}

export interface GraphMemoryOptions {
  persistence?: GraphPersistence;
}

// ---------------------------------------------------------------------------
// Graph Memory
// ---------------------------------------------------------------------------

export class GraphMemory extends EventEmitter {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map();  // node ID -> edge IDs
  private reverseAdjacency: Map<string, Set<string>> = new Map();  // node ID -> edge IDs
  private workspaceIndexes: Map<string, Set<string>> = new Map();
  private typeIndexes: Map<string, Set<string>> = new Map();
  private relationIndexes: Map<string, Set<string>> = new Map();
  private persistence?: GraphPersistence;

  constructor(options: GraphMemoryOptions = {}) {
    super();
    this.persistence = options.persistence;
  }

  /**
   * Initialize the graph memory and optionally hydrate from persistence.
   */
  async init(workspaceId?: string): Promise<void> {
    if (workspaceId) {
      await this.loadForWorkspace(workspaceId);
    }
    this.emit("initialized");
  }

  /**
   * Load persisted graph data for a workspace.
   */
  async loadForWorkspace(workspaceId: string): Promise<void> {
    if (!this.persistence) return;
    const data = await this.persistence.load(workspaceId);
    // Only import nodes/edges belonging to the requested workspace to avoid
    // cross-workspace pollution when the persisted store contains mixed data.
    this.importData({
      nodes: data.nodes.filter((n) => n.workspaceId === workspaceId),
      edges: data.edges.filter((e) => e.workspaceId === workspaceId),
    });
    this.emit("loaded", { workspaceId });
  }

  /**
   * Save in-memory graph data for a workspace to persistence.
   */
  async saveForWorkspace(workspaceId: string): Promise<void> {
    if (!this.persistence) return;
    const nodes = Array.from(this.nodes.values()).filter((n) => n.workspaceId === workspaceId);
    const edges = Array.from(this.edges.values()).filter((e) => e.workspaceId === workspaceId);
    await this.persistence.save(workspaceId, nodes, edges);
    this.emit("saved", { workspaceId });
  }

  // ---------------------------------------------------------------------------
  // Node Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a node to the graph.
   */
  addNode(node: Omit<GraphNode, "mentionCount" | "createdAt">): GraphNode {
    const existing = this.findNodeByName(node.workspaceId, node.name, node.entityType);

    if (existing) {
      // Update existing node
      existing.mentionCount++;
      existing.properties = { ...existing.properties, ...node.properties };
      this.emit("node_updated", { node: existing });
      void this.saveForWorkspace(existing.workspaceId);
      return existing;
    }

    const fullNode: GraphNode = {
      ...node,
      mentionCount: 1,
      createdAt: new Date().toISOString(),
    };

    this.nodes.set(fullNode.id, fullNode);
    this.adjacencyList.set(fullNode.id, new Set());
    this.reverseAdjacency.set(fullNode.id, new Set());

    // Update indexes
    this.addToWorkspaceIndex(fullNode.workspaceId, fullNode.id);
    this.addToTypeIndex(fullNode.entityType, fullNode.id);

    this.emit("node_added", { node: fullNode });
    void this.saveForWorkspace(fullNode.workspaceId);
    return fullNode;
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): GraphNode | null {
    return this.nodes.get(id) ?? null;
  }

  /**
   * Find nodes by name.
   */
  findNodesByName(workspaceId: string, name: string): GraphNode[] {
    return Array.from(this.nodes.values())
      .filter(n => n.workspaceId === workspaceId && n.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * Find a node by name and type.
   */
  private findNodeByName(workspaceId: string, name: string, entityType: string): GraphNode | undefined {
    return Array.from(this.nodes.values())
      .find(n => n.workspaceId === workspaceId && n.name === name && n.entityType === entityType);
  }

  /**
   * List all nodes for a workspace.
   */
  listNodes(workspaceId: string, entityType?: string, limit?: number): GraphNode[] {
    let nodes = Array.from(this.nodes.values())
      .filter(n => n.workspaceId === workspaceId);

    if (entityType) {
      nodes = nodes.filter(n => n.entityType === entityType);
    }

    // Sort by mention count (most mentioned first)
    nodes.sort((a, b) => b.mentionCount - a.mentionCount);

    return limit ? nodes.slice(0, limit) : nodes;
  }

  /**
   * Delete a node and its edges.
   */
  deleteNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    const workspaceId = node.workspaceId;

    // Delete all connected edges
    const edgeIds = this.adjacencyList.get(id) ?? new Set();
    for (const edgeId of edgeIds) {
      this.deleteEdge(edgeId);
    }

    const reverseEdgeIds = this.reverseAdjacency.get(id) ?? new Set();
    for (const edgeId of reverseEdgeIds) {
      this.deleteEdge(edgeId);
    }

    // Remove from indexes
    this.removeFromWorkspaceIndex(node.workspaceId, id);
    this.removeFromTypeIndex(node.entityType, id);

    // Remove node
    this.nodes.delete(id);
    this.adjacencyList.delete(id);
    this.reverseAdjacency.delete(id);

    this.emit("node_deleted", { id });
    void this.persistence?.deleteNode(id).then(() => this.saveForWorkspace(workspaceId));
    return true;
  }

  // ---------------------------------------------------------------------------
  // Edge Operations
  // ---------------------------------------------------------------------------

  /**
   * Add an edge to the graph.
   */
  addEdge(edge: Omit<GraphEdge, "createdAt">): GraphEdge | null {
    // Validate nodes exist
    if (!this.nodes.has(edge.sourceId) || !this.nodes.has(edge.targetId)) {
      return null;
    }

    // Check for duplicate edge
    const existingEdge = this.findEdge(edge.sourceId, edge.targetId, edge.relationType);
    if (existingEdge) {
      // Strengthen existing edge
      existingEdge.weight = Math.min(1, existingEdge.weight + 0.1);
      existingEdge.properties = { ...existingEdge.properties, ...edge.properties };
      this.emit("edge_updated", { edge: existingEdge });
      void this.saveForWorkspace(existingEdge.workspaceId);
      return existingEdge;
    }

    const fullEdge: GraphEdge = {
      ...edge,
      createdAt: new Date().toISOString(),
    };

    this.edges.set(fullEdge.id, fullEdge);

    // Update adjacency lists
    this.adjacencyList.get(fullEdge.sourceId)?.add(fullEdge.id);
    this.reverseAdjacency.get(fullEdge.targetId)?.add(fullEdge.id);

    // Update relation index
    this.addToRelationIndex(fullEdge.relationType, fullEdge.id);

    this.emit("edge_added", { edge: fullEdge });
    void this.saveForWorkspace(fullEdge.workspaceId);
    return fullEdge;
  }

  /**
   * Get an edge by ID.
   */
  getEdge(id: string): GraphEdge | null {
    return this.edges.get(id) ?? null;
  }

  /**
   * Find an edge by source, target, and relation type.
   */
  private findEdge(sourceId: string, targetId: string, relationType: string): GraphEdge | undefined {
    const edgeIds = this.adjacencyList.get(sourceId) ?? new Set();
    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (edge && edge.targetId === targetId && edge.relationType === relationType) {
        return edge;
      }
    }
    return undefined;
  }

  /**
   * List all edges for a workspace.
   */
  listEdges(workspaceId: string, relationType?: string, limit?: number): GraphEdge[] {
    let edges = Array.from(this.edges.values())
      .filter(e => e.workspaceId === workspaceId);

    if (relationType) {
      edges = edges.filter(e => e.relationType === relationType);
    }

    // Sort by weight (strongest first)
    edges.sort((a, b) => b.weight - a.weight);

    return limit ? edges.slice(0, limit) : edges;
  }

  /**
   * Delete an edge.
   */
  deleteEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    // Remove from adjacency lists
    this.adjacencyList.get(edge.sourceId)?.delete(id);
    this.reverseAdjacency.get(edge.targetId)?.delete(id);

    // Remove from relation index
    this.removeFromRelationIndex(edge.relationType, id);

    // Remove edge
    this.edges.delete(id);

    this.emit("edge_deleted", { id });
    void this.persistence?.deleteEdge(id).then(() => this.saveForWorkspace(edge.workspaceId));
    return true;
  }

  // ---------------------------------------------------------------------------
  // Traversal
  // ---------------------------------------------------------------------------

  /**
   * Get neighbors of a node.
   */
  getNeighbors(
    nodeId: string,
    options: {
      direction?: "outgoing" | "incoming" | "both";
      relationType?: string;
      limit?: number;
    } = {},
  ): Array<{ node: GraphNode; edge: GraphEdge }> {
    const { direction = "both", relationType, limit } = options;
    const results: Array<{ node: GraphNode; edge: GraphEdge }> = [];
    const seen = new Set<string>();

    // Outgoing edges
    if (direction === "outgoing" || direction === "both") {
      const outgoingEdgeIds = this.adjacencyList.get(nodeId) ?? new Set();
      for (const edgeId of outgoingEdgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        if (relationType && edge.relationType !== relationType) continue;
        if (seen.has(edge.targetId)) continue;

        const node = this.nodes.get(edge.targetId);
        if (node) {
          results.push({ node, edge });
          seen.add(node.id);
        }
      }
    }

    // Incoming edges
    if (direction === "incoming" || direction === "both") {
      const incomingEdgeIds = this.reverseAdjacency.get(nodeId) ?? new Set();
      for (const edgeId of incomingEdgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        if (relationType && edge.relationType !== relationType) continue;
        if (seen.has(edge.sourceId)) continue;

        const node = this.nodes.get(edge.sourceId);
        if (node) {
          results.push({ node, edge });
          seen.add(node.id);
        }
      }
    }

    // Sort by edge weight
    results.sort((a, b) => b.edge.weight - a.edge.weight);

    return limit ? results.slice(0, limit) : results;
  }

  /**
   * Multi-hop traversal from a starting node.
   */
  traverse(
    startNodeId: string,
    options: {
      maxDepth?: number;
      relationType?: string;
      entityType?: string;
      limit?: number;
    } = {},
  ): GraphPath[] {
    const { maxDepth = 3, relationType, entityType, limit = 10 } = options;
    const paths: GraphPath[] = [];
    const visited = new Set<string>();

    const dfs = (nodeId: string, path: GraphPath, depth: number) => {
      if (depth > maxDepth) return;
      if (paths.length >= limit) return;

      const node = this.nodes.get(nodeId);
      if (!node) return;
      if (entityType && node.entityType !== entityType) return;

      visited.add(nodeId);

      // Get neighbors
      const neighbors = this.getNeighbors(nodeId, { relationType, limit: 10 });

      for (const { node: neighbor, edge } of neighbors) {
        if (visited.has(neighbor.id)) continue;

        const newPath: GraphPath = {
          nodes: [...path.nodes, neighbor],
          edges: [...path.edges, edge],
          totalWeight: path.totalWeight + edge.weight,
        };

        paths.push(newPath);
        dfs(neighbor.id, newPath, depth + 1);
      }

      visited.delete(nodeId);
    };

    dfs(startNodeId, { nodes: [], edges: [], totalWeight: 0 }, 0);

    // Sort paths by total weight (strongest connections first)
    paths.sort((a, b) => b.totalWeight - a.totalWeight);

    return paths.slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /**
   * Search for nodes by name similarity.
   */
  search(
    query: string,
    workspaceId: string,
    options: {
      entityType?: string;
      limit?: number;
    } = {},
  ): GraphSearchResult[] {
    const { entityType, limit = 10 } = options;
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/);

    const candidates = Array.from(this.nodes.values())
      .filter(n => n.workspaceId === workspaceId)
      .filter(n => !entityType || n.entityType === entityType);

    const scored: Array<{ node: GraphNode; score: number }> = [];

    for (const node of candidates) {
      const nameLower = node.name.toLowerCase();
      let score: number;

      // Exact match
      if (nameLower === queryLower) {
        score = 1;
      }
      // Partial match
      else if (nameLower.includes(queryLower)) {
        score = 0.8;
      }
      // Term match
      else {
        const nameTerms = nameLower.split(/\s+/);
        const matchingTerms = queryTerms.filter(t => nameTerms.some(nt => nt.includes(t)));
        score = matchingTerms.length / queryTerms.length * 0.6;
      }

      // Boost by mention count
      score *= (1 + Math.log1p(node.mentionCount) * 0.1);

      if (score > 0) {
        scored.push({ node, score });
      }
    }

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Get paths for top results
    return scored.slice(0, limit).map(({ node, score }) => ({
      node,
      score,
      paths: this.traverse(node.id, { maxDepth: 2, limit: 3 }),
    }));
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get graph statistics for a workspace.
   */
  getStats(workspaceId: string): GraphStats {
    const nodes = Array.from(this.nodes.values())
      .filter(n => n.workspaceId === workspaceId);
    const edges = Array.from(this.edges.values())
      .filter(e => e.workspaceId === workspaceId);

    const byEntityType: Record<string, number> = {};
    const byRelationType: Record<string, number> = {};

    for (const node of nodes) {
      byEntityType[node.entityType] = (byEntityType[node.entityType] ?? 0) + 1;
    }

    for (const edge of edges) {
      byRelationType[edge.relationType] = (byRelationType[edge.relationType] ?? 0) + 1;
    }

    // Calculate average degree
    let totalDegree = 0;
    for (const node of nodes) {
      const outgoing = this.adjacencyList.get(node.id)?.size ?? 0;
      const incoming = this.reverseAdjacency.get(node.id)?.size ?? 0;
      totalDegree += outgoing + incoming;
    }

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      byEntityType,
      byRelationType,
      averageDegree: nodes.length > 0 ? totalDegree / nodes.length : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private addToWorkspaceIndex(workspaceId: string, nodeId: string): void {
    if (!this.workspaceIndexes.has(workspaceId)) {
      this.workspaceIndexes.set(workspaceId, new Set());
    }
    this.workspaceIndexes.get(workspaceId)!.add(nodeId);
  }

  private removeFromWorkspaceIndex(workspaceId: string, nodeId: string): void {
    this.workspaceIndexes.get(workspaceId)?.delete(nodeId);
  }

  private addToTypeIndex(entityType: string, nodeId: string): void {
    if (!this.typeIndexes.has(entityType)) {
      this.typeIndexes.set(entityType, new Set());
    }
    this.typeIndexes.get(entityType)!.add(nodeId);
  }

  private removeFromTypeIndex(entityType: string, nodeId: string): void {
    this.typeIndexes.get(entityType)?.delete(nodeId);
  }

  private addToRelationIndex(relationType: string, edgeId: string): void {
    if (!this.relationIndexes.has(relationType)) {
      this.relationIndexes.set(relationType, new Set());
    }
    this.relationIndexes.get(relationType)!.add(edgeId);
  }

  private removeFromRelationIndex(relationType: string, edgeId: string): void {
    this.relationIndexes.get(relationType)?.delete(edgeId);
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Export graph data.
   */
  exportData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
    };
  }

  /**
   * Import graph data.
   */
  importData(data: { nodes: GraphNode[]; edges: GraphEdge[] }): void {
    // Import nodes first
    for (const node of data.nodes) {
      this.nodes.set(node.id, node);
      this.adjacencyList.set(node.id, new Set());
      this.reverseAdjacency.set(node.id, new Set());
      this.addToWorkspaceIndex(node.workspaceId, node.id);
      this.addToTypeIndex(node.entityType, node.id);
    }

    // Import edges
    for (const edge of data.edges) {
      if (this.nodes.has(edge.sourceId) && this.nodes.has(edge.targetId)) {
        this.edges.set(edge.id, edge);
        this.adjacencyList.get(edge.sourceId)?.add(edge.id);
        this.reverseAdjacency.get(edge.targetId)?.add(edge.id);
        this.addToRelationIndex(edge.relationType, edge.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGraphMemory(options?: GraphMemoryOptions): GraphMemory {
  return new GraphMemory(options);
}
