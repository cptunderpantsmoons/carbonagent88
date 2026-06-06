/**
 * Agent Runner — Shared execution logic for both IPC and watcher triggers.
 */

import { AgentRuntime, BrowserOrchestrationRuntime, type ToolExecutor } from "@carbon-agent/core-runtime";
import { CarbonDatabase, createRunLog, getVaultDir, dbStoreMemory, dbRecallMemories, dbStoreSkill, hashEmbed, dbGetModelRole } from "@carbon-agent/local-store";
import { parseFile, chunkText, storeChunks, searchChunks, getEmbeddingProvider } from "@carbon-agent/ingestion";
import { generateDocument } from "./document-generator.js";
import { stealthOpen, stealthScrape, stealthDownload } from "@carbon-agent/cloak-bridge";
import fs from "node:fs";
import path from "node:path";
import { emitAgentTopology, emitVaultChange } from "./desktop-events.js";
import { emitSessionEvent, emitSessionUpdate, emitSessionWorkingSet } from "./session-events.js";
import { recordGeneratedDocument } from "./document-records.js";
import { spawnCliSubAgent, type CliType } from "./cli-subagent.js";
import type { DesktopTopologyEdge, DesktopTopologyNode } from "./desktop-events.js";

export interface RunAgentInput {
  db: CarbonDatabase;
  workspaceId: string;
  conversationId: string;
  providerId: string;
  message: string;
  maxSteps?: number;
  runId?: string;
  defaultProfileId?: string;
  onRuntime?: (runtime: { cancel(): void }) => void;
  sessionId?: string;
  sessionGoal?: string;
  sessionRoot?: {
    kind: "outlook-thread";
    threadId: string;
    threadSubject: string;
    mailbox: string;
  };
  supervisionMode?: "watch" | "confirm";
}

export interface RunAgentResult {
  runStatus: "completed" | "failed" | "cancelled";
  fullResponse: string;
  runError?: string;
  runId: string;
}

type SessionStore = CarbonDatabase & {
  appendSessionEvent(p: { id: string; sessionId: string; role: string; kind: string; summary: string; payloadJson: string }): Promise<void>;
  saveSessionWorkingSet(p: {
    sessionId: string;
    entitiesJson: string;
    documentsJson: string;
    metricsJson: string;
    gapsJson: string;
    provenanceScore: number;
  }): Promise<void>;
  updateOrchestrationSessionStatus(id: string, status: string, completionSummary?: string | null): Promise<void>;
};

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { db, workspaceId, conversationId, providerId, message, maxSteps = 50 } = input;
  const runId = input.runId ?? crypto.randomUUID();

  let logPath: string;
  const existingRun = await db.getRun(runId);
  if (existingRun) {
    logPath = String(existingRun.jsonl_log_path);
    if (!fs.existsSync(logPath)) {
      logPath = createRunLog(runId);
    }
  } else {
    logPath = createRunLog(runId);
    await db.createRun({ id: runId, conversationId, workspaceId, providerId, jsonlLogPath: logPath });
  }

  // Look up role-specific provider (assistant role for main agent runs)
  const assistantRole = await dbGetModelRole(workspaceId, "assistant");
  const effectiveProviderId = assistantRole?.provider_id ?? providerId;

  const providerRow = await db.getProviderWithKey(effectiveProviderId);
  if (!providerRow) throw new Error("Provider not found");

  const providerConfig = {
    id: providerRow.id as string,
    type: providerRow.type as "anthropic" | "openai" | "custom-openai",
    name: providerRow.name as string,
    apiKey: providerRow.api_key as string,
    baseUrl: providerRow.base_url as string | undefined,
    model: providerRow.model as string,
    createdAt: providerRow.created_at as string,
    updatedAt: providerRow.updated_at as string,
  };

  await db.updateRunStatus(runId, "running", { model: providerConfig.model, startedAt: new Date().toISOString() });
  await db.addMessage({ id: crypto.randomUUID(), conversationId, role: "user", content: message });

  const topologyNodes = new Map<string, DesktopTopologyNode>([
    ["supervisor", { id: "supervisor", label: "Supervisor", status: "running", x: 120, y: 80 }],
  ]);
  const topologyEdges: DesktopTopologyEdge[] = [];
  let lastTopologyNodeId = "supervisor";

  const emitTopology = (status: DesktopTopologyNode["status"]): void => {
    const supervisor = topologyNodes.get("supervisor");
    if (supervisor) {
      supervisor.status = status;
      topologyNodes.set("supervisor", supervisor);
    }
    emitAgentTopology({
      runId,
      nodes: Array.from(topologyNodes.values()),
      edges: topologyEdges,
    });
  };

  emitTopology("running");

  const abortController = new AbortController();

  const executor: ToolExecutor = {
    stealth_interact: async () => ({ success: true } as unknown),
    stealth_screenshot: async () => ({ success: true } as unknown),
    stealth_evaluate: async () => ({ success: true } as unknown),
    stealth_axtree: async () => ({ success: true } as unknown),
    graph_query: async () => ({ success: true, nodes: [], edges: [] } as unknown),
    generate_document: async (payload: Record<string, unknown>) => {
      const result = await generateDocument({
        workspaceId: payload.workspaceId as string,
        title: (payload.title as string) ?? "Untitled",
        content: payload.content as string,
        format: payload.format as "markdown" | "docx" | "pdf",
      });
      await recordGeneratedDocument(db, {
        workspaceId: payload.workspaceId as string,
        title: (payload.title as string) ?? "Untitled",
        content: payload.content as string,
        filePath: result.filePath,
        format: payload.format as "markdown" | "docx" | "pdf",
      });
      return result as unknown;
    },
    recall_skill: async () => ({ success: true } as unknown),
    store_skill: async () => ({ success: true } as unknown),
    vault_read: async () => ({ success: true } as unknown),
    vault_write: async () => ({ success: true } as unknown),
    vault_link: async () => ({ success: true } as unknown),
    stealth_open: async (payload: Record<string, unknown>) => stealthOpen({ profileId: (payload.profileId as string | undefined) ?? input.defaultProfileId ?? "", url: payload.url as string }),
    stealth_scrape: async (payload: Record<string, unknown>) => stealthScrape({ profileId: (payload.profileId as string | undefined) ?? input.defaultProfileId ?? "", url: payload.url as string }),
    stealth_download: async (payload: Record<string, unknown>) => stealthDownload({ profileId: (payload.profileId as string | undefined) ?? input.defaultProfileId ?? "", url: payload.url as string, filename: payload.filename as string }),
    ingest_file: async (payload: Record<string, unknown>) => {
      const filePath = payload.filePath as string;
      const parsed = parseFile(filePath, { sourceUrl: payload.sourceUrl as string | undefined, profileId: payload.profileId as string | undefined });
      const dataSourceId = crypto.randomUUID();
      let fileSizeBytes: number | undefined;
      try { fileSizeBytes = fs.statSync(filePath).size; } catch { /* ignore */ }
      await db.createDataSource({ id: dataSourceId, workspaceId: payload.workspaceId as string, type: payload.profileId ? "browser_download" : "file", name: path.basename(filePath), path: filePath, mimeType: parsed.mimeType, sizeBytes: fileSizeBytes, sourceUrl: payload.sourceUrl as string | undefined, profileId: payload.profileId as string | undefined });
      const documentId = crypto.randomUUID();
      await db.createDocument({ id: documentId, workspaceId: payload.workspaceId as string, dataSourceId, title: parsed.title, content: parsed.content });
      const jobId = crypto.randomUUID();
      await db.createIngestionJob({ id: jobId, documentId });
      const chunks = chunkText(parsed.content, { chunkSize: 1000, overlap: 200 });
      const embedder = await getEmbeddingProvider();
      const embeddings = await embedder.embed(chunks.map((c) => c.content));
      const stored = chunks.map((c, i) => ({ id: crypto.randomUUID(), documentId, workspaceId: payload.workspaceId as string, chunkIndex: c.index, content: c.content, embedding: embeddings[i], sourceUrl: parsed.sourceUrl, sourceProfileId: parsed.profileId }));
      await storeChunks(stored);
      await db.updateDocumentChunkCount(documentId, stored.length);
      await db.updateIngestionJob(jobId, { status: "completed", chunksCreated: stored.length });
      return { success: true, chunksCreated: stored.length, documentId, documentTitle: parsed.title };
    },
    rag_retrieve: async (payload: Record<string, unknown>) => {
      const results = await searchChunks(payload.workspaceId as string, payload.query as string, (payload.limit as number) ?? 5);
      return { success: true, chunks: results.map((r) => ({ content: r.content, sourceUrl: r.sourceUrl })) };
    },
    write_note: async (payload: Record<string, unknown>) => {
      const vaultDir = getVaultDir(payload.workspaceId as string);
      if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
      const notePath = path.join(vaultDir, `${(payload.title as string).replace(/[^a-zA-Z0-9]/g, "_")}.md`);
      const noteContent = `# ${payload.title}\n\n${payload.content}`;
      fs.writeFileSync(notePath, noteContent);
      emitVaultChange({ workspaceId: payload.workspaceId as string, filePath: path.relative(vaultDir, notePath).split(path.sep).join("/"), content: noteContent });

      // Auto-store memory for semantic recall
      try {
        const memId = crypto.randomUUID();
        await dbStoreMemory({
          id: memId,
          workspaceId: payload.workspaceId as string,
          key: payload.title as string,
          content: (payload.content as string).slice(0, 500),
          tags: ["vault-note"],
          source: "vault-write",
          importance: 0.6,
        });
      } catch { /* memory extraction is best-effort */ }

      return { success: true, filePath: notePath };
    },
    delegate_task: async (payload: Record<string, unknown>) => {
      const role = payload.targetAgentRole as string;
      const task = payload.taskDescription as string;
      const context = payload.context as string | undefined;
      const wsId = payload.workspaceId as string;

      // CLI sub-agents
      if (role === "claude-code" || role === "codex") {
        const workspaceDir = getVaultDir(wsId);
        if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

        const result = await spawnCliSubAgent({
          cli: role as CliType,
          task,
          context,
          workspaceDir,
          runId,
          logPath,
          signal: abortController.signal,
        });

        return {
          success: result.success,
          subAgentRole: role,
          result: result.result,
          stepsTaken: 0,
          toolCalls: [],
          error: result.error,
          cliNotFound: result.cliNotFound,
          installCommand: result.installCommand,
        };
      }

      // In-process sub-agent: create a stripped executor (no delegate_task to prevent recursion)
      const subExecutor: ToolExecutor = {
        stealth_open: executor.stealth_open,
        stealth_scrape: executor.stealth_scrape,
        stealth_download: executor.stealth_download,
        stealth_interact: executor.stealth_interact,
        stealth_screenshot: executor.stealth_screenshot,
        stealth_evaluate: executor.stealth_evaluate,
        stealth_axtree: executor.stealth_axtree,
        ingest_file: executor.ingest_file,
        rag_retrieve: executor.rag_retrieve,
        graph_query: executor.graph_query,
        generate_document: executor.generate_document,
        write_note: executor.write_note,
        recall_skill: executor.recall_skill,
        store_skill: executor.store_skill,
        vault_read: executor.vault_read,
        vault_write: executor.vault_write,
        vault_link: executor.vault_link,
        memory_recall: async () => ({ success: false, memories: [] }),
        memory_store: async () => ({ success: false }),
        delegate_task: async () => ({ success: false, error: "Nested delegation is not allowed" }),
      };

      const subRunId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const subMaxSteps = (payload.maxSteps as number) ?? 20;
      const systemPrompt = `You are a ${role} sub-agent. Complete the assigned task using available tools. Be thorough and return clear results.\n\nTask from supervisor: ${task}\n\nAdditional context: ${context ?? "None"}`;

      // Look up role-specific provider for the sub-agent
      const roleToModelRole: Record<string, "coder" | "knowledge-graph" | "meeting-notes"> = {
        coder: "coder",
        researcher: "knowledge-graph",
        extractor: "knowledge-graph",
        drafter: "meeting-notes",
      };
      const mappedRole = roleToModelRole[role];
      let subProviderConfig = providerConfig;
      if (mappedRole) {
        const roleProvider = await dbGetModelRole(wsId, mappedRole);
        if (roleProvider?.provider_id) {
          const roleProviderRow = await db.getProviderWithKey(roleProvider.provider_id);
          if (roleProviderRow) {
            subProviderConfig = {
              id: roleProviderRow.id as string,
              type: roleProviderRow.type as "anthropic" | "openai" | "custom-openai",
              name: roleProviderRow.name as string,
              apiKey: roleProviderRow.api_key as string,
              baseUrl: roleProviderRow.base_url as string | undefined,
              model: roleProviderRow.model as string,
              createdAt: roleProviderRow.created_at as string,
              updatedAt: roleProviderRow.updated_at as string,
            };
          }
        }
      }

      const subRuntime = new AgentRuntime(
        { providerConfig: subProviderConfig, runId: subRunId, workspaceId: wsId, conversationId, maxSteps: subMaxSteps, systemPrompt },
        subExecutor,
      );

      const toolCalls: { name: string; input: Record<string, unknown>; output?: unknown }[] = [];
      let stepsTaken = 0;
      let finalResult = "";

      const fullPrompt = context ? `Task: ${task}\n\nContext:\n${context}` : task;

      for await (const event of subRuntime.run(fullPrompt)) {
        if (event.type === "tool" && event.step?.toolCalls) {
          stepsTaken = event.step.step;
          for (const tc of event.step.toolCalls) {
            toolCalls.push({ name: tc.name, input: tc.input, output: tc.output });
          }
        } else if (event.type === "text" && event.content) {
          finalResult = event.content;
        }
      }

      return {
        success: true,
        subAgentRole: role,
        result: finalResult || "(no textual result)",
        stepsTaken,
        toolCalls,
      };
    },
    memory_recall: async (payload: Record<string, unknown>) => {
      const memories = await dbRecallMemories(
        payload.workspaceId as string,
        payload.query as string,
        (payload.limit as number) ?? 5,
      );
      return {
        success: true,
        memories: memories.map((m) => ({
          id: m.id,
          key: m.key,
          content: m.content,
          tags: JSON.parse(m.tags_json) as string[],
          source: m.source,
          importance: m.importance,
        })),
      };
    },
    memory_store: async (payload: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      await dbStoreMemory({
        id,
        workspaceId: payload.workspaceId as string,
        key: payload.key as string,
        content: payload.content as string,
        tags: payload.tags as string[] | undefined,
        source: "agent",
        importance: 0.7,
      });
      return { success: true, id, key: payload.key };
    },
  };

  const runtime = new AgentRuntime({ providerConfig, runId, workspaceId, conversationId, maxSteps }, executor);
  input.onRuntime?.({
    cancel() {
      abortController.abort();
      runtime.cancel();
    },
  });
  let fullResponse = "";
  let runStatus: "completed" | "failed" | "cancelled" = "completed";
  let runError: string | undefined;
  const runToolCalls: { name: string; input: Record<string, unknown>; output?: unknown }[] = [];

  if (input.sessionId && input.sessionGoal && input.sessionRoot) {
    const sessionId = input.sessionId;
    const sessionGoal = input.sessionGoal;
    const sessionRoot = input.sessionRoot;
    const sessionDb = db as SessionStore;
    await sessionDb.updateOrchestrationSessionStatus(sessionId, "running");
    emitTopology("running");

    const browserOrchestrationDeps: ConstructorParameters<typeof BrowserOrchestrationRuntime>[0] = {
      maxRounds: maxSteps,
      onEvent: async (event) => {
        await sessionDb.appendSessionEvent({
          id: event.id,
          sessionId,
          role: event.role,
          kind: event.kind,
          summary: event.summary,
          payloadJson: JSON.stringify(event.payload ?? {}),
        });
        emitSessionEvent({
          sessionId,
          event: {
            id: event.id,
            sessionId,
            role: event.role,
            kind: event.kind,
            summary: event.summary,
            payload: event.payload ?? {},
            createdAt: new Date().toISOString(),
          },
        });

        if (event.kind === "working_set_updated") {
          const payload = event.payload as {
            documents?: unknown[];
            gaps?: string[];
            provenanceScore?: number;
          };
          emitSessionWorkingSet({
            sessionId,
            documents: Array.isArray(payload.documents) ? payload.documents : [],
            gaps: Array.isArray(payload.gaps) ? payload.gaps : [],
            provenanceScore: typeof payload.provenanceScore === "number" ? payload.provenanceScore : 0,
          });
        }
      },
      saveWorkingSet: async (state) => {
        await sessionDb.saveSessionWorkingSet({
          sessionId: state.sessionId,
          entitiesJson: JSON.stringify(state.entities),
          documentsJson: JSON.stringify(state.documents),
          metricsJson: JSON.stringify(state.metrics),
          gapsJson: JSON.stringify(state.gaps),
          provenanceScore: state.provenanceScore,
        });
      },
      delegateSpecialist: async ({ role, taskDescription, context, workspaceId: delegateWorkspaceId }) => {
        const specialistRunId = `${runId}-session-specialist`;
        const specialistRuntime = new AgentRuntime(
          {
            providerConfig,
            runId: specialistRunId,
            workspaceId: delegateWorkspaceId,
            conversationId,
            maxSteps: 20,
            systemPrompt: `You are a ${role} output specialist. Turn validated evidence into the final deliverable.`,
          },
          executor,
        );

        let specialistResult = "";
        try {
          for await (const event of specialistRuntime.run(`${taskDescription}\n\n${context}`)) {
            if (event.type === "text" && event.content) {
              specialistResult += event.content;
            }
          }
          return { success: true, result: specialistResult || taskDescription };
        } catch (error: unknown) {
          return {
            success: false,
            result: specialistResult,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      browserTools: {
        stealth_open: executor.stealth_open,
        stealth_scrape: executor.stealth_scrape,
        stealth_download: executor.stealth_download,
        ingest_file: executor.ingest_file,
        rag_retrieve: executor.rag_retrieve,
      },
      planner: async ({ round, workingSet }) => ({
        summary: round === 0
          ? `Collect evidence for ${sessionGoal}`
          : `Resolve remaining gaps for ${sessionGoal}`,
        source: round === 0 ? sessionRoot.kind : "xero",
        query: round === 0 ? sessionRoot.threadSubject : (workingSet.gaps[0] ?? sessionGoal),
      }),
      validator: async ({ workingSet }) => ({
        ok: workingSet.documents.length > 0,
        gaps: workingSet.documents.length > 0 ? [] : ["No supporting documents collected"],
      }),
      judge: async ({ workingSet, validation }) => ({
        complete: validation.ok && workingSet.documents.length > 0,
        gaps: validation.gaps.length > 0 ? validation.gaps : (workingSet.documents.length > 0 ? [] : ["Need evidence"]),
        summary: validation.ok ? "Evidence sufficient" : "Evidence incomplete",
      }),
    };
    const browserOrchestration = new BrowserOrchestrationRuntime(browserOrchestrationDeps);

    const sessionResult = await browserOrchestration.run({
      sessionId,
      workspaceId,
      conversationId,
      runId,
      goal: input.sessionGoal,
      supervisionMode: input.supervisionMode ?? "watch",
      root: input.sessionRoot,
      profileId: input.defaultProfileId,
    });

    const sessionRunStatus = sessionResult.status;
    const sessionFullResponse = sessionResult.fullResponse;
    const sessionRunError = sessionResult.runError;

    if (sessionRunStatus === "completed" && !sessionRunError) {
      emitTopology("completed");
    } else {
      emitTopology("failed");
    }

    await sessionDb.updateRunStatus(runId, sessionRunStatus, { completedAt: new Date().toISOString() });
    await sessionDb.addMessage({ id: crypto.randomUUID(), conversationId, role: "assistant", content: sessionFullResponse });
    emitSessionUpdate({ sessionId, status: sessionRunStatus, currentGoal: input.sessionGoal });

    try {
      const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), runId, status: sessionRunStatus, error: sessionRunError ?? null }) + "\n";
      fs.appendFileSync(logPath, logEntry);
    } catch { /* ignore log write errors */ }

    return { runStatus: sessionRunStatus, fullResponse: sessionFullResponse, runError: sessionRunError, runId };
  }

  try {
    for await (const event of runtime.run(message)) {
      if (event.type === "text" && event.content) {
        fullResponse += event.content;
      } else if (event.type === "error") {
        fullResponse += `\n[Error: ${event.error}]`;
        runError = event.error;
      } else if (event.type === "tool" && event.step?.toolCalls) {
        let stepIndex = 0;
        for (const toolCall of event.step.toolCalls) {
          runToolCalls.push({ name: toolCall.name, input: toolCall.input as Record<string, unknown>, output: toolCall.output });
          const nodeId = `${runId}:${event.step.step}:${stepIndex}`;
          const status: DesktopTopologyNode["status"] = toolCall.error ? "failed" : "completed";
          const label = toolCall.name === "delegate_task"
            ? `Sub-Agent: ${String((toolCall.input as Record<string, unknown>)?.targetAgentRole ?? "unknown")}`
            : toolCall.name;
          topologyNodes.set(nodeId, {
            id: nodeId,
            label,
            status,
            x: 320 + (event.step.step * 180),
            y: 80 + (stepIndex * 110),
          });
          topologyEdges.push({ from: lastTopologyNodeId, to: nodeId });
          lastTopologyNodeId = nodeId;
          stepIndex += 1;
        }
        emitTopology("running");
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fullResponse += `\n[Runtime Error: ${msg}]`;
    runError = msg;
    runStatus = "failed";
  } finally {
    const currentRun = await db.getRun(runId);
    if (currentRun?.status === "cancelled") {
      runStatus = "cancelled";
    } else if (runError) {
      runStatus = "failed";
    }
    await db.updateRunStatus(runId, runStatus, { completedAt: new Date().toISOString() });
    await db.addMessage({ id: crypto.randomUUID(), conversationId, role: "assistant", content: fullResponse });
    emitTopology(runStatus === "completed" ? "completed" : "failed");

    // Auto-skill creation: if run succeeded with 3+ tool calls, learn a skill
    if (runStatus === "completed" && runToolCalls.length >= 3 && !runError) {
      try {
        const trigger = message.slice(0, 200);
        const skillName = `Auto: ${message.slice(0, 60)}`;
        const toolSequence = runToolCalls.map((tc) => ({
          toolName: tc.name,
          input: tc.input,
          notes: tc.output ? "completed" : undefined,
        }));
        const skillId = crypto.randomUUID();
        const triggerEmbedding = hashEmbed(trigger);
        await dbStoreSkill({
          id: skillId,
          workspaceId,
          trigger,
          triggerEmbedding,
          name: skillName,
          description: `Automatically learned from successful run (${runToolCalls.length} steps)`,
          toolSequence,
        });
      } catch { /* auto-skill is best-effort */ }
    }

    try {
      const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), runId, status: runStatus, error: runError ?? null }) + "\n";
      fs.appendFileSync(logPath, logEntry);
    } catch { /* ignore log write errors */ }
  }

  return { runStatus, fullResponse, runError, runId };
}
