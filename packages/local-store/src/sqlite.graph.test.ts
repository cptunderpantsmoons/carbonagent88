import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CarbonDatabase, initDatabase, saveDatabase, closeDatabase } from "./sqlite";
import path from "node:path";
import fs from "node:fs";

describe("CarbonDatabase graph CRUD", () => {
  let db: CarbonDatabase;
  const testDbPath = "/tmp/carbon-test-graph.db";
  const workspaceId = "550e8400-e29b-41d4-a716-446655440100";

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    await initDatabase(testDbPath);
    db = new CarbonDatabase();
    await db.createWorkspace({
      id: workspaceId,
      name: "Graph Test",
      vaultDir: "/tmp/v-graph",
    });
  });

  afterAll(() => {
    saveDatabase();
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it("stores and retrieves a graph node", async () => {
    await db.storeGraphNode({
      id: "node-1",
      workspaceId,
      type: "person",
      label: "Alice",
      properties: { role: "engineer" },
      embedding: [1, 0, 0],
      mentionCount: 1,
    });

    const node = await db.getGraphNode("node-1");
    expect(node).toBeDefined();
    expect(String(node?.name)).toBe("Alice");
    expect(String(node?.entity_type)).toBe("person");
    expect(JSON.parse(String(node?.properties_json ?? "{}"))).toEqual({ role: "engineer" });
  });

  it("merges an existing node", async () => {
    await db.mergeGraphNode({
      id: "node-1",
      workspaceId,
      type: "person",
      label: "Alice Smith",
      properties: { role: "senior engineer" },
      mentionCount: 3,
    });

    const node = await db.getGraphNode("node-1");
    expect(String(node?.name)).toBe("Alice Smith");
    expect(Number(node?.mention_count)).toBe(3);
  });

  it("finds nodes by workspace, type and label", async () => {
    const nodes = await db.findGraphNodes({ workspaceId, type: "person" });
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    expect(nodes.some((n) => String(n.name) === "Alice Smith")).toBe(true);

    const byLabel = await db.findGraphNodes({ workspaceId, label: "Alice Smith" });
    expect(byLabel).toHaveLength(1);
  });

  it("stores and retrieves a graph edge", async () => {
    await db.storeGraphNode({
      id: "node-2",
      workspaceId,
      type: "company",
      label: "Acme Corp",
    });

    await db.storeGraphEdge({
      id: "edge-1",
      sourceId: "node-1",
      targetId: "node-2",
      relationType: "works_for",
      workspaceId,
      weight: 0.9,
    });

    const edge = await db.getGraphEdge("edge-1");
    expect(edge).toBeDefined();
    expect(String(edge?.relation_type)).toBe("works_for");
    expect(Number(edge?.weight)).toBe(0.9);
  });

  it("finds edges by workspace, source, target and relation", async () => {
    const edges = await db.findGraphEdges({ workspaceId, sourceId: "node-1" });
    expect(edges).toHaveLength(1);

    const none = await db.findGraphEdges({ workspaceId, relationType: "located_in" });
    expect(none).toHaveLength(0);
  });

  it("cascades delete node to connected edges", async () => {
    await db.deleteGraphNode("node-1");

    const node = await db.getGraphNode("node-1");
    expect(node).toBeUndefined();

    const edge = await db.getGraphEdge("edge-1");
    expect(edge).toBeUndefined();
  });

  it("deletes an edge independently", async () => {
    await db.storeGraphEdge({
      id: "edge-2",
      sourceId: "node-2",
      targetId: "node-2",
      relationType: "self",
      workspaceId,
    });

    await db.deleteGraphEdge("edge-2");
    const edge = await db.getGraphEdge("edge-2");
    expect(edge).toBeUndefined();
  });

  it("lists all graph nodes and edges for a workspace", async () => {
    const nodes = await db.listGraphNodes(workspaceId);
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    const edges = await db.listGraphEdges(workspaceId);
    expect(edges.length).toBeGreaterThanOrEqual(0);
  });
});
