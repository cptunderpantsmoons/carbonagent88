/**
 * Ingestion Graph Extractor
 *
 * Pluggable entity/relation extractor for documents. Keeps node/edge input
 * shapes aligned with core-runtime GraphMemory.addNode/addEdge so write-through
 * to an AgenticMemorySystem adapter is trivial.
 *
 * The default implementation is deterministic, offline, and requires no API
 * key. An optional LLM provider can be injected for higher quality extraction.
 */

// Lightweight LLM caller interface — avoids a hard runtime dependency on
// core-runtime. The caller provides a function that takes a prompt and returns
// text.
export interface LLMCaller {
  (prompt: string): Promise<string>;
}

export interface IngestionDocument {
  id: string;
  content: string;
  source: string;
  workspaceId: string;
  mimeType?: string;
}

export interface GraphNodeInput {
  id: string;
  workspaceId: string;
  name: string;
  entityType: string;
  properties?: Record<string, unknown>;
  embedding?: number[];
}

export interface GraphEdgeInput {
  id: string;
  workspaceId: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  weight?: number;
  properties?: Record<string, unknown>;
  documentId?: string;
}

export interface EpisodicEventInput {
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

export interface GraphExtraction {
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  events?: EpisodicEventInput[];
}

export interface GraphExtractor {
  extract(doc: IngestionDocument): Promise<GraphExtraction>;
}

// ---------------------------------------------------------------------------
// Offline fallback heuristic extraction
// ---------------------------------------------------------------------------

const ENTITY_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: "url", regex: /https?:\/\/[^\s\"'<>]+/g },
  { type: "phone", regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { type: "date", regex: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi },
  { type: "money", regex: /\$[\d,]+(?:\.\d{2})?|\b\d+(?:\.\d{2})?\s*(?:USD|EUR|GBP|\$)\b/g },
];

const STOP_WORDS = new Set([
  "The", "A", "An", "This", "That", "These", "Those", "In", "On", "At", "By", "For", "With",
  "From", "To", "Of", "And", "Or", "But", "If", "Then", "When", "Where", "Why", "How", "What",
  "Who", "Which", "Whose", "Whom",
]);

function simpleEmbed(text: string): number[] {
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

function nodeId(workspaceId: string, name: string, type: string): string {
  const key = `${workspaceId}:${type.toLowerCase()}:${name.toLowerCase()}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return `ent-${Math.abs(hash).toString(36)}`;
}

function extractNamedEntities(text: string): Array<{ name: string; type: string }> {
  const seen = new Set<string>();
  const entities: Array<{ name: string; type: string }> = [];

  for (const pattern of ENTITY_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const name = match[0].trim();
      const key = `${pattern.type}:${name.toLowerCase()}`;
      if (!seen.has(key) && name.length > 2) {
        seen.add(key);
        entities.push({ name, type: pattern.type });
      }
    }
  }

  const capitalizedRegex = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4})\b/g;
  for (const match of text.matchAll(capitalizedRegex)) {
    const name = match[1]?.trim();
    if (!name || name.length <= 3 || STOP_WORDS.has(name.split(" ")[0] ?? "")) continue;
    const key = `named_entity:${name.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push({ name, type: "named_entity" });
    }
  }

  return entities;
}

const RELATIONSHIP_PATTERNS: Array<{ relationType: string; regex: RegExp }> = [
  { relationType: "mentions", regex: /(?:^|\W)([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})[\s\S]{1,80}?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})(?=\.|,|;|$)/g },
  { relationType: "works_for", regex: /(\b[A-Z][a-zA-Z\s]+\b)\s+(?:works?\s+for|employed\s+by|at)\s+(\b[A-Z][a-zA-Z\s]+\b)/gi },
  { relationType: "located_in", regex: /(\b[A-Z][a-zA-Z\s]+\b)\s+(?:located\s+in|based\s+in|headquartered\s+in)\s+(\b[A-Z][a-zA-Z\s]+\b)/gi },
  { relationType: "signed_by", regex: /(\b[A-Z][a-zA-Z\s]+\b)\s+signed\s+(?:by|with)\s+(\b[A-Z][a-zA-Z\s]+\b)/gi },
  { relationType: "owns", regex: /(\b[A-Z][a-zA-Z\s]+\b)\s+(?:owns|acquired|purchased)\s+(\b[A-Z][a-zA-Z\s]+\b)/gi },
];

function coerceEntityType(name: string, fallback: string): string {
  if (/@/.test(name)) return "email";
  if (/https?:\/\//.test(name)) return "url";
  if (/\$|USD|EUR|GBP/.test(name)) return "financial_value";
  return fallback;
}

function fallbackExtract(doc: IngestionDocument): GraphExtraction {
  const text = doc.content;
  const entities = extractNamedEntities(text);
  const nodeMap = new Map<string, GraphNodeInput>();

  for (const e of entities) {
    const type = coerceEntityType(e.name, e.type);
    const id = nodeId(doc.workspaceId, e.name, type);
    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id,
        workspaceId: doc.workspaceId,
        name: e.name,
        entityType: type,
        properties: { source: doc.source, documentId: doc.id },
        embedding: simpleEmbed(e.name),
      });
    }
  }

  const nodes = Array.from(nodeMap.values());
  const nodeByName = new Map(nodes.map((n) => [n.name.toLowerCase(), n]));
  const edges: GraphEdgeInput[] = [];
  const seenEdges = new Set<string>();

  for (const pattern of RELATIONSHIP_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const sourceName = match[1]?.trim();
      const targetName = match[2]?.trim();
      if (!sourceName || !targetName || sourceName.toLowerCase() === targetName.toLowerCase()) continue;

      const sourceNode = nodeByName.get(sourceName.toLowerCase());
      const targetNode = nodeByName.get(targetName.toLowerCase());
      if (!sourceNode || !targetNode) continue;

      const key = `${sourceNode.id}:${pattern.relationType}:${targetNode.id}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({
        id: `rel-${seenEdges.size.toString(36)}-${nodeId(doc.workspaceId, sourceName, pattern.relationType).slice(4)}`,
        workspaceId: doc.workspaceId,
        sourceId: sourceNode.id,
        targetId: targetNode.id,
        relationType: pattern.relationType,
        weight: 0.6,
        properties: { source: doc.source, documentId: doc.id },
        documentId: doc.id,
      });
    }
  }

  return {
    nodes,
    edges,
    events: [
      {
        id: `evt-ingest-${doc.workspaceId}-${doc.id}`,
        workspaceId: doc.workspaceId,
        type: "task",
        summary: `Ingested document "${doc.source}" (${nodes.length} entities, ${edges.length} relations)`,
        details: { documentId: doc.id, source: doc.source, mimeType: doc.mimeType, nodeCount: nodes.length, edgeCount: edges.length },
        outcome: "success",
        importance: 0.5,
        embedding: simpleEmbed(doc.source),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Optional LLM-based extractor
// ---------------------------------------------------------------------------

const LLM_EXTRACTION_PROMPT = `Extract entities and relationships from the document below.

Respond ONLY with a JSON object in this exact format (no markdown, no explanations):
{
  "nodes": [
    { "name": "Entity Name", "entityType": "person|company|location|product|technology|contract|date|email|url", "properties": {} }
  ],
  "edges": [
    { "sourceName": "Source Entity", "targetName": "Target Entity", "relationType": "works_for|mentions|located_in|signed_by|owns|part_of", "properties": {} }
  ]
}

Rules:
- Use exact entity names as they appear.
- If no relationships exist, return an empty edges array.
- Keep property values simple strings or numbers.

DOCUMENT:
---
{text}
---`;

interface LLMNodeLike {
  name?: string;
  entityType?: string;
  properties?: Record<string, unknown>;
}

interface LLMEdgeLike {
  sourceName?: string;
  targetName?: string;
  relationType?: string;
  properties?: Record<string, unknown>;
}

function sanitizeEntityType(type: string): string {
  const t = type.trim().toLowerCase();
  if (["person", "company", "location", "product", "technology", "contract", "date", "email", "url"].includes(t)) return t;
  return "named_entity";
}

async function llmExtract(doc: IngestionDocument, llm: LLMCaller): Promise<GraphExtraction> {
  const prompt = LLM_EXTRACTION_PROMPT.replace("{text}", doc.content.slice(0, 12000));
  const response = await llm(prompt);
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in LLM response");

  const parsed = JSON.parse(jsonMatch[0]) as {
    nodes?: LLMNodeLike[];
    edges?: LLMEdgeLike[];
  };

  const nodeMap = new Map<string, GraphNodeInput>();

  for (const n of parsed.nodes ?? []) {
    const name = String(n.name ?? "").trim();
    const entityType = sanitizeEntityType(String(n.entityType ?? "named_entity"));
    if (!name) continue;
    const id = nodeId(doc.workspaceId, name, entityType);
    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id,
        workspaceId: doc.workspaceId,
        name,
        entityType,
        properties: { ...n.properties, source: doc.source, documentId: doc.id },
        embedding: simpleEmbed(name),
      });
    }
  }

  const nodes = Array.from(nodeMap.values());
  const nameToNode = new Map(nodes.map((n) => [n.name.toLowerCase(), n]));
  const edges: GraphEdgeInput[] = [];
  const seenEdges = new Set<string>();

  for (const e of parsed.edges ?? []) {
    const sourceName = String(e.sourceName ?? "").trim();
    const targetName = String(e.targetName ?? "").trim();
    const relationType = String(e.relationType ?? "mentions").trim().toLowerCase();
    if (!sourceName || !targetName) continue;
    const source = nameToNode.get(sourceName.toLowerCase());
    const target = nameToNode.get(targetName.toLowerCase());
    if (!source || !target) continue;
    const key = `${source.id}:${relationType}:${target.id}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({
      id: `rel-${seenEdges.size.toString(36)}-${source.id.slice(4)}`,
      workspaceId: doc.workspaceId,
      sourceId: source.id,
      targetId: target.id,
      relationType,
      weight: 0.7,
      properties: { ...e.properties, source: doc.source, documentId: doc.id },
      documentId: doc.id,
    });
  }

  return {
    nodes,
    edges,
    events: [
      {
        id: `evt-ingest-${doc.workspaceId}-${doc.id}`,
        workspaceId: doc.workspaceId,
        type: "task",
        summary: `Ingested document "${doc.source}" via LLM (${nodes.length} entities, ${edges.length} relations)`,
        details: { documentId: doc.id, source: doc.source, mimeType: doc.mimeType, nodeCount: nodes.length, edgeCount: edges.length, extractor: "llm" },
        outcome: "success",
        importance: 0.55,
        embedding: simpleEmbed(doc.source),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createRegexGraphExtractor(): GraphExtractor {
  return {
    async extract(doc: IngestionDocument): Promise<GraphExtraction> {
      return fallbackExtract(doc);
    },
  };
}

export function createLLMGraphExtractor(llm: LLMCaller): GraphExtractor {
  return {
    async extract(doc: IngestionDocument): Promise<GraphExtraction> {
      try {
        return await llmExtract(doc, llm);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`LLM graph extraction failed (${msg}); falling back to regex.`);
        return fallbackExtract(doc);
      }
    },
  };
}

/**
 * Default graph extractor. Works offline and requires no API key.
 */
export const defaultGraphExtractor: GraphExtractor = createRegexGraphExtractor();

export function createGraphExtractor(llm?: LLMCaller): GraphExtractor {
  if (llm) return createLLMGraphExtractor(llm);
  return createRegexGraphExtractor();
}
