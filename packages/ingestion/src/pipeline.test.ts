import { describe, it, expect, vi } from "vitest";
import { IngestionPipeline, type MemoryAdapter, type GraphNodeLike, type GraphEdgeLike, type EpisodicEventLike } from "./pipeline.js";

describe("IngestionPipeline extraction hook", () => {
  it("writes extracted nodes, edges, and an episodic event to the adapter", async () => {
    const storedNodes: GraphNodeLike[] = [];
    const storedEdges: GraphEdgeLike[] = [];
    const recordedEvents: EpisodicEventLike[] = [];

    const memory: MemoryAdapter = {
      storeGraphNode: vi.fn((node: GraphNodeLike) => storedNodes.push(node)),
      storeGraphEdge: vi.fn((edge: GraphEdgeLike) => storedEdges.push(edge)),
      recordEvent: vi.fn((type, summary, details, outcome) => {
        recordedEvents.push({
          id: "evt-1",
          workspaceId: "ws-1",
          type,
          summary,
          details: details ?? {},
          outcome,
        });
      }),
    };

    const pipeline = new IngestionPipeline();
    await pipeline.process(
      {
        id: "doc-1",
        workspaceId: "ws-1",
        source: "test-contract.txt",
        content:
          "Alice Johnson works for Acme Corp. Acme Corp is headquartered in New York.",
        mimeType: "text/plain",
      },
      memory,
    );

    expect(storedNodes.length).toBeGreaterThan(0);
    expect(storedEdges.length).toBeGreaterThanOrEqual(0);
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]?.summary).toContain("Ingested");
    expect(recordedEvents[0]?.type).toBe("task");
  });

  it("allows injecting a stub extractor", async () => {
    const storedNodes: GraphNodeLike[] = [];
    const memory: MemoryAdapter = {
      storeGraphNode: vi.fn((node: GraphNodeLike) => storedNodes.push(node)),
      storeGraphEdge: vi.fn(() => {}),
      recordEvent: vi.fn(() => {}),
    };

    const pipeline = new IngestionPipeline({
      extractor: {
        async extract() {
          return {
            nodes: [
              {
                id: "stub-node",
                workspaceId: "ws-1",
                name: "Stub Entity",
                entityType: "test",
              },
            ],
            edges: [],
          };
        },
      },
    });

    await pipeline.process(
      {
        id: "doc-2",
        workspaceId: "ws-1",
        source: "empty.txt",
        content: "",
      },
      memory,
    );

    expect(storedNodes).toHaveLength(1);
    expect(storedNodes[0]?.name).toBe("Stub Entity");
  });

  it("returns extraction without an adapter", async () => {
    const pipeline = new IngestionPipeline();
    const result = await pipeline.process({
      id: "doc-3",
      workspaceId: "ws-1",
      source: "note.txt",
      content: "Alice Johnson signed the agreement with Acme Corp.",
    });

    expect(result.documentId).toBe("doc-3");
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    expect(result.extraction.nodes.length).toBeGreaterThan(0);
  });
});
