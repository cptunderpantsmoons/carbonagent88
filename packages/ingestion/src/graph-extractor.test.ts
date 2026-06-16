import { describe, it, expect, vi } from "vitest";
import {
  createRegexGraphExtractor,
  createLLMGraphExtractor,
  createGraphExtractor,
  type GraphExtractor,
  type IngestionDocument,
} from "./graph-extractor.js";

describe("graph-extractor", () => {
  const doc: IngestionDocument = {
    id: "doc-1",
    workspaceId: "ws-1",
    source: "test-contract.txt",
    content:
      "Alice Johnson signed a contract with Acme Corp on January 15, 2026. " +
      "Acme Corp is headquartered in New York. Contact alice@example.com.",
    mimeType: "text/plain",
  };

  it("extracts deterministic nodes offline", async () => {
    const extractor = createRegexGraphExtractor();
    const result = await extractor.extract(doc);

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.some((n) => n.name.toLowerCase().includes("alice"))).toBe(true);
    expect(result.nodes.some((n) => n.name.toLowerCase().includes("acme"))).toBe(true);
    expect(result.events?.length).toBe(1);
    expect(result.events?.[0]?.summary).toContain("Ingested");
  });

  it("extracts relationships from text", async () => {
    const extractor = createRegexGraphExtractor();
    const result = await extractor.extract(doc);

    const rel = result.edges.find(
      (e) => e.relationType === "signed_by" || e.relationType === "mentions",
    );
    expect(rel).toBeDefined();
  });

  it("uses injected LLM when provided", async () => {
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify({
        nodes: [{ name: "Alice Smith", entityType: "person", properties: {} }],
        edges: [
          {
            sourceName: "Alice Smith",
            targetName: "Beta Corp",
            relationType: "works_for",
            properties: {},
          },
        ],
      }),
    );
    const extractor = createLLMGraphExtractor(llm);
    const result = await extractor.extract(doc);

    expect(llm).toHaveBeenCalledTimes(1);
    expect(result.nodes.some((n) => n.name === "Alice Smith")).toBe(true);
  });

  it("falls back to regex on LLM failure", async () => {
    const llm = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const extractor = createLLMGraphExtractor(llm);
    const result = await extractor.extract(doc);

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.events?.[0]?.summary).not.toContain("LLM");
  });

  it("default factory returns offline extractor without LLM", async () => {
    const extractor = createGraphExtractor();
    const result = await extractor.extract(doc);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it("stub extractor can be injected into a pipeline", async () => {
    const stub: GraphExtractor = {
      async extract() {
        return {
          nodes: [
            {
              id: "n1",
              workspaceId: "ws-1",
              name: "Stub Entity",
              entityType: "test",
            },
          ],
          edges: [
            {
              id: "e1",
              workspaceId: "ws-1",
              sourceId: "n1",
              targetId: "n1",
              relationType: "self",
            },
          ],
          events: [],
        };
      },
    };
    const result = await stub.extract(doc);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
  });
});
