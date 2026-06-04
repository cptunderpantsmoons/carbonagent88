/**
 * Electron Main Process
 *
 * Control Corridor:
 * - Owns: OS access, windows, IPC, local paths
 * - Must NOT own: Agent reasoning, LLM calls
 *
 * Security:
 * - contextIsolation: true
 * - nodeIntegration: false
 * - All IPC payloads validated via Zod
 */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// IPC Handlers (Zod-validated)
// ---------------------------------------------------------------------------

import { IpcRequestSchema } from "@carbon-agent/shared-schemas";
import { CarbonDatabase, initDatabase, saveDatabase, closeDatabase } from "@carbon-agent/local-store";
import { createProvider } from "@carbon-agent/core-runtime";
import { AgentRuntime, type ToolExecutor } from "@carbon-agent/core-runtime";
import {
  launchLoginPortal,
  lockProfile,
  unlockProfile,
  checkSessionHealth,
  stealthOpen,
  stealthScrape,
  stealthDownload,
  closeAllBrowsers,
} from "@carbon-agent/cloak-bridge";
import {
  parseFile,
  chunkText,
  storeChunks,
  searchChunks,
  scanDocumentsDir,
  HashEmbeddingProvider,
} from "@carbon-agent/ingestion";
import { getVaultDir, createRunLog } from "@carbon-agent/local-store";

let db: CarbonDatabase | null = null;

async function ensureDb(): Promise<CarbonDatabase> {
  if (!db) {
    await initDatabase();
    db = new CarbonDatabase();
  }
  return db;
}

app.on("before-quit", () => {
  saveDatabase();
  closeDatabase();
  closeAllBrowsers();
});

// Active agent runs (for cancellation)
const activeRuns = new Map<string, AgentRuntime>();

ipcMain.handle("carbon-ipc", async (_event, rawRequest: unknown) => {
  try {
    const request = IpcRequestSchema.parse(rawRequest);

    switch (request.type) {
      // =====================================================================
      // Provider handlers
      // =====================================================================
      case "provider/list": {
        const d = await ensureDb();
        const rows = await d.listProviders();
        return { type: "provider/list.success", data: rows };
      }

      case "provider/create": {
        const d = await ensureDb();
        const id = crypto.randomUUID();
        await d.createProvider({
          id,
          type: request.data.type,
          name: request.data.name,
          apiKey: request.data.apiKey,
          baseUrl: request.data.baseUrl,
          model: request.data.model,
        });
        const created = await d.getProvider(id);
        return { type: "provider/create.success", data: created };
      }

      case "provider/update": {
        const d = await ensureDb();
        await d.updateProvider({
          id: request.id,
          type: request.data.type,
          name: request.data.name,
          apiKey: request.data.apiKey,
          baseUrl: request.data.baseUrl,
          model: request.data.model,
        });
        const updated = await d.getProvider(request.id);
        return { type: "provider/update.success", data: updated };
      }

      case "provider/delete": {
        const d = await ensureDb();
        await d.deleteProvider(request.id);
        return { type: "provider/delete.success" };
      }

      case "provider/test": {
        const d = await ensureDb();
        const row = await d.getProvider(request.id);
        if (!row) {
          return { type: "error", error: "Provider not found", code: "PROVIDER_NOT_FOUND" };
        }
        // Fetch full row with API key (listProviders strips it)
        const fullRow = await d.getProvider(request.id);
        if (!fullRow) {
          return { type: "error", error: "Provider not found", code: "PROVIDER_NOT_FOUND" };
        }
        // Reconstruct AIProviderConfig for the gateway
        const config = {
          id: fullRow.id as string,
          type: fullRow.type as "anthropic" | "openai" | "custom-openai",
          name: fullRow.name as string,
          apiKey: fullRow.api_key as string,
          baseUrl: fullRow.base_url as string | undefined,
          model: fullRow.model as string,
          createdAt: fullRow.created_at as string,
          updatedAt: fullRow.updated_at as string,
        };
        const provider = createProvider(config);
        const result = await provider.testConnection();
        return { type: "provider/test.success", status: result.ok ? "Connected" : `Failed: ${result.error}` };
      }

      // =====================================================================
      // Workspace handlers
      // =====================================================================
      case "workspace/list": {
        const d = await ensureDb();
        const rows = await d.listWorkspaces();
        return { type: "workspace/list.success", data: rows };
      }

      case "workspace/create": {
        const d = await ensureDb();
        const id = crypto.randomUUID();
        await d.createWorkspace({
          id,
          name: request.data.name,
          description: request.data.description,
          vaultDir: request.data.vaultDir,
        });
        const created = await d.getWorkspace(id);
        return { type: "workspace/create.success", data: created };
      }

      case "workspace/get": {
        const d = await ensureDb();
        const row = await d.getWorkspace(request.id);
        if (!row) {
          return { type: "error", error: "Workspace not found", code: "WORKSPACE_NOT_FOUND" };
        }
        return { type: "workspace/get.success", data: row };
      }

      // =====================================================================
      // Profile handlers (Cloak Bridge)
      // =====================================================================
      case "profile/list": {
        const d = await ensureDb();
        const rows = await d.listProfiles();
        return { type: "profile/list.success", data: rows };
      }

      case "profile/create": {
        const d = await ensureDb();
        const id = crypto.randomUUID();
        await d.createProfile({
          id,
          name: request.data.name,
          description: request.data.description,
          profileDir: request.data.profileDir,
          targetDomains: request.data.targetDomains,
        });
        const created = await d.getProfile(id);
        return { type: "profile/create.success", data: created };
      }

      case "profile/update": {
        const d = await ensureDb();
        await d.updateProfile({
          id: request.id,
          name: request.data.name,
          description: request.data.description,
          profileDir: request.data.profileDir,
          targetDomains: request.data.targetDomains,
        });
        const updated = await d.getProfile(request.id);
        return { type: "profile/update.success", data: updated };
      }

      case "profile/delete": {
        const d = await ensureDb();
        await d.deleteProfile(request.id);
        return { type: "profile/delete.success" };
      }

      case "profile/health": {
        const d = await ensureDb();
        const row = await d.getProfile(request.id);
        if (!row) {
          return { type: "error", error: "Profile not found", code: "PROFILE_NOT_FOUND" };
        }
        const domains = JSON.parse((row.target_domains as string) || "[]") as string[];
        if (domains.length === 0) {
          return { type: "profile/health.success", status: "unknown", lastCheckedAt: row.last_checked_at as string | null };
        }
        // Check first domain
        const result = await checkSessionHealth(request.id, row.profile_dir as string, domains[0]);
        await d.updateProfile({
          id: request.id,
          status: result.status,
          lastCheckedAt: new Date().toISOString(),
        });
        return { type: "profile/health.success", status: result.status, lastCheckedAt: new Date().toISOString() };
      }

      case "profile/launchLogin": {
        const d = await ensureDb();
        const row = await d.getProfile(request.id);
        if (!row) {
          return { type: "error", error: "Profile not found", code: "PROFILE_NOT_FOUND" };
        }
        const result = await launchLoginPortal(request.id, row.profile_dir as string);
        if (result.success) {
          await d.updateProfile({ id: request.id, status: "active" });
        }
        return { type: "profile/launchLogin.success" };
      }

      case "profile/lock": {
        const d = await ensureDb();
        const row = await d.getProfile(request.id);
        if (!row) {
          return { type: "error", error: "Profile not found", code: "PROFILE_NOT_FOUND" };
        }
        await lockProfile(request.id, row.profile_dir as string);
        await d.updateProfile({ id: request.id, status: "locked" });
        return { type: "profile/lock.success" };
      }

      case "profile/unlock": {
        const d = await ensureDb();
        await unlockProfile(request.id);
        await d.updateProfile({ id: request.id, status: "active" });
        return { type: "profile/unlock.success" };
      }

      // =====================================================================
      // Conversation handlers
      // =====================================================================
      case "conversation/list": {
        const d = await ensureDb();
        const rows = await d.listConversations(request.workspaceId);
        return { type: "conversation/list.success", data: rows };
      }

      case "conversation/create": {
        const d = await ensureDb();
        const id = crypto.randomUUID();
        await d.createConversation({ id, workspaceId: request.workspaceId });
        const created = await d.getConversation(id);
        return { type: "conversation/create.success", data: created };
      }

      case "conversation/get": {
        const d = await ensureDb();
        const row = await d.getConversation(request.id);
        if (!row) {
          return { type: "error", error: "Conversation not found", code: "CONVERSATION_NOT_FOUND" };
        }
        return { type: "conversation/get.success", data: row };
      }

      case "conversation/delete": {
        const d = await ensureDb();
        await d.deleteConversation(request.id);
        return { type: "conversation/delete.success" };
      }

      // =====================================================================
      // Run handlers (Agent Runtime)
      // =====================================================================
      case "run/list": {
        const d = await ensureDb();
        const rows = await d.listRuns(request.conversationId);
        return { type: "run/list.success", data: rows };
      }

      case "run/create": {
        const d = await ensureDb();
        const id = crypto.randomUUID();
        // Get conversation to find workspace
        const conv = await d.getConversation(request.conversationId);
        if (!conv) {
          return { type: "error", error: "Conversation not found", code: "CONVERSATION_NOT_FOUND" };
        }
        const logPath = createRunLog(id);
        await d.createRun({
          id,
          conversationId: request.conversationId,
          workspaceId: conv.workspace_id as string,
          providerId: request.providerId,
          jsonlLogPath: logPath,
        });
        const created = await d.getRun(id);
        return { type: "run/create.success", data: created };
      }

      case "run/get": {
        const d = await ensureDb();
        const row = await d.getRun(request.id);
        if (!row) {
          return { type: "error", error: "Run not found", code: "RUN_NOT_FOUND" };
        }
        return { type: "run/get.success", data: row };
      }

      case "run/cancel": {
        const runtime = activeRuns.get(request.id);
        if (runtime) {
          runtime.cancel();
        }
        const d = await ensureDb();
        await d.updateRunStatus(request.id, "cancelled", { completedAt: new Date().toISOString() });
        return { type: "run/cancel.success" };
      }

      case "run/stream": {
        const d = await ensureDb();
        const runRow = await d.getRun(request.id);
        if (!runRow) {
          return { type: "error", error: "Run not found", code: "RUN_NOT_FOUND" };
        }

        // Get provider config
        const providerId = runRow.provider_id as string | null;
        if (!providerId) {
          return { type: "error", error: "No provider configured for this run", code: "NO_PROVIDER" };
        }
        const providerRow = await d.getProvider(providerId);
        if (!providerRow) {
          return { type: "error", error: "Provider not found", code: "PROVIDER_NOT_FOUND" };
        }

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

        // Update run status
        await d.updateRunStatus(request.id, "running", {
          model: providerConfig.model,
          startedAt: new Date().toISOString(),
        });

        // Store user message
        await d.addMessage({
          id: crypto.randomUUID(),
          conversationId: runRow.conversation_id as string,
          role: "user",
          content: request.message,
        });

        // Build tool executor
        const executor: ToolExecutor = {
          stealth_open: async (input) => {
            return stealthOpen({ profileId: input.profileId, profileDir: "", url: input.url });
          },
          stealth_scrape: async (input) => {
            return stealthScrape({ profileId: input.profileId, url: input.url });
          },
          stealth_download: async (input) => {
            return stealthDownload({ profileId: input.profileId, url: input.url, filename: input.filename });
          },
          ingest_file: async (input) => {
            const parsed = parseFile(input.filePath, { sourceUrl: input.sourceUrl, profileId: input.profileId });

            // 1. Create DataSource record
            const dataSourceId = crypto.randomUUID();
            let fileSizeBytes: number | undefined;
            try { fileSizeBytes = fs.statSync(input.filePath).size; } catch { /* ignore */ }
            await d.createDataSource({
              id: dataSourceId,
              workspaceId: input.workspaceId,
              type: input.profileId ? "browser_download" : "file",
              name: path.basename(input.filePath),
              path: input.filePath,
              mimeType: parsed.mimeType,
              sizeBytes: fileSizeBytes,
              sourceUrl: input.sourceUrl,
              profileId: input.profileId,
            });

            // 2. Create Document record
            const documentId = crypto.randomUUID();
            await d.createDocument({
              id: documentId,
              workspaceId: input.workspaceId,
              dataSourceId,
              title: parsed.title,
              content: parsed.content,
            });

            // 3. Create IngestionJob record (tracks this pipeline run)
            const jobId = crypto.randomUUID();
            await d.createIngestionJob({ id: jobId, documentId });

            // 4. Chunk, embed, store
            const chunks = chunkText(parsed.content, { chunkSize: 1000, overlap: 200 });
            const embedder = new HashEmbeddingProvider();
            const embeddings = await embedder.embed(chunks.map(c => c.content));
            const stored = chunks.map((c, i) => ({
              id: crypto.randomUUID(),
              documentId,
              workspaceId: input.workspaceId,
              chunkIndex: c.index,
              content: c.content,
              embedding: embeddings[i],
              sourceUrl: parsed.sourceUrl,
              sourceProfileId: parsed.profileId,
            }));
            await storeChunks(stored);

            // 5. Update Document chunk_count and IngestionJob status
            await d.updateDocumentChunkCount(documentId, stored.length);
            await d.updateIngestionJob(jobId, { status: "completed", chunksCreated: stored.length });

            return { success: true, chunksCreated: stored.length, documentId, documentTitle: parsed.title };
          },
          rag_retrieve: async (input) => {
            const results = await searchChunks(input.workspaceId, input.query, input.limit ?? 5);
            return { success: true, chunks: results.map(r => ({ content: r.content, sourceUrl: r.sourceUrl })) };
          },
          write_note: async (input) => {
            const vaultDir = getVaultDir(input.workspaceId);
            if (!fs.existsSync(vaultDir)) {
              fs.mkdirSync(vaultDir, { recursive: true });
            }
            const notePath = path.join(vaultDir, `${input.title.replace(/[^a-zA-Z0-9]/g, "_")}.md`);
            fs.writeFileSync(notePath, `# ${input.title}\n\n${input.content}`);
            return { success: true, filePath: notePath };
          },
        };

        const runtime = new AgentRuntime({
          providerConfig,
          runId: request.id,
          workspaceId: runRow.workspace_id as string,
          conversationId: runRow.conversation_id as string,
          maxSteps: 50,
        }, executor);

        activeRuns.set(request.id, runtime);

        // Collect all output to return
        let fullResponse = "";
        try {
          for await (const event of runtime.run(request.message)) {
            if (event.type === "text" && event.content) {
              fullResponse += event.content;
            } else if (event.type === "error") {
              fullResponse += `\n[Error: ${event.error}]`;
            }
          }
        } catch (err: any) {
          fullResponse += `\n[Runtime Error: ${err.message ?? String(err)}]`;
        } finally {
          activeRuns.delete(request.id);
          await d.updateRunStatus(request.id, "completed", { completedAt: new Date().toISOString() });
          // Store assistant message
          await d.addMessage({
            id: crypto.randomUUID(),
            conversationId: runRow.conversation_id as string,
            role: "assistant",
            content: fullResponse,
          });
        }

        return { type: "run/stream.complete" };
      }

      // =====================================================================
      // Ingestion handlers
      // =====================================================================
      case "ingestion/scan": {
        const files = scanDocumentsDir();
        return { type: "ingestion/scan.success", jobs: files.map((_file: any) => ({
          id: crypto.randomUUID(),
          documentId: crypto.randomUUID(),
          status: "pending" as const,
          chunksCreated: 0,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })) };
      }

      case "ingestion/retry": {
        return { type: "ingestion/retry.success", data: { id: request.jobId, documentId: "", status: "pending", chunksCreated: 0, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
      }

      default:
        return { type: "error", error: `Unhandled request type: ${(request as any).type}`, code: "UNHANDLED" };
    }
  } catch (err: any) {
    return { type: "error", error: err.message ?? String(err), code: "VALIDATION_ERROR" };
  }
});
