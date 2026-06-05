/**
 * Consolidated IPC Handlers — Single registration point for all carbon-ipc channels.
 *
 * Gate 6 (Architectural Hygiene): Replaces the broken multi-file handler
 * registration where each file overwrote the previous ipcMain.handle().
 */

import { ipcMain } from "electron";
import { IpcRequestSchema } from "@carbon-agent/shared-schemas";
import { CarbonDatabase, initDatabase, createRunLog } from "@carbon-agent/local-store";
import { createProvider } from "@carbon-agent/core-runtime";
import { scanDocumentsDir } from "@carbon-agent/ingestion";
import { generateDocument } from "./document-generator.js";
import { runAgent } from "./agent-runner.js";
import { WatcherManager } from "./watcher-manager.js";
import crypto from "node:crypto";

let _db: CarbonDatabase | null = null;
async function ensureDb(): Promise<CarbonDatabase> {
  if (!_db) { await initDatabase(); _db = new CarbonDatabase(); }
  return _db;
}

const activeRuns = new Map<string, { cancel: () => void }>();
let watcherManager: WatcherManager | null = null;

export function setWatcherManager(wm: WatcherManager): void {
  watcherManager = wm;
}

function getWatcherManager(): WatcherManager {
  if (!watcherManager) throw new Error("WatcherManager not initialized");
  return watcherManager;
}

// ---------------------------------------------------------------------------
// Helper: profile session operations
// ---------------------------------------------------------------------------

async function checkSessionHealth(profileId: string, profileDir: string, domain: string): Promise<{ status: "active" | "expired" | "unknown" }> {
  const { checkSessionHealth: realCheck } = await import("@carbon-agent/cloak-bridge");
  const result = await realCheck(profileId, profileDir, domain);
  return { status: result.status };
}

async function launchLoginPortal(profileId: string, profileDir: string): Promise<{ success: boolean }> {
  const { launchLoginPortal: realLaunch } = await import("@carbon-agent/cloak-bridge");
  const result = await realLaunch(profileId, profileDir);
  return { success: result.success };
}

async function lockProfile(profileId: string, profileDir: string): Promise<void> {
  const { lockProfile: realLock } = await import("@carbon-agent/cloak-bridge");
  await realLock(profileId, profileDir);
}

async function unlockProfile(profileId: string): Promise<void> {
  const { unlockProfile: realUnlock } = await import("@carbon-agent/cloak-bridge");
  await realUnlock(profileId);
}

// ---------------------------------------------------------------------------
// Consolidated IPC handler
// ---------------------------------------------------------------------------

ipcMain.handle("carbon-ipc", async (_event, rawRequest: unknown) => {
  try {
    const request = IpcRequestSchema.parse(rawRequest);
    const d = await ensureDb();

    switch (request.type) {
      // ==================== Provider ====================
      case "provider/list": {
        const rows = await d.listProviders();
        return { type: "provider/list.success", data: rows };
      }
      case "provider/create": {
        const id = crypto.randomUUID();
        await d.createProvider({ id, type: request.data.type, name: request.data.name, apiKey: request.data.apiKey, baseUrl: request.data.baseUrl, model: request.data.model });
        const created = await d.getProvider(id);
        return { type: "provider/create.success", data: created };
      }
      case "provider/update": {
        await d.updateProvider({ id: request.id, type: request.data.type, name: request.data.name, apiKey: request.data.apiKey, baseUrl: request.data.baseUrl, model: request.data.model });
        const updated = await d.getProvider(request.id);
        return { type: "provider/update.success", data: updated };
      }
      case "provider/delete": {
        await d.deleteProvider(request.id);
        return { type: "provider/delete.success" };
      }
      case "provider/test": {
        const row = await d.getProviderWithKey(request.id);
        if (!row) return { type: "error", error: "Provider not found", code: "PROVIDER_NOT_FOUND" };
        const config = { id: row.id as string, type: row.type as "anthropic" | "openai" | "custom-openai", name: row.name as string, apiKey: row.api_key as string, baseUrl: row.base_url as string | undefined, model: row.model as string, createdAt: row.created_at as string, updatedAt: row.updated_at as string };
        const provider = createProvider(config);
        const result = await provider.testConnection();
        return { type: "provider/test.success", status: result.ok ? "Connected" : `Failed: ${result.error}` };
      }

      // ==================== Profile ====================
      case "profile/list": {
        const rows = await d.listProfiles();
        return { type: "profile/list.success", data: rows };
      }
      case "profile/create": {
        const id = crypto.randomUUID();
        await d.createProfile({ id, name: request.data.name, description: request.data.description, profileDir: request.data.profileDir, targetDomains: request.data.targetDomains });
        const created = await d.getProfile(id);
        return { type: "profile/create.success", data: created };
      }
      case "profile/update": {
        const updateData: Record<string, unknown> = {};
        if (request.data.name !== undefined) updateData.name = request.data.name;
        if (request.data.description !== undefined) updateData.description = request.data.description;
        if (request.data.profileDir !== undefined) updateData.profileDir = request.data.profileDir;
        if (request.data.targetDomains !== undefined) updateData.targetDomains = request.data.targetDomains;
        await d.updateProfile({ id: request.id, ...updateData } as Parameters<CarbonDatabase["updateProfile"]>[0]);
        const updated = await d.getProfile(request.id);
        return { type: "profile/update.success", data: updated };
      }
      case "profile/delete": {
        await d.deleteProfile(request.id);
        return { type: "profile/delete.success" };
      }
      case "profile/health": {
        const row = await d.getProfile(request.id);
        if (!row) return { type: "error", error: "Profile not found", code: "PROFILE_NOT_FOUND" };
        const domains = JSON.parse((row.target_domains as string) || "[]") as string[];
        if (domains.length === 0) return { type: "profile/health.success", status: "unknown", lastCheckedAt: row.last_checked_at as string | null };
        const result = await checkSessionHealth(request.id, row.profile_dir as string, domains[0]!);
        await d.updateProfile({ id: request.id, status: result.status, lastCheckedAt: new Date().toISOString() });
        return { type: "profile/health.success", status: result.status, lastCheckedAt: new Date().toISOString() };
      }
      case "profile/launchLogin": {
        const row = await d.getProfile(request.id);
        if (!row) return { type: "error", error: "Profile not found", code: "PROFILE_NOT_FOUND" };
        const result = await launchLoginPortal(request.id, row.profile_dir as string);
        if (result.success) await d.updateProfile({ id: request.id, status: "active" });
        return { type: "profile/launchLogin.success" };
      }
      case "profile/lock": {
        const row = await d.getProfile(request.id);
        if (!row) return { type: "error", error: "Profile not found", code: "PROFILE_NOT_FOUND" };
        await lockProfile(request.id, row.profile_dir as string);
        await d.updateProfile({ id: request.id, status: "locked" });
        return { type: "profile/lock.success" };
      }
      case "profile/unlock": {
        await unlockProfile(request.id);
        await d.updateProfile({ id: request.id, status: "active" });
        return { type: "profile/unlock.success" };
      }

      // ==================== Workspace ====================
      case "workspace/list": {
        const rows = await d.listWorkspaces();
        return { type: "workspace/list.success", data: rows };
      }
      case "workspace/create": {
        const id = crypto.randomUUID();
        await d.createWorkspace({ id, name: request.data.name, description: request.data.description, vaultDir: request.data.vaultDir });
        const created = await d.getWorkspace(id);
        return { type: "workspace/create.success", data: created };
      }
      case "workspace/get": {
        const row = await d.getWorkspace(request.id);
        if (!row) return { type: "error", error: "Workspace not found", code: "WORKSPACE_NOT_FOUND" };
        return { type: "workspace/get.success", data: row };
      }

      // ==================== Conversation ====================
      case "conversation/list": {
        const rows = await d.listConversations(request.workspaceId);
        return { type: "conversation/list.success", data: rows };
      }
      case "conversation/create": {
        const id = crypto.randomUUID();
        await d.createConversation({ id, workspaceId: request.workspaceId });
        const created = await d.getConversation(id);
        return { type: "conversation/create.success", data: created };
      }
      case "conversation/get": {
        const row = await d.getConversation(request.id);
        if (!row) return { type: "error", error: "Conversation not found", code: "CONVERSATION_NOT_FOUND" };
        return { type: "conversation/get.success", data: row };
      }
      case "conversation/delete": {
        await d.deleteConversation(request.id);
        return { type: "conversation/delete.success" };
      }

      // ==================== Run ====================
      case "run/list": {
        const rows = await d.listRuns(request.conversationId);
        return { type: "run/list.success", data: rows };
      }
      case "run/create": {
        const id = crypto.randomUUID();
        const conv = await d.getConversation(request.conversationId);
        if (!conv) return { type: "error", error: "Conversation not found", code: "CONVERSATION_NOT_FOUND" };
        const logPath = createRunLog(id);
        await d.createRun({ id, conversationId: request.conversationId, workspaceId: conv.workspace_id as string, providerId: request.providerId, jsonlLogPath: logPath });
        const created = await d.getRun(id);
        return { type: "run/create.success", data: created };
      }
      case "run/get": {
        const row = await d.getRun(request.id);
        if (!row) return { type: "error", error: "Run not found", code: "RUN_NOT_FOUND" };
        return { type: "run/get.success", data: row };
      }
      case "run/cancel": {
        const runtime = activeRuns.get(request.id);
        if (runtime) runtime.cancel();
        await d.updateRunStatus(request.id, "cancelled", { completedAt: new Date().toISOString() });
        return { type: "run/cancel.success" };
      }
      case "run/stream": {
        const runRow = await d.getRun(request.id);
        if (!runRow) return { type: "error", error: "Run not found", code: "RUN_NOT_FOUND" };
        const providerId = runRow.provider_id as string | null;
        if (!providerId) return { type: "error", error: "No provider configured for this run", code: "NO_PROVIDER" };
        await runAgent({ db: d, workspaceId: runRow.workspace_id as string, conversationId: runRow.conversation_id as string, providerId, message: request.message, maxSteps: 50, runId: request.id });
        return { type: "run/stream.complete" };
      }

      // ==================== Ingestion ====================
      case "ingestion/scan": {
        const files = scanDocumentsDir();
        return { type: "ingestion/scan.success", jobs: files.map((_file) => ({
          id: crypto.randomUUID(), documentId: crypto.randomUUID(), status: "pending" as const, chunksCreated: 0, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        })) };
      }
      case "ingestion/retry": {
        return { type: "ingestion/retry.success", data: { id: request.jobId, documentId: "", status: "pending", chunksCreated: 0, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
      }

      // ==================== Watcher ====================
      case "watcher/list": {
        const rows = await d.listWatchers();
        return { type: "watcher/list.success", data: rows };
      }
      case "watcher/create": {
        const id = crypto.randomUUID();
        const data = request.data;
        await d.createWatcher({ id, workspaceId: data.workspaceId, cronExpression: data.cronExpression, prompt: data.prompt, enabled: data.enabled });
        const created = await d.getWatcher(id);
        await getWatcherManager().sync(id);
        return { type: "watcher/create.success", data: created };
      }
      case "watcher/update": {
        const data = request.data;
        await d.updateWatcher({ id: request.id, cronExpression: data.cronExpression, prompt: data.prompt, enabled: data.enabled });
        await getWatcherManager().sync(request.id);
        return { type: "watcher/update.success" };
      }
      case "watcher/toggle": {
        const row = await d.getWatcher(request.id);
        if (!row) return { type: "error", error: "Watcher not found", code: "NOT_FOUND" };
        const newEnabled = !(row.enabled === 1 || row.enabled === true);
        await d.updateWatcher({ id: request.id, enabled: newEnabled });
        await getWatcherManager().sync(request.id);
        return { type: "watcher/toggle.success", data: { id: request.id, enabled: newEnabled } };
      }
      case "watcher/delete": {
        const row = await d.getWatcher(request.id);
        if (!row) return { type: "error", error: "Watcher not found", code: "NOT_FOUND" };
        getWatcherManager().stop(request.id);
        await d.deleteWatcher(request.id);
        return { type: "watcher/delete.success" };
      }
      case "watcher/run": {
        const row = await d.getWatcher(request.id);
        if (!row) return { type: "error", error: "Watcher not found", code: "NOT_FOUND" };
        await getWatcherManager().executeNow(request.id, row.prompt as string, row.workspace_id as string);
        return { type: "watcher/run.success" };
      }

      // ==================== Document Generation (Gate 1) ====================
      case "document/generate": {
        const payload = request.data;
        const result = await generateDocument({ workspaceId: payload.workspaceId, title: payload.title, content: payload.content, format: payload.format });
        return { type: "document/generate.success", data: result };
      }

      // ==================== Stats ====================
      case "stats/list": {
        return { type: "stats/list.success", activeRuns: activeRuns.size };
      }

      default:
        return { type: "error", error: `Unhandled: ${(request as { type: string }).type}`, code: "UNHANDLED" };
    }
  } catch (err: unknown) {
    return { type: "error", error: err instanceof Error ? err.message : String(err), code: "VALIDATION_ERROR" };
  }
});
