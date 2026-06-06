/**
 * Consolidated IPC Handlers — Single registration point for all carbon-ipc channels.
 *
 * Gate 6 (Architectural Hygiene): Replaces the broken multi-file handler
 * registration where each file overwrote the previous ipcMain.handle().
 */

import { ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { IpcRequestSchema } from "@carbon-agent/shared-schemas";
import { CarbonDatabase, initDatabase, createRunLog, readRunLog, getVaultDir, initSkillsTable, initMemoryTable, initModelRolesTable, dbListMemories, dbDeleteMemory, dbExportSkills, dbImportSkills, dbSetModelRole, dbListModelRoles, dbDeleteModelRole, dbGetModelRole, type ModelRoleName } from "@carbon-agent/local-store";
import { createProvider } from "@carbon-agent/core-runtime";
import { scanDocumentsDir } from "@carbon-agent/ingestion";
import { generateDocument } from "./document-generator.js";
import { runAgent } from "./agent-runner.js";
import { WatcherManager } from "./watcher-manager.js";
import { emitVaultChange, startProfileTelemetry, stopProfileTelemetry } from "./desktop-events.js";
import { recordGeneratedDocument } from "./document-records.js";
import { detectAllClis } from "./cli-subagent.js";

let _db: CarbonDatabase | null = null;
async function ensureDb(): Promise<CarbonDatabase> {
  if (!_db) {
    await initDatabase();
    await initSkillsTable();
    await initMemoryTable();
    await initModelRolesTable();
    _db = new CarbonDatabase();
  }
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

function toPosixRelative(baseDir: string, filePath: string): string {
  return path.relative(baseDir, filePath).split(path.sep).join("/");
}

function listFilesRecursive(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];

  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(toPosixRelative(rootDir, fullPath));
      }
    }
  };

  walk(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

function resolveVaultPath(workspaceId: string, filePath: string): string {
  const vaultDir = getVaultDir(workspaceId);
  const absolutePath = path.resolve(vaultDir, filePath);
  const normalizedVaultDir = path.resolve(vaultDir) + path.sep;
  if (absolutePath !== path.resolve(vaultDir) && !absolutePath.startsWith(normalizedVaultDir)) {
    throw new Error("Vault path escapes workspace root");
  }
  return absolutePath;
}

function mapDocumentRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    dataSourceId: String(row.data_source_id),
    title: String(row.title ?? ""),
    content: String(row.content ?? ""),
    filePath: String(row.file_path ?? ""),
    mimeType: row.mime_type == null ? null : String(row.mime_type),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    profileId: row.profile_id == null ? null : String(row.profile_id),
    chunkCount: Number(row.chunk_count ?? 0),
    format: String(row.format ?? "unknown"),
    preview: String(row.preview ?? ""),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapSkillRow(row: Record<string, unknown>) {
  let toolSequence: unknown[] = [];
  try {
    toolSequence = JSON.parse(String(row.tool_sequence_json ?? "[]")) as unknown[];
  } catch {
    toolSequence = [];
  }

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    trigger: String(row.trigger ?? ""),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    toolSequence,
    successCount: Number(row.success_count ?? 0),
    failureCount: Number(row.failure_count ?? 0),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    version: Number(row.version ?? 1),
    lastUsedAt: row.last_used_at == null ? null : String(row.last_used_at),
    pinned: Boolean(Number(row.pinned ?? 0)),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapWatcherRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name ?? row.prompt ?? "Watcher"),
    prompt: String(row.prompt ?? ""),
    cronExpression: String(row.cron_expression ?? ""),
    enabled: Boolean(Number(row.enabled ?? 0)),
    profileId: row.profile_id == null ? null : String(row.profile_id),
    lastRunAt: row.last_run_at == null ? null : String(row.last_run_at),
    lastRunStatus: row.last_run_status == null ? null : String(row.last_run_status),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapMemoryRow(row: Record<string, unknown>) {
  let tags: string[] = [];
  try { tags = JSON.parse(String(row.tags_json ?? "[]")) as string[]; } catch { tags = []; }
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    key: String(row.key ?? ""),
    content: String(row.content ?? ""),
    tags,
    source: String(row.source ?? "manual"),
    importance: Number(row.importance ?? 0.5),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
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

async function lockProfile(profileId: string, profileDir: string, cdpUrl?: string): Promise<void> {
  const { lockProfile: realLock } = await import("@carbon-agent/cloak-bridge");
  await realLock(profileId, profileDir, cdpUrl);
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
        await d.createProfile({
          id,
          name: request.data.name,
          description: request.data.description,
          profileDir: request.data.profileDir,
          cdpUrl: request.data.cdpUrl,
          cdpFingerprint: request.data.cdpFingerprint,
          targetDomains: request.data.targetDomains,
        });
        const created = await d.getProfile(id);
        return { type: "profile/create.success", data: created };
      }
      case "profile/update": {
        const updateData: Record<string, unknown> = {};
        if (request.data.name !== undefined) updateData.name = request.data.name;
        if (request.data.description !== undefined) updateData.description = request.data.description;
        if (request.data.profileDir !== undefined) updateData.profileDir = request.data.profileDir;
        if (request.data.cdpUrl !== undefined) updateData.cdpUrl = request.data.cdpUrl;
        if (request.data.cdpFingerprint !== undefined) updateData.cdpFingerprint = request.data.cdpFingerprint;
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
        const cdpUrl = row.cdp_url as string | undefined;
        await lockProfile(request.id, (row.profile_dir as string) ?? "", cdpUrl ?? undefined);
        await d.updateProfile({ id: request.id, status: "locked" });
        await startProfileTelemetry(request.id);
        return { type: "profile/lock.success" };
      }
      case "profile/unlock": {
        await unlockProfile(request.id);
        await d.updateProfile({ id: request.id, status: "active" });
        stopProfileTelemetry(request.id);
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
      case "run/events": {
        const events = readRunLog(request.id);
        return { type: "run/events.success", events };
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
        try {
          await runAgent({
            db: d,
            workspaceId: runRow.workspace_id as string,
            conversationId: runRow.conversation_id as string,
            providerId,
            message: request.message,
            maxSteps: 50,
            runId: request.id,
            onRuntime: (runtime) => {
              activeRuns.set(request.id, runtime);
            },
          });
        } finally {
          activeRuns.delete(request.id);
        }
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
        return { type: "watcher/list.success", data: rows.map((row) => mapWatcherRow(row as Record<string, unknown>)) };
      }
      case "watcher/create": {
        const id = crypto.randomUUID();
        const data = request.data;
        await d.createWatcher({ id, workspaceId: data.workspaceId, name: data.name, cronExpression: data.cronExpression, prompt: data.prompt, enabled: data.enabled, profileId: data.profileId ?? null });
        const created = await d.getWatcher(id);
        await getWatcherManager().sync(id);
        return { type: "watcher/create.success", data: mapWatcherRow(created as Record<string, unknown>) };
      }
      case "watcher/update": {
        const data = request.data;
        await d.updateWatcher({ id: request.id, name: data.name, profileId: data.profileId, cronExpression: data.cronExpression, prompt: data.prompt, enabled: data.enabled });
        await getWatcherManager().sync(request.id);
        const updated = await d.getWatcher(request.id);
        return { type: "watcher/update.success", data: mapWatcherRow(updated as Record<string, unknown>) };
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
        await recordGeneratedDocument(d, {
          workspaceId: payload.workspaceId,
          title: payload.title,
          content: payload.content,
          filePath: result.filePath,
          format: payload.format,
        });
        return { type: "document/generate.success", data: result };
      }

      // ==================== Vault ====================
      case "vault/list": {
        const vaultDir = getVaultDir(request.workspaceId);
        const files = listFilesRecursive(vaultDir);
        return { type: "vault/list.success", files };
      }
      case "vault/read": {
        const filePath = resolveVaultPath(request.workspaceId, request.filePath);
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
        return { type: "vault/read.success", content };
      }
      case "vault/write": {
        const filePath = resolveVaultPath(request.workspaceId, request.filePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, request.content, "utf8");
        emitVaultChange({ workspaceId: request.workspaceId, filePath: request.filePath, content: request.content });
        return { type: "vault/write.success" };
      }

      // ==================== Documents / Skills ====================
      case "document/list": {
        const rows = await d.listDocuments(request.workspaceId);
        return { type: "document/list.success", data: rows.map((row) => mapDocumentRow(row as Record<string, unknown>)) };
      }
      case "document/open": {
        const error = await shell.openPath(request.filePath);
        if (error) return { type: "error", error, code: "OPEN_FAILED" };
        return { type: "document/open.success" };
      }
      case "document/reveal": {
        shell.showItemInFolder(request.filePath);
        return { type: "document/reveal.success" };
      }
      case "skills/list": {
        const rows = await d.listSkills(request.workspaceId);
        return { type: "skills/list.success", data: rows.map((row) => mapSkillRow(row as Record<string, unknown>)) };
      }
      case "skills/pin": {
        await d.toggleSkillPin(request.id, request.pinned);
        return { type: "skills/pin.success", data: { id: request.id, pinned: request.pinned } };
      }
      case "skills/delete": {
        await d.deleteSkill(request.id);
        return { type: "skills/delete.success" };
      }
      case "skills/export": {
        const exported = await dbExportSkills(request.workspaceId);
        return { type: "skills/export.success", data: exported };
      }
      case "skills/import": {
        const result = await dbImportSkills(request.data as Parameters<typeof dbImportSkills>[0]);
        return { type: "skills/import.success", data: result };
      }

      // ==================== Live Viewport ====================
      case "viewport/start": {
        await startProfileTelemetry(request.profileId);
        return { type: "viewport/start.success" };
      }
      case "viewport/stop": {
        stopProfileTelemetry(request.profileId);
        return { type: "viewport/stop.success" };
      }

      // ==================== CLI Detection ====================
      case "cli/detect": {
        const results = await detectAllClis();
        return { type: "cli/detect.success", data: results };
      }

      // ==================== Memory ====================
      case "memory/list": {
        const rows = await dbListMemories(request.workspaceId);
        return { type: "memory/list.success", data: rows.map((row) => mapMemoryRow(row as unknown as Record<string, unknown>)) };
      }
      case "memory/delete": {
        await dbDeleteMemory(request.id);
        return { type: "memory/delete.success" };
      }

      // ==================== Model Roles ====================
      case "model-roles/list": {
        const rows = await dbListModelRoles(request.workspaceId);
        return { type: "model-roles/list.success", data: rows.map((r) => ({
          id: r.id,
          role: r.role,
          providerId: r.provider_id,
          workspaceId: r.workspace_id,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })) };
      }
      case "model-roles/set": {
        const id = crypto.randomUUID();
        await dbSetModelRole({ id, role: request.data.role as ModelRoleName, providerId: request.data.providerId, workspaceId: request.data.workspaceId });
        const row = await dbGetModelRole(request.data.workspaceId, request.data.role as ModelRoleName);
        return { type: "model-roles/set.success", data: row ? { id: row.id, role: row.role, providerId: row.provider_id, workspaceId: row.workspace_id, createdAt: row.created_at, updatedAt: row.updated_at } : null };
      }
      case "model-roles/delete": {
        await dbDeleteModelRole(request.role as ModelRoleName, request.workspaceId);
        return { type: "model-roles/delete.success" };
      }

      // ==================== Stats ====================
      case "stats/list": {
        return { type: "stats/list.success", activeRuns: await d.countRunningRuns() };
      }

      default:
        return { type: "error", error: `Unhandled: ${(request as { type: string }).type}`, code: "UNHANDLED" };
    }
  } catch (err: unknown) {
    return { type: "error", error: err instanceof Error ? err.message : String(err), code: "VALIDATION_ERROR" };
  }
});
