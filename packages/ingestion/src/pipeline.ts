/**
 * Ingestion Pipeline
 *
 * Parses, chunks, embeds, and extracts graph entities/relationships from a
 * document. Keeps dependencies light by accepting a small adapter interface
 * instead of a full AgenticMemorySystem instance.
 */

import { chunkText } from "./index.js";
import {
  type GraphExtractor,
  type IngestionDocument,
  type GraphExtraction,
  defaultGraphExtractor,
} from "./graph-extractor.js";

export interface GraphNodeLike {
  id: string;
  workspaceId: string;
  name: string;
  entityType: string;
  properties?: Record<string, unknown>;
  embedding?: number[];
}

export interface GraphEdgeLike {
  id: string;
  workspaceId: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  weight?: number;
  properties?: Record<string, unknown>;
  documentId?: string;
}

export interface EpisodicEventLike {
  id: string;
  workspaceId: string;
  type: "conversation" | "task" | "tool_use" | "decision" | "error";
  summary: string;
  details?: Record<string, unknown>;
  outcome?: "success" | "failure" | "partial";
  importance?: number;
  embedding?: number[];
  createdAt?: string;
}

export interface MemoryAdapter {
  storeGraphNode(node: GraphNodeLike): void;
  storeGraphEdge(edge: GraphEdgeLike): void;
  recordEvent(
    type: EpisodicEventLike["type"],
    summary: string,
    details?: Record<string, unknown>,
    outcome?: EpisodicEventLike["outcome"],
  ): void;
}

export interface PipelineDocument {
  id: string;
  workspaceId: string;
  source: string;
  content: string;
  mimeType?: string;
  chunkSize?: number;
  overlap?: number;
}

export interface PipelineResult {
  documentId: string;
  chunks: Array<{ index: number; content: string }>;
  extraction: GraphExtraction;
}

function simpleHashEmbed(text: string): number[] {
  const dims = 384;
  const vec = new Array(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    vec[code % dims] += 1;
    vec[(code * 31) % dims] += 0.5;
    vec[(code * 97 + i) % dims] += 0.25;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return mag > 0 ? vec.map((v) => v / mag) : vec;
}

function normalizeNodeEmbedding(node: GraphNodeLike): GraphNodeLike {
  return {
    ...node,
    embedding: node.embedding && node.embedding.length > 0 ? node.embedding : simpleHashEmbed(node.name),
  };
}

function normalizeEdge(edge: GraphEdgeLike): GraphEdgeLike {
  return {
    ...edge,
    weight: edge.weight ?? 0.5,
  };
}

/**
 * Runs the ingestion pipeline for a single document.
 */
export async function runIngestionPipeline(
  doc: PipelineDocument,
  deps: {
    extractor?: GraphExtractor;
    memory?: MemoryAdapter;
  } = {},
): Promise<PipelineResult> {
  const extractor = deps.extractor ?? defaultGraphExtractor;

  const chunks = chunkText(doc.content, {
    chunkSize: doc.chunkSize ?? 1000,
    overlap: doc.overlap ?? 200,
  });

  // Extract from the full document content. The extractor shards internally
  // if needed; chunks are used downstream for RAG/semantic retrieval.
  const ingestDoc: IngestionDocument = {
    id: doc.id,
    content: doc.content,
    source: doc.source,
    workspaceId: doc.workspaceId,
    mimeType: doc.mimeType,
  };

  const extraction = await extractor.extract(ingestDoc);
  const nodes = extraction.nodes.map(normalizeNodeEmbedding);
  const edges = extraction.edges.map(normalizeEdge);

  if (deps.memory) {
    for (const node of nodes) {
      deps.memory.storeGraphNode(node);
    }
    for (const edge of edges) {
      deps.memory.storeGraphEdge(edge);
    }

    // Record a single ingestion event describing the extraction.
    const summary = extraction.events?.[0]?.summary ?? `Ingested document "${doc.source}"`;
    const details = extraction.events?.[0]?.details ?? {
      documentId: doc.id,
      source: doc.source,
      mimeType: doc.mimeType,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
    deps.memory.recordEvent(
      extraction.events?.[0]?.type ?? "task",
      summary,
      details,
      extraction.events?.[0]?.outcome ?? "success",
    );
  }

  return {
    documentId: doc.id,
    chunks,
    extraction: { ...extraction, nodes, edges },
  };
}

/**
 * Class wrapper around {@link runIngestionPipeline} for callers that prefer
 * instantiated pipelines with configurable extractors.
 */
export class IngestionPipeline {
  private extractor: GraphExtractor;

  constructor(options: { extractor?: GraphExtractor } = {}) {
    this.extractor = options.extractor ?? defaultGraphExtractor;
  }

  async process(doc: PipelineDocument, memory?: MemoryAdapter): Promise<PipelineResult> {
    return runIngestionPipeline(doc, { extractor: this.extractor, memory });
  }
}
