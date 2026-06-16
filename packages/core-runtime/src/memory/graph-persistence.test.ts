import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGraphMemory, type GraphNode, type GraphEdge, type GraphPersistence } from "./graph.js";

describe("GraphMemory persistence hooks", () => {
  let persistence: GraphPersistence;
  let loadCalls: string[];
  let saveCalls: Array<{ workspaceId: string; nodes: GraphNode[]; edges: GraphEdge[] }>;
  let deleteNodeCalls: string[];
  let deleteEdgeCalls: string[];

  beforeEach(() => {
    loadCalls = [];
    saveCalls = [];
    deleteNodeCalls = [];
    deleteEdgeCalls = [];
    persistence = {
      async load(workspaceId: string) {
        loadCalls.push(workspaceId);
        return { nodes: [], edges: [] };
      },
      async save(workspaceId: string, nodes: GraphNode[], edges: GraphEdge[]) {
        saveCalls.push({ workspaceId, nodes, edges });
      },
      async deleteNode(id: string) {
        deleteNodeCalls.push(id);
      },
      async deleteEdge(id: string) {
        deleteEdgeCalls.push(id);
      },
    };
  });

  it("should call persistence.load during init", async () => {
    const graph = createGraphMemory({ persistence });
    await graph.init("ws1");
    expect(loadCalls).toContain("ws1");
  });

  it("should call save after adding a node", async () => {
    const graph = createGraphMemory({ persistence });
    graph.addNode({
      id: "n1",
      workspaceId: "ws1",
      name: "Alice",
      entityType: "person",
      properties: {},
      embedding: [1, 0, 0],
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(saveCalls.length).toBeGreaterThanOrEqual(1);
    expect(saveCalls[0]?.workspaceId).toBe("ws1");
    expect(saveCalls[0]?.nodes.some((n) => n.id === "n1")).toBe(true);
  });

  it("should call save after adding an edge", async () => {
    const graph = createGraphMemory({ persistence });
    graph.addNode({ id: "n1", workspaceId: "ws1", name: "Alice", entityType: "person", properties: {}, embedding: [] });
    graph.addNode({ id: "n2", workspaceId: "ws1", name: "Acme", entityType: "company", properties: {}, embedding: [] });
    graph.addEdge({ id: "e1", workspaceId: "ws1", sourceId: "n1", targetId: "n2", relationType: "works_for", weight: 0.9, properties: {} });
    await new Promise((r) => setTimeout(r, 10));
    expect(saveCalls.some((call) => call.edges.some((e) => e.id === "e1"))).toBe(true);
  });

  it("should call deleteNode when a node is removed", async () => {
    const graph = createGraphMemory({ persistence });
    graph.addNode({ id: "n1", workspaceId: "ws1", name: "Alice", entityType: "person", properties: {}, embedding: [] });
    await new Promise((r) => setTimeout(r, 10));
    saveCalls.length = 0;

    graph.deleteNode("n1");
    await new Promise((r) => setTimeout(r, 10));
    expect(deleteNodeCalls).toContain("n1");
  });

  it("should call deleteEdge when an edge is removed", async () => {
    const graph = createGraphMemory({ persistence });
    graph.addNode({ id: "n1", workspaceId: "ws1", name: "Alice", entityType: "person", properties: {}, embedding: [] });
    graph.addNode({ id: "n2", workspaceId: "ws1", name: "Acme", entityType: "company", properties: {}, embedding: [] });
    graph.addEdge({ id: "e1", workspaceId: "ws1", sourceId: "n1", targetId: "n2", relationType: "works_for", weight: 0.9, properties: {} });
    await new Promise((r) => setTimeout(r, 10));
    deleteEdgeCalls.length = 0;

    graph.deleteEdge("e1");
    await new Promise((r) => setTimeout(r, 10));
    expect(deleteEdgeCalls).toContain("e1");
  });

  it("should rehydrate persisted data via loadForWorkspace", async () => {
    const persistedNodes: GraphNode[] = [
      {
        id: "n1",
        workspaceId: "ws1",
        name: "Alice",
        entityType: "person",
        properties: {},
        embedding: [1, 0, 0],
        mentionCount: 1,
        createdAt: new Date().toISOString(),
      },
    ];
    const persistedEdges: GraphEdge[] = [];

    const sourcePersistence: GraphPersistence = {
      async load() {
        return { nodes: persistedNodes, edges: persistedEdges };
      },
      async save() {},
      async deleteNode() {},
      async deleteEdge() {},
    };

    const graph = createGraphMemory({ persistence: sourcePersistence });
    await graph.loadForWorkspace("ws1");
    expect(graph.getNode("n1")).not.toBeNull();
  });
});
