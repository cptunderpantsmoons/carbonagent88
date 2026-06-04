import { describe, it, expect } from "vitest";

class HashEmbeddingProvider {
  private dims = 384;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.hashEmbed(text));
  }

  private hashEmbed(text: string): number[] {
    const vec = new Array(this.dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      vec[code % this.dims] += 1;
      vec[(code * 31) % this.dims] += 0.5;
      vec[(code * 97 + i) % this.dims] += 0.25;
    }
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return mag > 0 ? vec.map(v => v / mag) : vec;
  }
}

describe("HashEmbeddingProvider", () => {
  it("produces normalized embeddings", async () => {
    const provider = new HashEmbeddingProvider();
    const embeddings = await provider.embed(["hello", "world"]);
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]).toHaveLength(384);
    const mag = Math.sqrt(embeddings[0].reduce((s, v) => s + v * v, 0));
    expect(mag).toBeGreaterThan(0.9);
    expect(mag).toBeLessThanOrEqual(1.01);
  });
});
