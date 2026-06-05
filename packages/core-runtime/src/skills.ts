/**
 * Persistent Agent Memory — Skill Store
 *
 * Control Corridor:
 * - Owns: Skill CRUD, embedding-based retrieval, de-duplication
 * - Must NOT own: Browser profiles, LLM provider instantiation
 *
 * A Skill is a stored successful sequence of tool calls + context that the
 * agent can recall for similar future tasks.
 */

/**
 * Minimal inline embedding to avoid circular dependency on @carbon-agent/ingestion
 */
export class HashEmbeddingProvider {
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

export interface Skill {
  id: string;
  workspaceId: string;
  trigger: string;           // natural language description of when to use
  triggerEmbedding: number[];
  name: string;
  description: string;
  toolSequence: SkillStep[];
  successCount: number;
  failureCount: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillStep {
  toolName: string;
  input: Record<string, unknown>;
  notes?: string;
}

// In-memory store (backed by SQLite in production via main.ts wiring)
const skillStore: Skill[] = [];
const embedder = new HashEmbeddingProvider();

/**
 * Store a new skill (or increment success count if duplicate exists).
 */
export async function storeSkill(
  workspaceId: string,
  trigger: string,
  name: string,
  description: string,
  toolSequence: SkillStep[],
): Promise<Skill> {
  const embeddings = await embedder.embed([trigger]);
  const existing = findExistingSkill(workspaceId, trigger, embeddings[0]!);

  if (existing) {
    existing.successCount++;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }

  const skill: Skill = {
    id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    trigger,
    triggerEmbedding: embeddings[0]!,
    name,
    description,
    toolSequence,
    successCount: 1,
    failureCount: 0,
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  skillStore.push(skill);
  return skill;
}

/**
 * Recall skills similar to the given query.
 */
export async function recallSkills(
  workspaceId: string,
  query: string,
  limit: number = 5,
): Promise<Skill[]> {
  const [queryEmbedding] = await embedder.embed([query]);

  const candidates = skillStore.filter(s => s.workspaceId === workspaceId);
  if (candidates.length === 0) return [];

  const scored = candidates.map(s => ({
    skill: s,
    score: cosineSimilarity(queryEmbedding, s.triggerEmbedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.skill);
}

/**
 * Mark a skill as pinned (will be returned first in recall).
 */
export function pinSkill(skillId: string, pinned: boolean): boolean {
  const skill = skillStore.find(s => s.id === skillId);
  if (!skill) return false;
  skill.pinned = pinned;
  skill.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Delete a skill.
 */
export function deleteSkill(skillId: string): boolean {
  const idx = skillStore.findIndex(s => s.id === skillId);
  if (idx === -1) return false;
  skillStore.splice(idx, 1);
  return true;
}

/**
 * List all skills for a workspace.
 */
export function listSkills(workspaceId: string): Skill[] {
  return skillStore
    .filter(s => s.workspaceId === workspaceId)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.successCount - a.successCount;
    });
}

/**
 * Record a skill as failed (decreases confidence).
 */
export function recordSkillFailure(skillId: string): boolean {
  const skill = skillStore.find(s => s.id === skillId);
  if (!skill) return false;
  skill.failureCount++;
  skill.updatedAt = new Date().toISOString();
  return true;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

const SIMILARITY_THRESHOLD = 0.85;

function findExistingSkill(workspaceId: string, trigger: string, embedding: number[]): Skill | undefined {
  const candidates = skillStore.filter(s => s.workspaceId === workspaceId);
  for (const s of candidates) {
    if (s.trigger === trigger) return s;
    if (cosineSimilarity(embedding, s.triggerEmbedding) > SIMILARITY_THRESHOLD) {
      return s;
    }
  }
  return undefined;
}
