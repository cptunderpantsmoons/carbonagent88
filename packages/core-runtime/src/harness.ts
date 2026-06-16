// Harness abstraction layer — no agent.ts or gateway.js deps at top level

import type { PermissionResolver } from "./security/tool-guard.js";
import { permitTool } from "./security/tool-guard.js";

export interface HarnessCapability {
  name: string;
  description: string;
}

export interface HarnessArtifact {
  name: string;
  path: string;
  mimeType: string;
}

export interface HarnessExecutionInput {
  task: string;
  context: string;
  workspaceId: string;
  profileId?: string;
  runId?: string;
  conversationId?: string;
  artifacts?: HarnessArtifact[];
}

export interface HarnessExecutionResult {
  success: boolean;
  output: string;
  artifacts: HarnessArtifact[];
  metrics?: Record<string, unknown>;
  error?: string;
}

export interface Harness {
  readonly id: string;
  readonly name: string;
  readonly type: "browser" | "code" | "local" | "custom";
  readonly capabilities: HarnessCapability[];
  status: "idle" | "running" | "completed" | "failed";
  spawn(input: HarnessExecutionInput): Promise<HarnessExecutionResult>;
}

export class HarnessRegistry {
  private harnesses = new Map<string, Harness>();

  register(harness: Harness): void {
    this.harnesses.set(harness.id, harness);
  }

  unregister(id: string): boolean {
    return this.harnesses.delete(id);
  }

  get(id: string): Harness | undefined {
    return this.harnesses.get(id);
  }

  all(): Harness[] {
    return Array.from(this.harnesses.values());
  }

  byCapability(capabilityName: string): Harness[] {
    return this.all().filter((h) => h.capabilities.some((c) => c.name === capabilityName));
  }

  byType(type: Harness["type"]): Harness[] {
    return this.all().filter((h) => h.type === type);
  }
}

export interface OrchestrationHarnessDeps {
  harnessRegistry: HarnessRegistry;
  executor: HarnessExecutorDeps;
  onEvent(event: HarnessEventLike): Promise<void> | void;
  saveWorkingSet(state: HarnessWorkingSetLike): Promise<void>;
  delegateSpecialist(input: {
    role: "claude-code" | "codex" | "general";
    taskDescription: string;
    context: string;
    workspaceId: string;
  }): Promise<{ success: boolean; result: string; error?: string }>;
  planner(input: HarnessPlannerInput): Promise<HarnessPlan[]>;
  validator(input: HarnessValidatorInput): Promise<HarnessValidationResult>;
  judge(input: HarnessJudgeInput): Promise<{ complete: boolean; gaps: string[]; summary: string; driftDetected?: boolean; driftGaps?: string[] }>;
  maxRounds?: number;
  /** Optional permission resolver for harness-level tool gating. */
  permissionResolver?: PermissionResolver;
}

export interface HarnessEventLike {
  id: string;
  sessionId: string;
  role: "main-assistant" | "goals" | "planner" | "harness" | "knowledge" | "validator" | "judge";
  kind:
    | "goal_defined"
    | "plan_updated"
    | "harness_action_started"
    | "harness_action_completed"
    | "action_denied"
    | "document_discovered"
    | "document_acquired"
    | "working_set_updated"
    | "validation_passed"
    | "validation_failed"
    | "judgment_requested"
    | "judgment_returned"
    | "specialist_spawned"
    | "specialist_completed"
    | "output_approved"
    | "output_rejected";
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HarnessWorkingSetLike {
  sessionId: string;
  entities: Record<string, unknown>[];
  documents: Array<{
    id: string;
    source: string;
    title: string;
    mimeType: string | null;
    filePath: string | null;
    sourceUrl: string | null;
    confidence: number;
    provenance: string[];
  }>;
  metrics: Record<string, unknown>[];
  gaps: string[];
  provenanceScore: number;
  updatedAt: string;
}

export interface HarnessPlan {
  summary: string;
  source: string;
  query: string;
  url: string;
  harnessId: string;
}

export interface HarnessPlannerInput {
  input: HarnessOrchestrationInput;
  workingSet: HarnessWorkingSetLike;
  round: number;
}

export interface HarnessValidatorInput {
  input: HarnessOrchestrationInput;
  workingSet: HarnessWorkingSetLike;
  round: number;
  plan: HarnessPlan;
  harnessResult: HarnessCollectionResult;
}

export interface HarnessJudgeInput {
  input: HarnessOrchestrationInput;
  workingSet: HarnessWorkingSetLike;
  round: number;
  validation: HarnessValidationResult;
  plan: HarnessPlan;
  harnessResult: HarnessCollectionResult;
  allResults: HarnessCollectionResult[];
}

export interface HarnessOrchestrationInput {
  sessionId: string;
  workspaceId: string;
  conversationId: string;
  runId: string;
  goal: string;
  supervisionMode: "watch" | "confirm";
  root: {
    kind: "outlook-thread";
    threadId: string;
    threadSubject: string;
    mailbox: string;
  };
  profileId?: string;
  qualityGates?: string[];
}

export interface HarnessCollectionResult {
  summary: string;
  source: string;
  query: string;
  observations: string[];
  documents: HarnessWorkingSetLike["documents"];
  metrics: Record<string, unknown>[];
  entities: Record<string, unknown>[];
  gaps: string[];
  provenanceScore: number;
}

export interface HarnessValidationResult {
  ok: boolean;
  gaps: string[];
}

export interface HarnessOrchestrationRunResult {
  status: "completed" | "failed" | "cancelled";
  runId: string;
  fullResponse: string;
  runError?: string;
}

export interface HarnessExecutorDeps {
  stealth_open(input: { profileId: string; url: string }): Promise<unknown>;
  stealth_scrape(input: { profileId: string; url?: string }): Promise<unknown>;
  stealth_download(input: { profileId: string; url: string; filename?: string }): Promise<unknown>;
  ingest_file(input: { filePath: string; workspaceId: string; sourceUrl?: string; profileId?: string }): Promise<unknown>;
  rag_retrieve(input: { query: string; workspaceId: string; limit?: number }): Promise<unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyWorkingSet(sessionId: string): HarnessWorkingSetLike {
  return {
    sessionId,
    entities: [],
    documents: [],
    metrics: [],
    gaps: [],
    provenanceScore: 0,
    updatedAt: nowIso(),
  };
}

function dedupeDocuments(existing: HarnessWorkingSetLike["documents"], incoming: HarnessWorkingSetLike["documents"]) {
  const seen = new Set(existing.map((doc) => doc.id));
  const merged = [...existing];
  for (const doc of incoming) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      merged.push(doc);
    }
  }
  return merged;
}

function mergeCollections<T extends Record<string, unknown>>(existing: T[], incoming: T[]): T[] {
  return [...existing, ...incoming];
}

function chooseSpecialistRole(goal: string): "claude-code" | "codex" | "general" {
  if (/\b(code|implement|refactor|build|script|module)\b/i.test(goal)) {
    return "codex";
  }
  return "general";
}

async function executeWithHarness(
  input: HarnessOrchestrationInput,
  plan: HarnessPlan,
  harnessRegistry: HarnessRegistry,
  executor: HarnessExecutorDeps,
  deps?: { onEvent?: (event: Omit<HarnessEventLike, "id" | "createdAt">) => Promise<void> | void; permissionResolver?: PermissionResolver },
): Promise<HarnessCollectionResult> {
  const harness = harnessRegistry.get(plan.harnessId) ?? harnessRegistry.byType("browser")[0];
  const profileId = input.profileId ?? input.workspaceId;
  const url = plan.url;

  const observations: string[] = [];
  const documents: HarnessWorkingSetLike["documents"] = [];
  const metrics: Record<string, unknown>[] = [];
  const entities: Record<string, unknown>[] = [];
  const gaps: string[] = [];
  let provenanceScore = 0.4;

  if (harness) {
    const harnessResult = await harness.spawn({
      task: plan.summary,
      context: JSON.stringify({ goal: input.goal, query: plan.query, url: plan.url, source: plan.source, round: 0 }),
      workspaceId: input.workspaceId,
      profileId,
      runId: input.runId,
      conversationId: input.conversationId,
    });

    if (harnessResult.success) {
      observations.push(harnessResult.output);
      if (harnessResult.metrics) {
        metrics.push(harnessResult.metrics);
      }
      if (harnessResult.artifacts && harnessResult.artifacts.length > 0) {
        for (const artifact of harnessResult.artifacts) {
          documents.push({
            id: crypto.randomUUID(),
            source: plan.source,
            title: artifact.name,
            mimeType: artifact.mimeType,
            filePath: artifact.path,
            sourceUrl: url,
            confidence: 0.85,
            provenance: [plan.summary, harness.id],
          });
        }
        provenanceScore += 0.3;
      }
    } else if (harnessResult.error) {
      gaps.push(`Harness ${harness.id} error: ${harnessResult.error}`);
    }
  }

  if (deps?.permissionResolver && !permitTool(["tools:browser"], deps.permissionResolver)) {
    await Promise.resolve(
      deps.onEvent?.({
        sessionId: input.sessionId,
        role: "harness",
        kind: "action_denied",
        summary: "Permission denied: tools:browser",
        payload: { plan: plan.summary, permissions: ["tools:browser"] },
      }),
    );
    gaps.push("Permission denied: tools:browser");
    provenanceScore = 0;
    return {
      summary: `${plan.summary}: browser tools denied`,
      source: plan.source,
      query: plan.query,
      observations,
      documents,
      metrics,
      entities,
      gaps,
      provenanceScore: Math.min(1, provenanceScore),
    };
  }

  // Fallback browser operations for URL-based collection even when no harness matched
  try {
    await executor.stealth_open({ profileId, url });
    const scrapeResult = await executor.stealth_scrape({ profileId, url });
    const retrieval = await executor.rag_retrieve({ query: plan.query, workspaceId: input.workspaceId, limit: 5 });

    if (scrapeResult && typeof scrapeResult === "object" && "text" in scrapeResult && typeof (scrapeResult as { text?: unknown }).text === "string") {
      const text = String((scrapeResult as { text?: string }).text ?? "").trim();
      if (text) {
        observations.push(text);
        documents.push({
          id: crypto.randomUUID(),
          source: plan.source,
          title: plan.summary,
          mimeType: "text/plain",
          filePath: null,
          sourceUrl: url,
          confidence: 0.78,
          provenance: [plan.summary],
        });
        provenanceScore += 0.2;
      }
    }

    if (retrieval && typeof retrieval === "object") {
      metrics.push({ kind: "retrieval", source: plan.source, query: plan.query, result: retrieval });
    }

    const urlLooksLikeDownload = /\.(pdf|xlsx?|csv|docx?)([?#].*)?$/i.test(url);
    const looksLikeDownloadPage = observations.length > 0 && observations[0].length < 200 && /download|export|save/i.test(observations[0]);
    if (urlLooksLikeDownload || looksLikeDownloadPage) {
      const download = await executor.stealth_download({ profileId, url, filename: `${plan.source}-${Date.now()}.bin` });
      if (download && typeof download === "object" && "filePath" in download && typeof (download as { filePath?: unknown }).filePath === "string") {
        const filePath = String((download as { filePath?: string }).filePath ?? "");
        if (filePath) {
          const ingestResult = await executor.ingest_file({
            filePath,
            workspaceId: input.workspaceId,
            sourceUrl: url,
            profileId,
          });
          metrics.push({ kind: "ingest", download, ingestResult });
          documents.push({
            id: crypto.randomUUID(),
            source: plan.source,
            title: plan.summary,
            mimeType: null,
            filePath,
            sourceUrl: url,
            confidence: 0.88,
            provenance: [plan.summary, "ingest_file"],
          });
          provenanceScore += 0.3;
        }
      }
    }
  } catch (err) {
    gaps.push(`Browser fallback error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (observations.length === 0) {
    gaps.push(`No direct evidence collected from ${plan.source} via ${plan.harnessId}`);
  }

  return {
    summary: `${plan.summary}: collected ${documents.length} document(s)`,
    source: plan.source,
    query: plan.query,
    observations,
    documents,
    metrics,
    entities,
    gaps,
    provenanceScore: Math.min(1, provenanceScore),
  };
}

export class OrchestrationRuntime {
  private deps: OrchestrationHarnessDeps;

  constructor(deps: OrchestrationHarnessDeps) {
    this.deps = deps;
  }

  private async emit(event: Omit<HarnessEventLike, "id" | "createdAt"> & Partial<Pick<HarnessEventLike, "id" | "createdAt">>): Promise<void> {
    await Promise.resolve(this.deps.onEvent({
      id: event.id ?? crypto.randomUUID(),
      createdAt: event.createdAt ?? nowIso(),
      ...event,
    }));
  }

  private async persistWorkingSet(state: HarnessWorkingSetLike): Promise<void> {
    state.updatedAt = nowIso();
    await this.deps.saveWorkingSet(state);
    await this.emit({
      sessionId: state.sessionId,
      role: "knowledge",
      kind: "working_set_updated",
      summary: `Working set now has ${state.documents.length} document(s) and ${state.gaps.length} gap(s)`,
      payload: { ...state },
    });
  }

  async run(input: HarnessOrchestrationInput): Promise<HarnessOrchestrationRunResult> {
    const maxRounds = this.deps.maxRounds ?? 3;
    let workingSet = emptyWorkingSet(input.sessionId);
    let lastJudge: { complete: boolean; gaps: string[]; summary: string } | null = null;
    let lastPlans: HarnessPlan[] = [];
    let lastHarnessResults: HarnessCollectionResult[] = [];

    await this.emit({
      sessionId: input.sessionId,
      role: "goals",
      kind: "goal_defined",
      summary: input.goal,
      payload: {
        goal: input.goal,
        supervisionMode: input.supervisionMode,
        root: input.root,
      },
    });

    for (let round = 0; round < maxRounds; round += 1) {
      lastPlans = await this.deps.planner({ input, workingSet, round });
      if (lastPlans.length === 0) {
        return {
          status: "failed",
          runId: input.runId,
          fullResponse: "Planner returned no harness plans",
          runError: "No harnesses selected for this round",
        };
      }

      await this.emit({
        sessionId: input.sessionId,
        role: "planner",
        kind: "plan_updated",
        summary: `${lastPlans.length} harness plan(s) for round ${round + 1}`,
        payload: { plans: lastPlans, round },
      });

      // Execute all plans in parallel
      const harnessPromises = lastPlans.map((plan) =>
        executeWithHarness(input, plan, this.deps.harnessRegistry, this.deps.executor, {
          onEvent: (event) => this.emit(event),
          permissionResolver: this.deps.permissionResolver,
        })
      );
      const settled = await Promise.allSettled(harnessPromises);

      lastHarnessResults = [];
      for (let i = 0; i < settled.length; i += 1) {
        const result = settled[i];
        const plan = lastPlans[i];
        if (result.status === "fulfilled") {
          lastHarnessResults.push(result.value);
          await this.emit({
            sessionId: input.sessionId,
            role: "harness",
            kind: "harness_action_completed",
            summary: result.value.summary,
            payload: { plan, round, harnessId: plan.harnessId, ...result.value },
          });
        } else {
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
          lastHarnessResults.push({
            summary: `Harness ${plan.harnessId} failed: ${reason}`,
            source: plan.source,
            query: plan.query,
            observations: [],
            documents: [],
            metrics: [{ kind: "harness_error", harnessId: plan.harnessId, error: reason }],
            entities: [],
            gaps: [`Harness ${plan.harnessId} failed: ${reason}`],
            provenanceScore: 0,
          });
          await this.emit({
            sessionId: input.sessionId,
            role: "harness",
            kind: "harness_action_completed",
            summary: `Harness ${plan.harnessId} failed: ${reason}`,
            payload: { plan, round, harnessId: plan.harnessId, error: reason },
          });
        }
      }

      // Merge all successful results into working set
      for (const result of lastHarnessResults) {
        workingSet = {
          ...workingSet,
          entities: mergeCollections(workingSet.entities, result.entities),
          documents: dedupeDocuments(workingSet.documents, result.documents),
          metrics: mergeCollections(workingSet.metrics, result.metrics),
          gaps: [...new Set([...workingSet.gaps, ...result.gaps])],
          provenanceScore: Math.max(workingSet.provenanceScore, result.provenanceScore),
          updatedAt: nowIso(),
        };
      }
      await this.persistWorkingSet(workingSet);

      // Validate the merged working set (first plan's perspective, or all combined)
      const validation = await this.deps.validator({
        input,
        workingSet,
        round,
        plan: lastPlans[0],
        harnessResult: lastHarnessResults[0],
      });
      await this.emit({
        sessionId: input.sessionId,
        role: "validator",
        kind: validation.ok ? "validation_passed" : "validation_failed",
        summary: validation.gaps.length > 0 ? validation.gaps.join("; ") : "Validation passed",
        payload: validation as unknown as Record<string, unknown>,
      });

      await this.emit({
        sessionId: input.sessionId,
        role: "judge",
        kind: "judgment_requested",
        summary: "Judge working set sufficiency",
        payload: {
          goal: input.goal,
          round,
          validation,
          qualityGates: input.qualityGates ?? [],
        },
      });

      lastJudge = await this.deps.judge({
        input,
        workingSet,
        round,
        validation,
        plan: lastPlans[0],
        harnessResult: lastHarnessResults[0],
        allResults: lastHarnessResults,
      });
      await this.emit({
        sessionId: input.sessionId,
        role: "judge",
        kind: "judgment_returned",
        summary: lastJudge.summary,
        payload: lastJudge as unknown as Record<string, unknown>,
      });

      workingSet = {
        ...workingSet,
        gaps: [...new Set(lastJudge.gaps)],
        updatedAt: nowIso(),
      };
      await this.persistWorkingSet(workingSet);

      if (lastJudge.complete) {
        break;
      }
    }

    if (!lastJudge?.complete) {
      return {
        status: "failed",
        runId: input.runId,
        fullResponse: lastJudge?.summary ?? "Orchestration did not reach completion",
        runError: `Maximum rounds reached with gaps: ${(lastJudge?.gaps ?? workingSet.gaps).join("; ") || "unknown"}`,
      };
    }

    const specialistRole = chooseSpecialistRole(input.goal);
    await this.emit({
      sessionId: input.sessionId,
      role: "main-assistant",
      kind: "specialist_spawned",
      summary: `Delegating final output to ${specialistRole}`,
      payload: {
        role: specialistRole,
        goal: input.goal,
      },
    });

    const specialistResult = await this.deps.delegateSpecialist({
      role: specialistRole,
      taskDescription: input.goal,
      context: JSON.stringify({
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        root: input.root,
        workingSet,
        plans: lastPlans,
        harnessResults: lastHarnessResults,
        judge: lastJudge,
      }, null, 2),
      workspaceId: input.workspaceId,
    });

    await this.emit({
      sessionId: input.sessionId,
      role: "main-assistant",
      kind: specialistResult.success ? "specialist_completed" : "output_rejected",
      summary: specialistResult.success ? "Specialist output completed" : specialistResult.error ?? "Specialist output failed",
      payload: specialistResult as unknown as Record<string, unknown>,
    });

    if (!specialistResult.success) {
      return {
        status: "failed",
        runId: input.runId,
        fullResponse: specialistResult.result,
        runError: specialistResult.error ?? "Specialist delegation failed",
      };
    }

    return {
      status: "completed",
      runId: input.runId,
      fullResponse: specialistResult.result,
    };
  }
}
