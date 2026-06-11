import { randomUUID } from "node:crypto";

export interface BrowserOrchestrationInput {
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
}

export interface BrowserOrchestrationWorkingSet {
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

export interface BrowserOrchestrationPlannerInput {
  input: BrowserOrchestrationInput;
  workingSet: BrowserOrchestrationWorkingSet;
  round: number;
}

export interface BrowserOrchestrationValidatorInput {
  input: BrowserOrchestrationInput;
  workingSet: BrowserOrchestrationWorkingSet;
  round: number;
  plan: BrowserPlan;
  browserResult: BrowserCollectionResult;
}

export interface BrowserOrchestrationJudgeInput {
  input: BrowserOrchestrationInput;
  workingSet: BrowserOrchestrationWorkingSet;
  round: number;
  validation: BrowserValidationResult;
  plan: BrowserPlan;
  browserResult: BrowserCollectionResult;
}

export interface BrowserPlan {
  summary: string;
  source: string;
  query: string;
  url: string;
}

export interface BrowserCollectionResult {
  summary: string;
  source: string;
  query: string;
  observations: string[];
  documents: BrowserOrchestrationWorkingSet["documents"];
  metrics: Record<string, unknown>[];
  entities: Record<string, unknown>[];
  gaps: string[];
  provenanceScore: number;
}

export interface BrowserValidationResult {
  ok: boolean;
  gaps: string[];
}

export interface BrowserOrchestrationRuntimeDeps {
  onEvent(event: SessionEventLike): Promise<void> | void;
  saveWorkingSet(state: BrowserOrchestrationWorkingSet): Promise<void>;
  delegateSpecialist(input: {
    role: "claude-code" | "codex" | "general";
    taskDescription: string;
    context: string;
    workspaceId: string;
  }): Promise<{ success: boolean; result: string; error?: string }>;
  browserTools: {
    stealth_open(input: { profileId: string; url: string }): Promise<unknown>;
    stealth_scrape(input: { profileId: string; url?: string }): Promise<unknown>;
    stealth_download(input: { profileId: string; url: string; filename?: string }): Promise<unknown>;
    ingest_file(input: { filePath: string; workspaceId: string; sourceUrl?: string; profileId?: string }): Promise<unknown>;
    rag_retrieve(input: { query: string; workspaceId: string; limit?: number }): Promise<unknown>;
  };
  planner(input: BrowserOrchestrationPlannerInput): Promise<BrowserPlan[]>;
  validator(input: BrowserOrchestrationValidatorInput): Promise<BrowserValidationResult>;
  judge(input: BrowserOrchestrationJudgeInput): Promise<{ complete: boolean; gaps: string[]; summary: string }>;
  maxRounds?: number;
}

export interface SessionEventLike {
  id: string;
  sessionId: string;
  role: "main-assistant" | "goals" | "planner" | "browser" | "knowledge" | "validator" | "judge";
  kind:
    | "goal_defined"
    | "plan_updated"
    | "browser_action_started"
    | "browser_action_completed"
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

export interface BrowserOrchestrationRunResult {
  status: "completed" | "failed" | "cancelled";
  runId: string;
  fullResponse: string;
  runError?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyWorkingSet(sessionId: string): BrowserOrchestrationWorkingSet {
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

function dedupeDocuments(existing: BrowserOrchestrationWorkingSet["documents"], incoming: BrowserOrchestrationWorkingSet["documents"]) {
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

async function collectWithBrowserTools(
  input: BrowserOrchestrationInput,
  plan: BrowserPlan,
  browserTools: BrowserOrchestrationRuntimeDeps["browserTools"],
): Promise<BrowserCollectionResult> {
  const profileId = input.profileId ?? input.workspaceId;
  const url = plan.url;

  await browserTools.stealth_open({ profileId, url });
  const scrapeResult = await browserTools.stealth_scrape({ profileId, url });
  const retrieval = await browserTools.rag_retrieve({ query: plan.query, workspaceId: input.workspaceId, limit: 5 });

  const documents: BrowserOrchestrationWorkingSet["documents"] = [];
  const observations: string[] = [];
  const metrics: Record<string, unknown>[] = [];
  const entities: Record<string, unknown>[] = [];
  const gaps: string[] = [];
  let provenanceScore = 0.4;

  if (scrapeResult && typeof scrapeResult === "object" && "text" in scrapeResult && typeof (scrapeResult as { text?: unknown }).text === "string") {
    const text = String((scrapeResult as { text?: string }).text ?? "").trim();
    if (text) {
      observations.push(text);
      documents.push({
        id: randomUUID(),
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
    const download = await browserTools.stealth_download({ profileId, url, filename: `${plan.source}-${Date.now()}.bin` });
    if (download && typeof download === "object" && "filePath" in download && typeof (download as { filePath?: unknown }).filePath === "string") {
      const filePath = String((download as { filePath?: string }).filePath ?? "");
      if (filePath) {
        const ingestResult = await browserTools.ingest_file({
          filePath,
          workspaceId: input.workspaceId,
          sourceUrl: url,
          profileId,
        });
        metrics.push({ kind: "ingest", download, ingestResult });
        documents.push({
          id: randomUUID(),
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

  if (observations.length === 0) {
    gaps.push(`No direct evidence collected from ${plan.source}`);
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

/**
 * BrowserOrchestrationRuntime
 * Explicit orchestration loop for session-rooted browser collection.
 */
export class BrowserOrchestrationRuntime {
  private deps: BrowserOrchestrationRuntimeDeps;

  constructor(deps: BrowserOrchestrationRuntimeDeps) {
    this.deps = deps;
  }

  private async emit(event: Omit<SessionEventLike, "id" | "createdAt"> & Partial<Pick<SessionEventLike, "id" | "createdAt">>): Promise<void> {
    await Promise.resolve(this.deps.onEvent({
      id: event.id ?? randomUUID(),
      createdAt: event.createdAt ?? nowIso(),
      ...event,
    }));
  }

  private async persistWorkingSet(state: BrowserOrchestrationWorkingSet): Promise<void> {
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

  async run(input: BrowserOrchestrationInput): Promise<BrowserOrchestrationRunResult> {
    const maxRounds = this.deps.maxRounds ?? 3;
    let workingSet = emptyWorkingSet(input.sessionId);
    let lastJudge: { complete: boolean; gaps: string[]; summary: string } | null = null;
    let lastPlan: BrowserPlan | null = null;
    let lastBrowserResult: BrowserCollectionResult | null = null;

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
      const plans = await this.deps.planner({ input, workingSet, round });
      lastPlan = plans[0] ?? null;
      await this.emit({
        sessionId: input.sessionId,
        role: "planner",
        kind: "plan_updated",
        summary: lastPlan.summary,
        payload: lastPlan as unknown as Record<string, unknown>,
      });

      await this.emit({
        sessionId: input.sessionId,
        role: "browser",
        kind: "browser_action_started",
        summary: lastPlan.summary,
        payload: { plan: lastPlan, round },
      });

      lastBrowserResult = await collectWithBrowserTools(input, lastPlan, this.deps.browserTools);
      await this.emit({
        sessionId: input.sessionId,
        role: "browser",
        kind: "browser_action_completed",
        summary: lastBrowserResult.summary,
        payload: lastBrowserResult as unknown as Record<string, unknown>,
      });

      workingSet = {
        ...workingSet,
        entities: mergeCollections(workingSet.entities, lastBrowserResult.entities),
        documents: dedupeDocuments(workingSet.documents, lastBrowserResult.documents),
        metrics: mergeCollections(workingSet.metrics, lastBrowserResult.metrics),
        gaps: [...new Set([...workingSet.gaps, ...lastBrowserResult.gaps])],
        provenanceScore: Math.max(workingSet.provenanceScore, lastBrowserResult.provenanceScore),
        updatedAt: nowIso(),
      };
      await this.persistWorkingSet(workingSet);

      const validation = await this.deps.validator({
        input,
        workingSet,
        round,
        plan: lastPlan,
        browserResult: lastBrowserResult,
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
        },
      });

      lastJudge = await this.deps.judge({
        input,
        workingSet,
        round,
        validation,
        plan: lastPlan,
        browserResult: lastBrowserResult,
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
        plan: lastPlan,
        browserResult: lastBrowserResult,
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
