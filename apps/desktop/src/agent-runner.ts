/**
 * Agent Runner — Shared execution logic for both IPC and watcher triggers.
 */

import { AgentRuntime, type ToolExecutor } from "@carbon-agent/core-runtime";
import { CarbonDatabase, createRunLog, getVaultDir } from "@carbon-agent/local-store";
import { parseFile, chunkText, storeChunks, searchChunks, getEmbeddingProvider } from "@carbon-agent/ingestion";
import { generateDocument } from "./document-generator.js";
import { stealthOpen, stealthScrape, stealthDownload } from "@carbon-agent/cloak-bridge";
import fs from "node:fs";
import path from "node:path";

export interface RunAgentInput {
  db: CarbonDatabase;
  workspaceId: string;
  conversationId: string;
  providerId: string;
  message: string;
  maxSteps?: number;
  runId?: string;
}

export interface RunAgentResult {
  runStatus: "completed" | "failed" | "cancelled";
  fullResponse: string;
  runError?: string;
  runId: string;
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { db, workspaceId, conversationId, providerId, message, maxSteps = 50 } = input;
  const runId = input.runId ?? crypto.randomUUID();

  const logPath = createRunLog(runId);
  await db.createRun({ id: runId, conversationId, workspaceId, providerId, jsonlLogPath: logPath });

  const providerRow = await db.getProviderWithKey(providerId);
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

  const executor: ToolExecutor = {
    stealth_interact: async () => ({ success: true } as unknown),
    stealth_screenshot: async () => ({ success: true } as unknown),
    stealth_evaluate: async () => ({ success: true } as unknown),
    stealth_axtree: async () => ({ success: true } as unknown),
    graph_query: async () => ({ success: true, nodes: [], edges: [] } as unknown),
    generate_document: async (payload: Record<string, unknown>) => generateDocument({
      workspaceId: payload.workspaceId as string,
      title: (payload.title as string) ?? "Untitled",
      content: payload.content as string,
      format: payload.format as "markdown" | "docx" | "pdf",
    }) as unknown,
    recall_skill: async () => ({ success: true } as unknown),
    store_skill: async () => ({ success: true } as unknown),
    vault_read: async () => ({ success: true } as unknown),
    vault_write: async () => ({ success: true } as unknown),
    vault_link: async () => ({ success: true } as unknown),
    stealth_open: async (payload: Record<string, unknown>) => stealthOpen({ profileId: payload.profileId as string, profileDir: "", url: payload.url as string }),
    stealth_scrape: async (payload: Record<string, unknown>) => stealthScrape({ profileId: payload.profileId as string, url: payload.url as string }),
    stealth_download: async (payload: Record<string, unknown>) => stealthDownload({ profileId: payload.profileId as string, url: payload.url as string, filename: payload.filename as string }),
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
      fs.writeFileSync(notePath, `# ${payload.title}\n\n${payload.content}`);
      return { success: true, filePath: notePath };
    },
  };

  const runtime = new AgentRuntime({ providerConfig, runId, workspaceId, conversationId, maxSteps }, executor);
  let fullResponse = "";
  let runStatus: "completed" | "failed" | "cancelled" = "completed";
  let runError: string | undefined;

  try {
    for await (const event of runtime.run(message)) {
      if (event.type === "text" && event.content) {
        fullResponse += event.content;
      } else if (event.type === "error") {
        fullResponse += `\n[Error: ${event.error}]`;
        runError = event.error;
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
    try {
      const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), runId, status: runStatus, error: runError ?? null }) + "\n";
      fs.appendFileSync(logPath, logEntry);
    } catch { /* ignore log write errors */ }
  }

  return { runStatus, fullResponse, runError, runId };
}
