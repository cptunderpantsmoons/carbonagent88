import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemorySystem, type GraphNode, type GraphEdge, type GraphPersistence } from "./system.js";
import { GraphMemory } from "./graph.js";

describe("AgenticMemorySystem graph integration", () => {
  const workspaceId = "ws-graph-test";

  let persistenceCalls: {
    loads: string[];
    saves: Array<{ workspaceId: string; nodes: GraphNode[]; edges: GraphEdge[] }>;
    deleteNodes: string[];
    deleteEdges: string[];
  };

  function createMockPersistence(): GraphPersistence {
    persistenceCalls = { loads: [], saves: [], deleteNodes: [], deleteEdges: [] };
    return {
      async load(id: string) {
        persistenceCalls.loads.push(id);
        return { nodes: [], edges: [] };
      },
      async save(id: string, nodes: GraphNode[], edges: GraphEdge[]) {
        persistenceCalls.saves.push({ workspaceId: id, nodes, edges });
      },
      async deleteNode(id: string) {
        persistenceCalls.deleteNodes.push(id);
      },
      async deleteEdge(id: string) {
        persistenceCalls.deleteEdges.push(id);
      },
    };
  }

  it("should expose graph methods on AgenticMemorySystem", () => {
    const system = createMemorySystem({ workspaceId });
    expect(typeof system.storeGraphNode).toBe("function");
    expect(typeof system.getGraphNode).toBe("function");
    expect(typeof system.findGraphNodes).toBe("function");
    expect(typeof system.storeGraphEdge).toBe("function");
    expect(typeof system.findGraphEdges).toBe("function");
    expect(typeof system.deleteGraphNode).toBe("function");
    expect(typeof system.deleteGraphEdge).toBe("function");
    expect(typeof system.queryGraph).toBe("function");
    expect(typeof system.graphStats).toBe("function");
  });

  it("should initialize graph memory with persistence", async () => {
    const persistence = createMockPersistence();
    const system = createMemorySystem({ workspaceId, graph: { persistence } });
    await system.initialize();
    expect(persistenceCalls.loads).toContain(workspaceId);
  });

  it("should store and retrieve graph nodes", () => {
    const system = createMemorySystem({ workspaceId });
    const node = system.storeGraphNode({
      id: "n1",
      workspaceId,
      name: "Alice",
      entityType: "person",
      properties: { role: "engineer" },
      embedding: [1, 0, 0],
    });

    expect(node.name).toBe("Alice");
    expect(system.getGraphNode("n1")).not.toBeNull();
    expect(system.findGraphNodes({ limit: 10 }).length).toBeGreaterThanOrEqual(1);
  });

  it("should store and find graph edges", () => {
    const system = createMemorySystem({ workspaceId });
    system.storeGraphNode({ id: "n1", workspaceId, name: "Alice", entityType: "person", properties: {}, embedding: [] });
    system.storeGraphNode({ id: "n2", workspaceId, name: "Acme", entityType: "company", properties: {}, embedding: [] });
    const edge = system.storeGraphEdge({
      id: "e1",
      workspaceId,
      sourceId: "n1",
      targetId: "n2",
      relationType: "works_for",
      weight: 0.9,
      properties: {},
    });

    expect(edge).not.toBeNull();
    expect(system.findGraphEdges({ relationType: "works_for" }).length).toBeGreaterThanOrEqual(1);
  });

  it("should include graph results in memory query when includeGraph is true", async () => {
    const system = createMemorySystem({ workspaceId });
    system.storeGraphNode({ id: "n3", workspaceId, name: "Machine Learning", entityType: "technology", properties: {}, embedding: [] });
    const result = await system.query({ text: "machine", includeGraph: true, limit: 5 });
    expect(result.graph.length).toBeGreaterThanOrEqual(0);
  });

  it("should include graph nodes in memory injection", async () => {
    const system = createMemorySystem({ workspaceId });
    system.storeGraphNode({ id: "n4", workspaceId, name: "Project Alpha", entityType: "project", properties: {}, embedding: [] });
    const injection = await system.getMemoryInjection("project alpha");
    expect(injection.graph.length).toBeGreaterThanOrEqual(1);
  });

  it("should include graph data in export/import", () => {
    const system = createMemorySystem({ workspaceId });
    system.storeGraphNode({ id: "n5", workspaceId, name: "Bob", entityType: "person", properties: {}, embedding: [] });

    const exported = system.exportData();
    expect(exported.graphMemory.nodes).toHaveLength(1);

    const newSystem = createMemorySystem({ workspaceId });
    newSystem.importData({ graphMemory: exported.graphMemory });
    expect(newSystem.getGraphNode("n5")).not.toBeNull();
  });
});
