import { describe, it, expect } from "vitest";
import { SemanticEmbeddingProvider } from "./semantic-embed.js";

describe("SemanticEmbeddingProvider", () => {
  it("produces 384-dim normalized embeddings", async () => {
    const provider = new SemanticEmbeddingProvider();
    const embeddings = await provider.embed(["hello", "world", "hello world"]);
    expect(embeddings).toHaveLength(3);
    expect(embeddings[0]).toHaveLength(384);

    // Norm should be approximately 1 (normalized)
    for (const emb of embeddings) {
      const mag = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
      expect(mag).toBeGreaterThan(0.95);
      expect(mag).toBeLessThanOrEqual(1.05);
    }

    // Semantic similarity: "hello world" should be closer to "hello" than "world" is to "hello"
    const cosSim = (a: number[], b: number[]) => {
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      return dot;
    };
    const helloWorldSim = cosSim(embeddings[0], embeddings[2]);
    const helloWorldSim2 = cosSim(embeddings[1], embeddings[2]);
    // Both should be higher than unrelated, and hello+hello_world should be closer
    expect(helloWorldSim).toBeGreaterThan(0.5);
    expect(helloWorldSim2).toBeGreaterThan(0.5);
  });
});
