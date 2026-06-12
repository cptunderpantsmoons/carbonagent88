import { pipeline } from "@xenova/transformers";

let cachedPipeline: unknown | null = null;

async function getPipeline() {
  if (cachedPipeline) return cachedPipeline;
  cachedPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: false });
  return cachedPipeline;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * SemanticEmbeddingProvider — Uses all-MiniLM-L6-v2 via transformers.js (ONNX)
 * Produces 384-dim sentence embeddings that are actually semantic.
 */
export class SemanticEmbeddingProvider implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const pipe = await getPipeline();
    type AnyPipe = (input: string[], options?: Record<string, unknown>) => Promise<unknown>;
    const output = await (pipe as AnyPipe)(texts, { pooling: "mean", normalize: true });
    const out = output as unknown as { data: Float32Array | number[]; dims: number[] };
    // Batch output: Tensor with dims [batch_size, 384]
    const flat = Array.from(out.data);
    const dims = out.dims;
    const vecSize = dims[1] ?? flat.length / (dims[0] ?? 1);
    const batchSize = dims[0] ?? flat.length / vecSize;
    const vectors: number[][] = [];
    for (let i = 0; i < batchSize; i++) {
      vectors.push(flat.slice(i * vecSize, (i + 1) * vecSize));
    }
    return vectors;
  }
}
