/**
 * Knowledge Graph Extraction
 *
 * Extracts entities and relationships from document chunks using LLM-based
 * extraction. Falls back to regex-based extraction when no LLM is available.
 *
 * Control Corridor:
 * - Owns: Entity/relationship extraction, graph storage
 * - Must NOT own: Browser automation, LLM provider instantiation
 */

// CarbonDatabase interface for graph operations (methods added in Iteration 2)
interface GraphDatabase {
  createEntity(p: { id: string; workspaceId: string; documentId: string; name: string; entityType: string; properties?: Record<string, unknown> }): Promise<void>;
  findEntities(workspaceId: string, query: string, entityType?: string, limit?: number): Promise<Record<string, unknown>[]>;
  getEntityRelationships(entityId: string): Promise<Record<string, unknown>[]>;
  createRelationship(p: { id: string; workspaceId: string; sourceEntityId: string; targetEntityId: string; relationType: string; properties?: Record<string, unknown>; documentId?: string }): Promise<void>;
  searchGraph(workspaceId: string, query: string, limit?: number): Promise<Array<{ entity: Record<string, unknown>; relationships: Record<string, unknown>[] }>>;
}

/**
 * Lightweight LLM caller interface — avoids circular deps with core-runtime.
 * The caller provides a function that sends a prompt to an LLM and returns the text response.
 */
export interface LLMCaller {
  (prompt: string): Promise<string>;
}

export interface ExtractedEntity {
  name: string;
  entityType: string;
  properties?: Record<string, unknown>;
}

export interface ExtractedRelationship {
  sourceName: string;
  targetName: string;
  relationType: string;
  properties?: Record<string, unknown>;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

// Simple regex-based fallback extraction for when no LLM is available
const ENTITY_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: "url", regex: /https?:\/\/[^\s\"'<>]+/g },
  { type: "phone", regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { type: "date", regex: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi },
  { type: "money", regex: /\$[\d,]+(?:\.\d{2})?|\b\d+(?:\.\d{2})?\s*(?:USD|EUR|GBP|\$)\b/g },
];

const RELATIONSHIP_PATTERNS: Array<{ relationType: string; regex: RegExp }> = [
  { relationType: "signed_by", regex: /(\b[A-Z][a-zA-Z\s]+\b)\s+signed\s+(?:by|with)\s+(\b[A-Z][a-zA-Z\s]+\b)/gi },
  { relationType: "works_for", regex: /(\b[A-Z][a-zA-Z\s]+\b)\s+(?:works?\s+for|employed\s+by|at)\s+(\b[A-Z][a-zA-Z\s]+\b)/gi },
  { relationType: "located_in", regex: /(\b[A-Z][a-zA-Z\s]+\b)\s+(?:located\s+in|based\s+in|headquartered\s+in)\s+(\b[A-Z][a-zA-Z\s]+\b)/gi },
  { relationType: "owns", regex: /(\b[A-Z][a-zA-Z\s]+\b)\s+(?:owns|acquired|purchased)\s+(\b[A-Z][a-zA-Z\s]+\b)/gi },
];

export function extractEntitiesFallback(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const pattern of ENTITY_PATTERNS) {
    const matches = text.matchAll(pattern.regex);
    for (const match of matches) {
      const name = match[0].trim();
      const key = `${pattern.type}:${name}`;
      if (!seen.has(key) && name.length > 2) {
        seen.add(key);
        entities.push({ name, entityType: pattern.type, properties: { matchedText: name } });
      }
    }
  }

  // Extract capitalized phrases as potential named entities (simple heuristic)
  const capitalizedRegex = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4})\b/g;
  const capMatches = text.matchAll(capitalizedRegex);
  for (const match of capMatches) {
    const name = match[1].trim();
    const key = `named_entity:${name}`;
    if (!seen.has(key) && name.length > 3 && !/^(The|A|An|This|That|These|Those|In|On|At|By|For|With|From|To|Of|And|Or|But|If|Then|When|Where|Why|How|What|Who|Which|Whose|Whom)$/i.test(name)) {
      seen.add(key);
      entities.push({ name, entityType: "named_entity", properties: { matchedText: name } });
    }
  }

  return entities;
}

export function extractRelationshipsFallback(text: string, _entities: ExtractedEntity[]): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];
  const seen = new Set<string>();

  for (const pattern of RELATIONSHIP_PATTERNS) {
    const matches = text.matchAll(pattern.regex);
    for (const match of matches) {
      const source = match[1]?.trim();
      const target = match[2]?.trim();
      if (source && target && source !== target) {
        const key = `${source}:${pattern.relationType}:${target}`;
        if (!seen.has(key)) {
          seen.add(key);
          relationships.push({ sourceName: source, targetName: target, relationType: pattern.relationType });
        }
      }
    }
  }

  return relationships;
}

/**
 * Store extracted entities and relationships in the database.
 * Deduplicates by name within the same document.
 */
export async function storeGraphExtraction(
  db: GraphDatabase,
  workspaceId: string,
  documentId: string,
  extraction: ExtractionResult
): Promise<void> {
  const entityIdMap = new Map<string, string>();

  // Store entities (deduplicate by name)
  for (const entity of extraction.entities) {
    const key = `${entity.name.toLowerCase()}:${entity.entityType}`;
    if (entityIdMap.has(key)) continue;

    const id = crypto.randomUUID();
    await db.createEntity({
      id,
      workspaceId,
      documentId,
      name: entity.name,
      entityType: entity.entityType,
      properties: entity.properties,
    });
    entityIdMap.set(key, id);
  }

  // Store relationships
  for (const rel of extraction.relationships) {
    const sourceKey = `${rel.sourceName.toLowerCase()}:named_entity`; // fallback type
    const targetKey = `${rel.targetName.toLowerCase()}:named_entity`;

    // Try to find exact entity matches
    let sourceId = entityIdMap.get(sourceKey);
    let targetId = entityIdMap.get(targetKey);

    // Fallback: search broader
    if (!sourceId) {
      const found = await db.findEntities(workspaceId, rel.sourceName, undefined, 1);
      if (found.length > 0) sourceId = found[0].id as string;
    }
    if (!targetId) {
      const found = await db.findEntities(workspaceId, rel.targetName, undefined, 1);
      if (found.length > 0) targetId = found[0].id as string;
    }

    if (sourceId && targetId) {
      await db.createRelationship({
        id: crypto.randomUUID(),
        workspaceId,
        sourceEntityId: sourceId,
        targetEntityId: targetId,
        relationType: rel.relationType,
        properties: rel.properties,
        documentId,
      });
    }
  }
}

const KG_EXTRACTION_PROMPT = `Extract entities and relationships from the following text.

Respond ONLY with a JSON object in this exact format (no markdown, no explanations):
{
  "entities": [
    { "name": "Entity Name", "entityType": "person|company|contract|date|location|product|technology", "properties": {} }
  ],
  "relationships": [
    { "sourceName": "Source Entity", "targetName": "Target Entity", "relationType": "works_for|signed_by|located_in|owns|part_of|mentions", "properties": {} }
  ]
}

Rules:
- Extract ALL named entities (people, companies, products, locations, dates, contracts, technologies)
- Use specific relation types when possible
- If no relationships exist, return an empty relationships array
- Keep entity names exactly as they appear in the text

TEXT TO ANALYZE:
---
{text}
---`;

/**
 * Extract knowledge graph from text using an LLM.
 * Falls back to regex-based extraction if no LLM caller is provided or if the LLM fails.
 */
export async function extractGraphWithLLM(
  text: string,
  llmCaller?: LLMCaller,
): Promise<ExtractionResult> {
  if (!llmCaller) {
    return extractGraphFromText(text);
  }

  try {
    const prompt = KG_EXTRACTION_PROMPT.replace("{text}", text.slice(0, 12000)); // Limit context
    const response = await llmCaller(prompt);

    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed.entities)) {
      throw new Error("Invalid entities array in LLM response");
    }

    const entities: ExtractedEntity[] = parsed.entities
      .filter((e: { name?: string; entityType?: string }) => e.name && e.entityType)
      .map((e: { name: string; entityType: string; properties?: Record<string, unknown> }) => ({
        name: String(e.name).trim(),
        entityType: String(e.entityType).trim().toLowerCase(),
        properties: e.properties && typeof e.properties === "object" ? e.properties : {},
      }));

    const relationships: ExtractedRelationship[] = Array.isArray(parsed.relationships)
      ? parsed.relationships
          .filter((r: { sourceName?: string; targetName?: string; relationType?: string }) => r.sourceName && r.targetName && r.relationType)
          .map((r: { sourceName: string; targetName: string; relationType: string; properties?: Record<string, unknown> }) => ({
            sourceName: String(r.sourceName).trim(),
            targetName: String(r.targetName).trim(),
            relationType: String(r.relationType).trim().toLowerCase(),
            properties: r.properties && typeof r.properties === "object" ? r.properties : {},
          }))
      : [];

    // If LLM extraction produced no entities, fall back to regex
    if (entities.length === 0) {
      return extractGraphFromText(text);
    }

    return { entities, relationships };
  } catch (err: unknown) {
    // Fallback to regex on any error
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`LLM graph extraction failed (${msg}), falling back to regex`);
    return extractGraphFromText(text);
  }
}

/**
 * Extract knowledge graph from text using fallback regex method.
 * This is the synchronous fallback; prefer extractGraphWithLLM for production use.
 */
export function extractGraphFromText(text: string): ExtractionResult {
  const entities = extractEntitiesFallback(text);
  const relationships = extractRelationshipsFallback(text, entities);
  return { entities, relationships };
}
