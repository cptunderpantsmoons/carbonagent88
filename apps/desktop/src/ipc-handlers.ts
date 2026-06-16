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
import {
  CarbonDatabase,
  initDatabase,
  createRunLog,
  readRunLog,
  getVaultDir,
  initSkillsTable,
  initMemoryTable,
  initModelRolesTable,
  dbListMemories,
  dbDeleteMemory,
  dbExportSkills,
  dbImportSkills,
  dbSetModelRole,
  dbListModelRoles,
  dbDeleteModelRole,
  dbGetModelRole,
  hasPermission,
  canAccessWorkspace,
  type ModelRoleName,
  type Permission,
  runStmt,
  ensureDb as ensureRawDb,
} from "@carbon-agent/local-store";
import { verifySession, login, logout, hashPassword, setAuthDb } from "./auth.js";
import { createProvider } from "@carbon-agent/core-runtime";
import { scanDocumentsDir } from "@carbon-agent/ingestion";
import {
  resolveConnectorAdapter,
  runConnectorSync,
  memoryAdapterForWorkspace,
  type ConnectorConfig,
  type ConnectorItemIngester,
} from "@carbon-agent/connectors";
import { generateDocument } from "./document-generator.js";
import { runAgent } from "./agent-runner.js";
import { WatcherManager } from "./watcher-manager.js";
import { emitVaultChange, startProfileTelemetry, stopProfileTelemetry } from "./desktop-events.js";
import { emitSessionUpdate, emitSessionWorkingSet } from "./session-events.js";
import { createApprovalCoordinator, getApprovalCoordinator, loadPendingApprovalsFromDb } from "./approval-coordinator.js";
import { recordGeneratedDocument } from "./document-records.js";
import { detectAllClis, detectCli } from "./cli-subagent.js";

let _db: CarbonDatabase | null = null;
async function ensureDb(): Promise<CarbonDatabase> {
  if (!_db) {
    await initDatabase();
    await initSkillsTable();
    await initMemoryTable();
    await initModelRolesTable();
    _db = new CarbonDatabase();
    await _db.ensureDefaultTenantAndAdmin();
    setAuthDb(_db);
    createApprovalCoordinator(_db as unknown as Parameters<typeof createApprovalCoordinator>[0]);
    await loadPendingApprovalsFromDb(_db);
  }
  return _db;
}

type OrchestrationDb = CarbonDatabase & {
  ensureDefaultTenantAndAdmin(): Promise<{ tenantId: string; adminUserId: string; adminRoleId: string }>;
  getUserById(id: string): Promise<Record<string, unknown> | undefined>;
  getUserByEmail(email: string): Promise<Record<string, unknown> | undefined>;
  listUsersForTenant(tenantId: string): Promise<Record<string, unknown>[]>;
  createUser(p: { id: string; tenantId: string; email: string; name?: string | null; passwordHash?: string | null; roleId: string; active?: boolean }): Promise<string>;
  updateUser(id: string, p: { email?: string; name?: string | null; passwordHash?: string | null; roleId?: string; active?: boolean }): Promise<void>;
  deleteUser(id: string): Promise<void>;
  getRole(id: string): Promise<Record<string, unknown> | undefined>;
  getRoleByName(tenantId: string, name: string): Promise<Record<string, unknown> | undefined>;
  listRoles(tenantId: string): Promise<Record<string, unknown>[]>;
  createRole(p: { id: string; tenantId: string; name: string; description?: string | null; isSystem?: boolean }): Promise<string>;
  deleteRole(id: string): Promise<void>;
  assignPermission(roleId: string, permissionId: string): Promise<void>;
  revokePermission(roleId: string, permissionId: string): Promise<void>;
  listTenants(): Promise<Record<string, unknown>[]>;
  addTenantMember(tenantId: string, userId: string, roleId: string): Promise<void>;
  listTenantMembers(tenantId: string): Promise<Record<string, unknown>[]>;
  addWorkspaceMember(workspaceId: string, userId: string, roleId: string): Promise<void>;
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<void>;
  listWorkspaceMembers(workspaceId: string): Promise<Record<string, unknown>[]>;
  listWorkspacesForUser(userId: string): Promise<Record<string, unknown>[]>;
  createOrchestrationSession(p: {
    id: string;
    workspaceId: string;
    conversationId: string;
    runId: string;
    rootKind: string;
    rootJson: string;
    supervisionMode: "watch" | "confirm";
    status: "draft" | "running" | "waiting" | "completed" | "failed" | "cancelled";
    currentGoal: string;
    completionSummary?: string | null;
  }): Promise<void>;
  getOrchestrationSession(id: string): Promise<Record<string, unknown> | undefined>;
  updateOrchestrationSessionStatus(id: string, status: string, completionSummary?: string | null): Promise<void>;
  appendSessionEvent(p: { id: string; sessionId: string; role: string; kind: string; summary: string; payloadJson: string }): Promise<void>;
  listSessionEvents(sessionId: string): Promise<Record<string, unknown>[]>;
  saveSessionWorkingSet(p: {
    sessionId: string;
    entitiesJson: string;
    documentsJson: string;
    metricsJson: string;
    gapsJson: string;
    provenanceScore: number;
  }): Promise<void>;
  getSessionWorkingSet(sessionId: string): Promise<Record<string, unknown> | undefined>;
  // Graph memory helpers
  storeGraphNode(p: { id: string; workspaceId: string; type: string; label: string; properties?: Record<string, unknown>; embedding?: number[]; mentionCount?: number }): Promise<void>;
  getGraphNode(id: string): Promise<Record<string, unknown> | undefined>;
  getGraphEdge(id: string): Promise<Record<string, unknown> | undefined>;
  findGraphNodes(p: { workspaceId: string; type?: string; label?: string; limit?: number }): Promise<Record<string, unknown>[]>;
  findGraphEdges(p: { workspaceId: string; sourceId?: string; targetId?: string; relationType?: string }): Promise<Record<string, unknown>[]>;
  storeGraphEdge(p: { id: string; sourceId: string; targetId: string; relationType: string; workspaceId: string; documentId?: string | null; weight?: number; properties?: Record<string, unknown> }): Promise<void>;
  deleteGraphNode(id: string): Promise<void>;
  deleteGraphEdge(id: string): Promise<void>;
  // Episodic memory helpers
  storeEpisodicEvent(p: { id: string; workspaceId: string; type: string; summary: string; details?: Record<string, unknown>; outcome: string; embedding?: number[]; importance?: number; createdAt?: string }): Promise<void>;
  findEpisodicEvents(p: { workspaceId: string; types?: string | string[]; outcome?: string; after?: string; before?: string; limit?: number; includeEmbeddings?: boolean }): Promise<Record<string, unknown>[]>;
  deleteEpisodicEvents(ids: string[]): Promise<void>;
  // Connectors
  createConnectorConfig(p: { id: string; workspaceId: string; name: string; type: string; enabled?: boolean; schedule?: string | null; credentials?: string | null; options?: Record<string, unknown> }): Promise<string>;
  updateConnectorConfig(id: string, p: { name?: string; enabled?: boolean; schedule?: string | null; credentials?: string | null; options?: Record<string, unknown> }): Promise<void>;
  deleteConnectorConfig(id: string): Promise<void>;
  listConnectorConfigs(workspaceId: string): Promise<Record<string, unknown>[]>;
  getConnectorConfig(id: string): Promise<Record<string, unknown> | undefined>;
  recordConnectorRun(p: { id: string; connectorId: string; workspaceId: string; startedAt: string; finishedAt?: string | null; status: string; itemsProcessed?: number; errorMessage?: string | null }): Promise<void>;
  listConnectorRuns(connectorId: string, limit?: number): Promise<Record<string, unknown>[]>;
  getConnectorState(connectorId: string): Promise<Record<string, unknown> | undefined>;
  updateConnectorState(p: { connectorId: string; workspaceId: string; cursor?: string | null; lastItemId?: string | null }): Promise<void>;
  // Anomaly rules
  createAnomalyRule(p: { id: string; watcherId: string; metric: string; operator: string; threshold?: number | null; windowMinutes?: number; severity?: string; enabled?: boolean }): Promise<string>;
  listAnomalyRulesForWatcher(watcherId: string): Promise<Record<string, unknown>[]>;
  deleteAnomalyRule(id: string): Promise<void>;
};

const activeRuns = new Map<string, { cancel: () => void }>();
let watcherManager: WatcherManager | null = null;

export function setWatcherManager(wm: WatcherManager): void {
  watcherManager = wm;
}

function getWatcherManager(): WatcherManager {
  if (!watcherManager) throw new Error("WatcherManager not initialized");
  return watcherManager;
}

const PUBLIC_ROUTES = new Set(["auth/login", "auth/logout", "auth/me"]);

function actionPermission(req: { type: string; workspaceId?: string }): Permission | Permission[] | null {
  switch (req.type) {
    // Workspace
    case "workspace/list":
    case "workspace/get":
      return "workspace:read";
    case "workspace/create":
      return "workspace:write";
    case "workspace/members/list":
      return "workspace:read";
    case "workspace/members/add":
    case "workspace/members/remove":
      return "workspace:write";
    // Provider / profile
    case "provider/list":
    case "provider/get":
      return "provider:manage";
    case "provider/create":
    case "provider/update":
    case "provider/delete":
    case "provider/test":
      return "provider:manage";
    case "profile/list":
    case "profile/get":
      return "profile:manage";
    case "profile/create":
    case "profile/update":
    case "profile/delete":
    case "profile/health":
    case "profile/launchLogin":
    case "profile/lock":
    case "profile/unlock":
      return "profile:manage";
    // Conversation
    case "conversation/list":
      return "workspace:read";
    case "conversation/create":
      return "memory:write";
    case "conversation/get":
      return "workspace:read";
    case "conversation/delete":
      return "memory:write";
    // Run
    case "run/list":
    case "run/get":
    case "run/events":
      return "workspace:read";
    case "run/create":
      return "run:create";
    case "run/cancel":
      return "run:cancel";
    case "run/stream":
      return "run:create";
    // Watcher
    case "watcher/list":
      return "workspace:read";
    case "watcher/create":
    case "watcher/update":
    case "watcher/toggle":
    case "watcher/delete":
    case "watcher/run":
      return "watcher:manage";
    // Documents / skills / vault
    case "document/list":
    case "document/open":
    case "document/reveal":
    case "vault/list":
    case "vault/read":
      return "workspace:read";
    case "vault/write":
    case "document/generate":
      return "memory:write";
    case "skills/list":
      return "skills:read";
    case "skills/pin":
    case "skills/import":
      return "skills:write";
    case "skills/delete":
      return "skills:delete";
    case "skills/export":
      return "skills:read";
    // Memory
    case "memory/list":
      return "memory:read";
    case "memory/delete":
      return "memory:write";
    case "memory/episodic/list":
      return "memory:read";
    case "memory/episodic/create":
      return "memory:write";
    case "memory/episodic/delete":
      return "memory:write";
    // Graph
    case "graph/list":
    case "graph/get":
    case "graph/query":
      return "memory:read";
    case "graph/createNode":
    case "graph/createEdge":
    case "graph/delete":
      return "memory:write";
    // Orchestration
    case "session/create":
      return "run:create";
    case "session/start":
      return "run:create";
    case "session/get":
    case "session/events":
    case "session/working-set":
      return "workspace:read";
    // Approvals
    case "session/approve":
    case "session/reject":
      return "run:create";
    case "session/approvals":
      return "workspace:read";
    // Connectors
    case "connector/list":
      return "workspace:read";
    case "connector/create":
    case "connector/update":
    case "connector/delete":
    case "connector/sync":
    case "connector/runs":
    case "connector/state/get":
      return "connector:manage";
    // Anomaly rules
    case "watcher/rules/list":
      return "workspace:read";
    case "watcher/rules/create":
    case "watcher/rules/delete":
      return "watcher:manage";
    // Model roles
    case "model-roles/list":
      return "workspace:read";
    case "model-roles/set":
    case "model-roles/delete":
      return "workspace:write";
    // Harness configs
    case "harness-configs/list":
    case "harness-configs/get":
    case "harness-configs/test":
      return "workspace:read";
    case "harness-configs/update":
      return "workspace:write";
    // Admin tenant-scoped
    case "admin/user/list":
    case "admin/user/create":
    case "admin/user/update":
    case "admin/user/delete":
      return "user:manage";
    case "admin/role/list":
    case "admin/role/create":
    case "admin/role/delete":
    case "admin/role/assign-permission":
    case "admin/role/revoke-permission":
      return "role:manage";
    case "admin/tenant/list":
      return "workspace:read";
    case "admin/tenant/members/add":
    case "admin/tenant/members/remove":
      return "user:manage";
    // Stats / CLI
    case "stats/list":
    case "cli/detect":
      return "workspace:read";
    // Viewport
    case "viewport/start":
    case "viewport/stop":
      return "profile:manage";
    // Ingestion
    case "ingestion/scan":
      return "workspace:read";
    case "ingestion/retry":
      return "memory:write";
    default:
      return null;
  }
}

async function extractSession(raw: unknown): Promise<{ userId: string; tenantId: string; roleId: string } | null> {
  const token = typeof raw === "object" && raw !== null && "authToken" in raw ? String(raw.authToken) : undefined;
  if (!token) return null;
  return verifySession(token);
}

async function authorizeRequest(
  d: CarbonDatabase,
  raw: unknown,
  request: { type: string; workspaceId?: string },
): Promise<{ session: { userId: string; tenantId: string; roleId: string } } | { error: string; code: string }> {
  if (PUBLIC_ROUTES.has(request.type)) {
    return { session: { userId: "", tenantId: "", roleId: "" } };
  }
  const session = await extractSession(raw);
  if (!session) {
    return { error: "Unauthorized", code: "UNAUTHORIZED" };
  }
  const required = actionPermission(request);
  if (!required) return { session };
  const permissions = Array.isArray(required) ? required : [required];
  const workspaceId = request.workspaceId ? String(request.workspaceId) : undefined;
  for (const p of permissions) {
    if (await hasPermission(d, session.userId, p, { workspaceId, tenantId: session.tenantId })) {
      return { session };
    }
  }
  return { error: "Forbidden", code: "FORBIDDEN" };
}

async function stampOwnership(table: string, id: string, session: { userId: string; tenantId: string }): Promise<void> {
  try {
    const db = await ensureRawDb();
    runStmt(
      db,
      `UPDATE ${table} SET tenant_id = COALESCE(tenant_id, ?), owner_id = COALESCE(owner_id, ?), user_id = COALESCE(user_id, ?) WHERE id = ?`,
      [session.tenantId, session.userId, session.userId, id],
    );
  } catch (err) {
    console.warn(`[stampOwnership] failed for ${table}:${id}`, err);
  }
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
  let toolSequence: unknown[];
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

function mapProviderRow(row: Record<string, unknown> | undefined) {
  if (!row) throw new Error("Provider row missing");
  return {
    id: String(row.id),
    type: String(row.type) as "anthropic" | "openai" | "custom-openai",
    name: String(row.name ?? ""),
    baseUrl: row.base_url == null ? undefined : String(row.base_url),
    model: String(row.model ?? ""),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapWatcherRow(row: Record<string, unknown>) {
  let rules: Array<Record<string, unknown>> = [];
  try { rules = JSON.parse(String(row.rules_json ?? "[]")) as Array<Record<string, unknown>>; } catch { rules = []; }
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name ?? row.prompt ?? "Watcher"),
    prompt: String(row.prompt ?? ""),
    trigger: String(row.trigger ?? "cron") as "cron" | "filesystem",
    cronExpression: String(row.cron_expression ?? ""),
    watchPath: row.watch_path == null ? null : String(row.watch_path),
    recursive: Number(row.recursive ?? 1) !== 0,
    enabled: Boolean(Number(row.enabled ?? 0)),
    profileId: row.profile_id == null ? null : String(row.profile_id),
    rules: rules.map((r) => mapWatcherRuleRow(r)),
    lastRunAt: row.last_run_at == null ? null : String(row.last_run_at),
    lastRunStatus: row.last_run_status == null ? null : String(row.last_run_status),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapEpisodicEventRow(row: Record<string, unknown>) {
  let details: Record<string, unknown> = {};
  let embedding: number[] = [];
  try { details = JSON.parse(String(row.details_json ?? "{}")) as Record<string, unknown>; } catch { details = {}; }
  try { embedding = JSON.parse(String(row.embedding_json ?? "[]")) as number[]; } catch { embedding = []; }
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    type: String(row.type),
    summary: String(row.summary),
    details,
    outcome: String(row.outcome),
    embedding,
    importance: Number(row.importance ?? 0.5),
    accessCount: Number(row.access_count ?? 0),
    decayFactor: Number(row.decay_factor ?? 1.0),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    lastAccessedAt: String(row.last_accessed_at ?? new Date().toISOString()),
  };
}

function mapHarnessConfigRow(row: Record<string, unknown>) {
  let qualityGates: string[];
  try { qualityGates = JSON.parse(String(row.quality_gates_json ?? "[]")) as string[]; } catch { qualityGates = []; }
  let extraJson: Record<string, unknown>;
  try { extraJson = JSON.parse(String(row.extra_json ?? "{}")) as Record<string, unknown>; } catch { extraJson = {}; }
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    harnessId: String(row.harness_id),
    enabled: Boolean(Number(row.enabled ?? 1)),
    taskTemplate: row.task_template == null ? null : String(row.task_template),
    qualityGates,
    extraJson,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapUserRow(row: Record<string, unknown> | undefined) {
  if (!row) throw new Error("User row missing");
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    email: String(row.email),
    name: row.name == null ? null : String(row.name),
    active: Boolean(Number(row.active ?? 1)),
    roleId: String(row.role_id),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapRoleRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    isSystem: Boolean(Number(row.is_system ?? 0)),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapTenantMemberRow(row: Record<string, unknown>) {
  return {
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    roleId: String(row.role_id),
    email: String(row.email),
    name: row.name == null ? null : String(row.name),
    roleName: String(row.role_name),
  };
}

function mapWorkspaceMemberRow(row: Record<string, unknown>) {
  return {
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    roleId: String(row.role_id),
    email: String(row.email),
    name: row.name == null ? null : String(row.name),
    roleName: String(row.role_name),
  };
}

function mapMemoryRow(row: Record<string, unknown>) {
  let tags: string[];
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

function mapOrchestrationSessionRow(row: Record<string, unknown> | undefined) {
  if (!row) throw new Error("Session row missing");
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    runId: String(row.run_id),
    root: JSON.parse(String(row.root_json)),
    supervisionMode: String(row.supervision_mode),
    status: String(row.status),
    currentGoal: String(row.current_goal),
    completionSummary: row.completion_summary == null ? null : String(row.completion_summary),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSessionEventRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: String(row.role),
    kind: String(row.kind),
    summary: String(row.summary),
    payload: JSON.parse(String(row.payload_json ?? "{}")),
    createdAt: String(row.created_at),
  };
}

function mapGraphNodeRow(row: Record<string, unknown>) {
  let properties: Record<string, unknown>;
  try { properties = JSON.parse(String(row.properties_json ?? "{}")) as Record<string, unknown>; } catch { properties = {}; }
  let embedding: number[];
  try { embedding = JSON.parse(String(row.embedding_json ?? "[]")) as number[]; } catch { embedding = []; }
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    entityType: String(row.entity_type),
    properties,
    embedding,
    mentionCount: Number(row.mention_count ?? 1),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapGraphEdgeRow(row: Record<string, unknown>) {
  let properties: Record<string, unknown>;
  try { properties = JSON.parse(String(row.properties_json ?? "{}")) as Record<string, unknown>; } catch { properties = {}; }
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sourceId: String(row.source_id),
    targetId: String(row.target_id),
    relationType: String(row.relation_type),
    weight: Number(row.weight ?? 0.5),
    properties,
    documentId: row.document_id == null ? null : String(row.document_id),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapConnectorConfigRow(row: Record<string, unknown>) {
  let options: Record<string, unknown> = {};
  try { options = JSON.parse(String(row.options_json ?? "{}")) as Record<string, unknown>; } catch { options = {}; }
  return {
    id: String(row.id),
    name: String(row.name),
    workspaceId: String(row.workspace_id),
    type: String(row.type),
    enabled: Boolean(Number(row.enabled ?? 1)),
    schedule: row.schedule == null ? null : String(row.schedule),
    credentialsEncrypted: row.credentials_encrypted == null ? null : String(row.credentials_encrypted),
    options,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapConnectorRunRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    connectorId: String(row.connector_id),
    workspaceId: String(row.workspace_id),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at == null ? null : String(row.finished_at),
    status: String(row.status),
    itemsProcessed: Number(row.items_processed ?? 0),
    errorMessage: row.error_message == null ? null : String(row.error_message),
  };
}

function mapConnectorStateRow(row: Record<string, unknown>) {
  return {
    connectorId: String(row.connector_id),
    workspaceId: String(row.workspace_id),
    cursor: row.cursor == null ? null : String(row.cursor),
    lastItemId: row.last_item_id == null ? null : String(row.last_item_id),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapWatcherRuleRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    watcherId: String(row.watcher_id),
    metric: String(row.metric),
    operator: String(row.operator),
    threshold: row.threshold == null ? null : Number(row.threshold),
    windowMinutes: Number(row.window_minutes ?? 60),
    severity: String(row.severity ?? "warning"),
    enabled: Boolean(Number(row.enabled ?? 1)),
    targetId: row.target_id == null ? null : String(row.target_id),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function mapWorkingSetRow(sessionId: string, row: Record<string, unknown> | undefined) {
  return {
    sessionId,
    entities: JSON.parse(String(row?.entities_json ?? "[]")),
    documents: JSON.parse(String(row?.documents_json ?? "[]")),
    metrics: JSON.parse(String(row?.metrics_json ?? "[]")),
    gaps: JSON.parse(String(row?.gaps_json ?? "[]")),
    provenanceScore: Number(row?.provenance_score ?? 0),
    updatedAt: String(row?.updated_at ?? new Date().toISOString()),
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
    const raw = rawRequest as Record<string, unknown>;
    const request = IpcRequestSchema.parse(rawRequest);
    const d = (await ensureDb()) as OrchestrationDb;

    const authResult = await authorizeRequest(d, raw, request);
    if ("error" in authResult) {
      return { type: "error", error: authResult.error, code: authResult.code };
    }
    const session = authResult.session;

    // Capture workspace id if present on the request for access checks already done above.
    const workspaceId = "workspaceId" in request && typeof request.workspaceId === "string" ? request.workspaceId : undefined;
    if (workspaceId && session.userId) {
      const ok = await canAccessWorkspace(d, session.userId, workspaceId);
      if (!ok) {
        return { type: "error", error: "Forbidden", code: "FORBIDDEN" };
      }
    }

    switch (request.type) {
      // ==================== Auth ====================
      case "auth/login": {
        const result = await login(request.email, request.password);
        if (!result) return { type: "error", error: "Invalid credentials", code: "AUTH_FAILED" };
        const user = await d.getUserById(result.session.userId);
        if (!user) return { type: "error", error: "Invalid credentials", code: "AUTH_FAILED" };
        return {
          type: "auth/login.success",
          data: {
            token: result.token,
            user: {
              id: String(user.id),
              tenantId: String(user.tenant_id),
              email: String(user.email),
              name: user.name ? String(user.name) : null,
              active: Boolean(Number(user.active)),
              roleId: String(user.role_id),
              createdAt: String(user.created_at),
              updatedAt: String(user.updated_at),
            },
          },
        };
      }
      case "auth/logout": {
        const token = typeof raw.authToken === "string" ? raw.authToken : undefined;
        if (token) await logout(token);
        return { type: "auth/logout.success" };
      }
      case "auth/me": {
        if (!session.userId) return { type: "error", error: "Unauthorized", code: "UNAUTHORIZED" };
        const user = await d.getUserById(session.userId);
        if (!user) return { type: "error", error: "Unauthorized", code: "UNAUTHORIZED" };
        return {
          type: "auth/session.success",
          data: {
            id: String(user.id),
            tenantId: String(user.tenant_id),
            email: String(user.email),
            name: user.name ? String(user.name) : null,
            active: Boolean(Number(user.active)),
            roleId: String(user.role_id),
            createdAt: String(user.created_at),
            updatedAt: String(user.updated_at),
          },
        };
      }

      // ==================== Admin / Users ====================
      case "admin/user/list": {
        const rows = await d.listUsersForTenant(session.tenantId);
        return {
          type: "admin/user/list.success",
          data: rows.map((row) => ({
            id: String(row.id),
            tenantId: String(row.tenant_id),
            email: String(row.email),
            name: row.name ? String(row.name) : null,
            active: Boolean(Number(row.active)),
            roleId: String(row.role_id),
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
          })),
        };
      }
      case "admin/user/create": {
        const id = crypto.randomUUID();
        const { email, name, password, roleId } = request.data;
        await d.createUser({
          id,
          tenantId: session.tenantId,
          email,
          name,
          passwordHash: await hashPassword(password),
          roleId,
          active: true,
        });
        const user = await d.getUserById(id);
        return { type: "admin/user/create.success", data: mapUserRow(user) };
      }
      case "admin/user/update": {
        await d.updateUser(request.id, {
          email: request.data.email,
          name: request.data.name,
          roleId: request.data.roleId,
          active: request.data.active,
        });
        const user = await d.getUserById(request.id);
        return { type: "admin/user/update.success", data: mapUserRow(user) };
      }
      case "admin/user/delete": {
        await d.deleteUser(request.id);
        return { type: "admin/user/delete.success" };
      }

      // ==================== Admin / Roles ====================
      case "admin/role/list": {
        const rows = await d.listRoles(session.tenantId);
        return {
          type: "admin/role/list.success",
          data: rows.map((row) => mapRoleRow(row as Record<string, unknown>)),
        };
      }
      case "admin/role/create": {
        const id = crypto.randomUUID();
        await d.createRole({
          id,
          tenantId: session.tenantId,
          name: request.data.name,
          description: request.data.description ?? null,
        });
        if (request.data.permissionIds) {
          for (const pid of request.data.permissionIds) {
            await d.assignPermission(id, pid);
          }
        }
        const role = await d.getRole(id);
        return { type: "admin/role/create.success", data: mapRoleRow(role as Record<string, unknown>) };
      }
      case "admin/role/delete": {
        await d.deleteRole(request.id);
        return { type: "admin/role/delete.success" };
      }
      case "admin/role/assign-permission": {
        await d.assignPermission(request.id, request.permissionId);
        return { type: "admin/role/assign-permission.success" };
      }
      case "admin/role/revoke-permission": {
        await d.revokePermission(request.id, request.permissionId);
        return { type: "admin/role/revoke-permission.success" };
      }

      // ==================== Admin / Tenants ====================
      case "admin/tenant/list": {
        const rows = await d.listTenants();
        return {
          type: "admin/tenant/list.success",
          data: rows.map((row) => ({
            id: String(row.id),
            name: String(row.name),
            createdAt: String(row.created_at),
          })),
        };
      }
      case "admin/tenant/members/add": {
        await d.addTenantMember(request.tenantId, request.userId, request.roleId);
        const [tenantMember] = await d.listTenantMembers(request.tenantId);
        return {
          type: "admin/tenant/members/add.success",
          data: tenantMember ? mapTenantMemberRow(tenantMember as Record<string, unknown>) : null,
        };
      }
      case "admin/tenant/members/remove": {
        // Removing a tenant member is equivalent to deleting the user for this local-only phase.
        await d.deleteUser(request.userId);
        return { type: "admin/tenant/members/remove.success" };
      }

      // ==================== Workspace Membership ====================
      case "workspace/members/list": {
        const rows = await d.listWorkspaceMembers(request.workspaceId);
        return {
          type: "workspace/members/list.success",
          data: rows.map((row) => mapWorkspaceMemberRow(row as Record<string, unknown>)),
        };
      }
      case "workspace/members/add": {
        await d.addWorkspaceMember(request.workspaceId, request.userId, request.roleId);
        const rows = await d.listWorkspaceMembers(request.workspaceId);
        const member = rows.find((r) => String(r.user_id) === request.userId);
        return {
          type: "workspace/members/add.success",
          data: member ? mapWorkspaceMemberRow(member as Record<string, unknown>) : null,
        };
      }
      case "workspace/members/remove": {
        await d.removeWorkspaceMember(request.workspaceId, request.userId);
        return { type: "workspace/members/remove.success" };
      }

      // ==================== Provider ====================
      case "provider/list": {
        const rows = await d.listProviders();
        return { type: "provider/list.success", data: rows.map((row) => mapProviderRow(row as Record<string, unknown>)) };
      }
      case "provider/create": {
        const id = crypto.randomUUID();
        await d.createProvider({
          id,
          type: request.data.type,
          name: request.data.name,
          apiKey: request.data.apiKey,
          baseUrl: request.data.baseUrl,
          model: request.data.model,
          tenantId: session.tenantId,
          userId: session.userId,
        });
        await stampOwnership("ai_providers", id, session);
        const created = await d.getProvider(id);
        return { type: "provider/create.success", data: mapProviderRow(created as Record<string, unknown> | undefined) };
      }
      case "provider/update": {
        await d.updateProvider(request.id, { type: request.data.type, name: request.data.name, apiKey: request.data.apiKey, baseUrl: request.data.baseUrl, model: request.data.model });
        const updated = await d.getProvider(request.id);
        return { type: "provider/update.success", data: mapProviderRow(updated as Record<string, unknown> | undefined) };
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
          profileDir: request.data.profileDir ?? "",
          cdpUrl: request.data.cdpUrl,
          cdpFingerprint: request.data.cdpFingerprint,
          targetDomains: request.data.targetDomains ?? ["*"],
          tenantId: session.tenantId,
          userId: session.userId,
        });
        await stampOwnership("browser_profiles", id, session);
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
        await d.updateProfile(request.id, updateData);
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
        await d.updateProfile(request.id, { status: result.status, lastCheckedAt: new Date().toISOString() });
        return { type: "profile/health.success", status: result.status, lastCheckedAt: new Date().toISOString() };
      }
      case "profile/launchLogin": {
        const row = await d.getProfile(request.id);
        if (!row) return { type: "error", error: "Profile not found", code: "PROFILE_NOT_FOUND" };
        const result = await launchLoginPortal(request.id, row.profile_dir as string);
        if (result.success) await d.updateProfile(request.id, { status: "active" });
        return { type: "profile/launchLogin.success" };
      }
      case "profile/lock": {
        const row = await d.getProfile(request.id);
        if (!row) return { type: "error", error: "Profile not found", code: "PROFILE_NOT_FOUND" };
        const cdpUrl = row.cdp_url as string | undefined;
        await lockProfile(request.id, (row.profile_dir as string) ?? "", cdpUrl ?? undefined);
        await d.updateProfile(request.id, { status: "locked" });
        await startProfileTelemetry(request.id);
        return { type: "profile/lock.success" };
      }
      case "profile/unlock": {
        await unlockProfile(request.id);
        await d.updateProfile(request.id, { status: "active" });
        stopProfileTelemetry(request.id);
        return { type: "profile/unlock.success" };
      }

      // ==================== Workspace ====================
      case "workspace/list": {
        const rows = session.userId ? await d.listWorkspacesForUser(session.userId) : await d.listWorkspaces();
        return { type: "workspace/list.success", data: rows };
      }
      case "workspace/create": {
        const id = crypto.randomUUID();
        await d.createWorkspace({
          id,
          name: request.data.name,
          description: request.data.description,
          vaultDir: request.data.vaultDir,
          tenantId: session.tenantId,
          userId: session.userId,
        });
        if (session.userId) {
          // Creator automatically becomes workspace admin.
          const adminRole = await d.getRoleByName(session.tenantId, "admin");
          if (adminRole) {
            await d.addWorkspaceMember(id, session.userId, String(adminRole.id));
          }
        }
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
            session,
            approvalCoordinator: getApprovalCoordinator(),
            onRuntime: (runtime) => {
              activeRuns.set(request.id, runtime);
            },
          });
        } finally {
          activeRuns.delete(request.id);
        }
        return { type: "run/stream.complete" };
      }

      // ==================== Orchestration ====================
      case "session/create": {
        const id = crypto.randomUUID();
        await d.createOrchestrationSession({
          id,
          workspaceId: request.workspaceId,
          conversationId: request.conversationId,
          runId: request.runId,
          rootKind: request.root.kind,
          rootJson: JSON.stringify(request.root),
          supervisionMode: request.supervisionMode,
          status: "draft",
          currentGoal: request.goal,
        });
        const row = await d.getOrchestrationSession(id);
        const session = mapOrchestrationSessionRow(row as Record<string, unknown> | undefined);
        emitSessionUpdate({ sessionId: session.id, status: session.status, currentGoal: session.currentGoal });
        return { type: "session/create.success", data: session };
      }
      case "session/get": {
        const row = await d.getOrchestrationSession(request.id);
        if (!row) return { type: "error", error: "Session not found", code: "SESSION_NOT_FOUND" };
        return { type: "session/get.success", data: mapOrchestrationSessionRow(row as Record<string, unknown>) };
      }
      case "session/events": {
        const rows = await d.listSessionEvents(request.id);
        return { type: "session/events.success", events: rows.map((row: Record<string, unknown>) => mapSessionEventRow(row)) };
      }
      case "session/working-set": {
        const row = await d.getSessionWorkingSet(request.id);
        return { type: "session/working-set.success", data: mapWorkingSetRow(request.id, row as Record<string, unknown> | undefined) };
      }

      // ==================== Approvals ====================
      case "session/approve": {
        const approved = getApprovalCoordinator().approve(request.correlationId);
        return { type: "session/approve.success", approved };
      }
      case "session/reject": {
        const rejected = getApprovalCoordinator().reject(request.correlationId, request.reason);
        return { type: "session/reject.success", rejected };
      }
      case "session/approvals": {
        const pending = getApprovalCoordinator().listPending(request.sessionId);
        return { type: "session/approvals.success", approvals: pending };
      }

      case "session/start": {
        const row = await d.getOrchestrationSession(request.id);
        if (!row) return { type: "error", error: "Session not found", code: "SESSION_NOT_FOUND" };
        const run = await d.getRun(String(row.run_id));
        if (!run) return { type: "error", error: "Run not found", code: "RUN_NOT_FOUND" };
        if (!run.provider_id) return { type: "error", error: "Run has no provider", code: "PROVIDER_NOT_FOUND" };
        const root = JSON.parse(String(row.root_json)) as { kind: "outlook-thread"; threadId: string; threadSubject: string; mailbox: string };
        const runId = String(row.run_id);
        let runResult: Awaited<ReturnType<typeof runAgent>>;
        try {
          runResult = await runAgent({
            db: d,
            workspaceId: String(row.workspace_id),
            conversationId: String(row.conversation_id),
            providerId: String(run.provider_id),
            message: String(row.current_goal),
            runId,
            session,
            sessionId: String(row.id),
            sessionGoal: String(row.current_goal),
            sessionRoot: root,
            supervisionMode: String(row.supervision_mode) as "watch" | "confirm",
            approvalCoordinator: getApprovalCoordinator(),
            onRuntime: (runtime) => {
              activeRuns.set(runId, runtime);
            },
          });
        } finally {
          activeRuns.delete(runId);
        }
        await d.updateOrchestrationSessionStatus(String(row.id), runResult.runStatus, runResult.runError ?? null);
        emitSessionUpdate({ sessionId: String(row.id), status: runResult.runStatus, currentGoal: String(row.current_goal) });
        const workingSet = await d.getSessionWorkingSet(String(row.id));
        if (workingSet) {
          emitSessionWorkingSet({
            sessionId: String(row.id),
            documents: JSON.parse(String(workingSet.documents_json ?? "[]")),
            gaps: JSON.parse(String(workingSet.gaps_json ?? "[]")),
            provenanceScore: Number(workingSet.provenance_score ?? 0),
          });
        }
        return { type: "session/start.success", data: runResult };
      }

      // ==================== Ingestion ====================
      case "ingestion/scan": {
        const files = scanDocumentsDir();
        return { type: "ingestion/scan.success", jobs: files.map((file) => ({
          id: crypto.randomUUID(), documentId: crypto.randomUUID(), status: "pending" as const, chunksCreated: 0, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), originalName: file.name, fileType: file.mimeType, size: file.sizeBytes,
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
        await d.createWatcher({
          id,
          workspaceId: data.workspaceId,
          name: data.name,
          trigger: data.trigger ?? "cron",
          cronExpression: data.cronExpression ?? (data.trigger === "filesystem" ? "" : "*/5 * * * *"),
          watchPath: data.watchPath ?? null,
          recursive: data.recursive ?? true,
          prompt: data.prompt,
          enabled: data.enabled,
          profileId: data.profileId ?? null,
        });
        const created = await d.getWatcher(id);
        await getWatcherManager().sync(id);
        return { type: "watcher/create.success", data: mapWatcherRow(created as Record<string, unknown>) };
      }
      case "watcher/update": {
        const data = request.data;
        await d.updateWatcher(request.id, {
          name: data.name,
          profileId: data.profileId,
          trigger: data.trigger,
          cronExpression: data.cronExpression,
          watchPath: data.watchPath,
          recursive: data.recursive,
          prompt: data.prompt,
          enabled: data.enabled,
        });
        await getWatcherManager().sync(request.id);
        const updated = await d.getWatcher(request.id);
        return { type: "watcher/update.success", data: mapWatcherRow(updated as Record<string, unknown>) };
      }
      case "watcher/toggle": {
        const row = await d.getWatcher(request.id);
        if (!row) return { type: "error", error: "Watcher not found", code: "NOT_FOUND" };
        const newEnabled = !(row.enabled === 1 || row.enabled === true);
        await d.updateWatcher(request.id, { enabled: newEnabled });
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
        const rows = await d.listSkills(request.workspaceId, session.tenantId);
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
        const exported = await dbExportSkills(request.workspaceId, session.tenantId);
        return { type: "skills/export.success", data: exported };
      }
      case "skills/import": {
        const result = await dbImportSkills(request.data as Parameters<typeof dbImportSkills>[0], session.tenantId);
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

      // ==================== Harness Configs ====================
      case "harness-configs/list": {
        const rows = await d.listHarnessConfigs(request.workspaceId);
        const defaults: Array<{ harnessId: string; enabled: boolean; taskTemplate: string | null; qualityGates: string[]; extraJson: Record<string, unknown> }> = [
          { harnessId: "browser",      enabled: true, taskTemplate: "Collect evidence from authenticated browser portals. Use stealth_open, stealth_scrape, and stealth_download tools.", qualityGates: ["At least 2 distinct sources must corroborate key claims"], extraJson: {} },
          { harnessId: "claude-code",  enabled: true, taskTemplate: "Refactor, edit, and generate code across the workspace. Use terminal and file editing tools.", qualityGates: [], extraJson: {} },
          { harnessId: "codex",        enabled: true, taskTemplate: "Generate new modules and analyze code autonomously. Sandboxed to the workspace.", qualityGates: [], extraJson: {} },
          { harnessId: "local",        enabled: true, taskTemplate: "Research topics, extract structured data from text, and draft documents. Use reasoning and synthesis.", qualityGates: [], extraJson: {} },
        ];
        const byId = new Map<string, Record<string, unknown>>();
        for (const row of rows) byId.set(String(row.harness_id), row as unknown as Record<string, unknown>);
        const data = defaults.map((def) => {
          const row = byId.get(def.harnessId);
          if (row) return mapHarnessConfigRow(row);
          return {
            id: crypto.randomUUID(),
            workspaceId: request.workspaceId,
            harnessId: def.harnessId,
            enabled: def.enabled,
            taskTemplate: def.taskTemplate,
            qualityGates: def.qualityGates,
            extraJson: def.extraJson,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });
        return { type: "harness-configs/list.success", data };
      }
      case "harness-configs/get": {
        const row = await d.getHarnessConfig(request.workspaceId, request.harnessId);
        if (!row) return { type: "harness-configs/get.success", data: null };
        return { type: "harness-configs/get.success", data: mapHarnessConfigRow(row as unknown as Record<string, unknown>) };
      }
      case "harness-configs/update": {
        await d.upsertHarnessConfig({
          id: request.id,
          workspaceId: request.workspaceId,
          harnessId: request.harnessId,
          enabled: request.data.enabled,
          taskTemplate: request.data.taskTemplate,
          qualityGatesJson: request.data.qualityGates ? JSON.stringify(request.data.qualityGates) : undefined,
          extraJson: request.data.extraJson ? JSON.stringify(request.data.extraJson) : undefined,
        });
        const row = await d.getHarnessConfig(request.workspaceId, request.harnessId);
        return { type: "harness-configs/update.success", data: mapHarnessConfigRow(row as unknown as Record<string, unknown>) };
      }
      case "harness-configs/test": {
        const harnessId = request.harnessId as string;
        if (harnessId === "claude-code" || harnessId === "codex") {
          const cliType = harnessId === "claude-code" ? "claude-code" : "codex";
          const result = await detectCli(cliType);
          if (result.installed) {
            return { type: "harness-configs/test.success", passed: true, message: `${result.cli} found${result.version ? ` (${result.version})` : ""}` };
          }
          return { type: "harness-configs/test.success", passed: false, message: `${result.cli} not installed. Install with: ${result.installCommand}` };
        }
        if (harnessId === "browser") {
          return { type: "harness-configs/test.success", passed: true, message: "Browser harness readiness is verified when a Cloak Bridge profile is locked." };
        }
        return { type: "harness-configs/test.success", passed: false, message: `Connection test not available for harness ${harnessId}.` };
      }

      // ==================== Graph Memory ====================
      case "graph/list": {
        const rows = await d.findGraphNodes({ workspaceId: request.workspaceId });
        return { type: "graph/list.success", data: rows.map((row) => mapGraphNodeRow(row as Record<string, unknown>)) };
      }
      case "graph/get": {
        const row = await d.getGraphNode(request.id);
        if (!row) return { type: "error", error: "Node not found", code: "NOT_FOUND" };
        return { type: "graph/get.success", data: mapGraphNodeRow(row as Record<string, unknown>) };
      }
      case "graph/createNode": {
        const id = crypto.randomUUID();
        await d.storeGraphNode({
          id,
          workspaceId: request.workspaceId,
          type: request.entityType,
          label: request.label,
          properties: request.properties,
          embedding: request.embedding,
        });
        const row = await d.getGraphNode(id);
        return { type: "graph/createNode.success", data: mapGraphNodeRow(row as Record<string, unknown>) };
      }
      case "graph/createEdge": {
        const id = crypto.randomUUID();
        // Ensure endpoints exist so referential integrity is satisfied.
        const [sourceNode, targetNode] = await Promise.all([
          d.getGraphNode(request.sourceId),
          d.getGraphNode(request.targetId),
        ]);
        if (!sourceNode || !targetNode) {
          return { type: "error", error: "Source or target node not found", code: "NOT_FOUND" };
        }
        await d.storeGraphEdge({
          id,
          sourceId: request.sourceId,
          targetId: request.targetId,
          relationType: request.relationType,
          workspaceId: request.workspaceId,
          documentId: request.documentId,
          weight: request.weight,
        });
        const row = await d.getGraphEdge(id);
        return { type: "graph/createEdge.success", data: mapGraphEdgeRow(row as Record<string, unknown>) };
      }
      case "graph/delete": {
        if (request.kind === "node") {
          await d.deleteGraphNode(request.id);
        } else {
          await d.deleteGraphEdge(request.id);
        }
        return { type: "graph/delete.success" };
      }
      case "graph/query": {
        const edges = await d.findGraphEdges({
          workspaceId: request.workspaceId,
          relationType: request.relationType,
        });
        return { type: "graph/query.success", data: edges.map((row) => mapGraphEdgeRow(row as Record<string, unknown>)) };
      }

      // ==================== Episodic Memory ====================
      case "memory/episodic/list": {
        const rows = await d.findEpisodicEvents({
          workspaceId: request.workspaceId,
          types: request.eventType,
          outcome: request.outcome,
          after: request.after,
          before: request.before,
          limit: request.limit ?? 100,
          includeEmbeddings: false,
        });
        return { type: "memory/episodic/list.success", data: rows.map((row) => mapEpisodicEventRow(row as Record<string, unknown>)) };
      }
      case "memory/episodic/create": {
        const id = crypto.randomUUID();
        await d.storeEpisodicEvent({
          id,
          workspaceId: request.workspaceId,
          type: request.eventType ?? "task",
          summary: request.summary,
          details: request.details ?? { source: "manual" },
          outcome: request.outcome ?? "success",
          importance: request.importance ?? 0.5,
          embedding: [],
        });
        const row = await d.findEpisodicEvents({ workspaceId: request.workspaceId, types: request.eventType ?? "task", limit: 1 });
        const created = row.find((r) => String(r.id) === id);
        if (!created) return { type: "error", error: "Event not saved", code: "NOT_FOUND" };
        return { type: "memory/episodic/create.success", data: mapEpisodicEventRow(created as Record<string, unknown>) };
      }
      case "memory/episodic/delete": {
        await d.deleteEpisodicEvents(request.ids);
        return { type: "memory/episodic/delete.success" };
      }

      // ==================== Stats ====================
      case "stats/list": {
        return { type: "stats/list.success", activeRuns: Math.max(activeRuns.size, await d.countRunningRuns()) };
      }

      // ==================== Connectors (Phase 3) ====================
      case "connector/list": {
        const rows = await d.listConnectorConfigs(request.workspaceId);
        return { type: "connector/list.success", data: rows.map((row) => mapConnectorConfigRow(row as Record<string, unknown>)) };
      }
      case "connector/create": {
        const id = crypto.randomUUID();
        await d.createConnectorConfig({
          id,
          workspaceId: request.data.workspaceId,
          name: request.data.name,
          type: request.data.type,
          enabled: request.data.enabled ?? true,
          schedule: request.data.schedule ?? null,
          credentials: request.data.credentials ?? null,
          options: request.data.options,
        });
        const row = await d.getConnectorConfig(id);
        return { type: "connector/create.success", data: mapConnectorConfigRow(row as Record<string, unknown>) };
      }
      case "connector/update": {
        await d.updateConnectorConfig(request.id, {
          name: request.data.name,
          enabled: request.data.enabled,
          schedule: request.data.schedule ?? undefined,
          credentials: request.data.credentials ?? undefined,
          options: request.data.options,
        });
        const row = await d.getConnectorConfig(request.id);
        return { type: "connector/update.success", data: mapConnectorConfigRow(row as Record<string, unknown>) };
      }
      case "connector/delete": {
        d.deleteConnectorConfig(request.id).catch(() => {});
        return { type: "connector/delete.success" };
      }
      case "connector/sync": {
        const row = await d.getConnectorConfig(request.id);
        if (!row) return { type: "error", error: "Connector not found", code: "NOT_FOUND" };
        const config: ConnectorConfig = {
          id: String(row.id),
          name: String(row.name),
          workspaceId: String(row.workspace_id),
          type: String(row.type) as ConnectorConfig["type"],
          enabled: Boolean(Number(row.enabled ?? 1)),
          schedule: row.schedule == null ? null : String(row.schedule),
          credentialsEncrypted: row.credentials_encrypted == null ? null : String(row.credentials_encrypted),
          options: JSON.parse(String(row.options_json ?? "{}")) as Record<string, unknown>,
        };
        // Run sync asynchronously so the IPC response can return quickly.
        (async () => {
          try {
            const adapter = resolveConnectorAdapter(config.type);
            const memoryAdapter = memoryAdapterForWorkspace(
              {
                storeGraphNode: (opts) => d.storeGraphNode(opts),
                storeGraphEdge: (opts) => d.storeGraphEdge(opts),
                storeEpisodicEvent: (opts) => d.storeEpisodicEvent(opts),
                getConnectorState: async (connectorId, workspaceId) => {
                  const r = await d.getConnectorState(connectorId);
                  if (!r) return undefined;
                  return { workspaceId, cursor: r.cursor ? String(r.cursor) : null, lastItemId: r.last_item_id ? String(r.last_item_id) : null };
                },
                updateConnectorState: (connectorId, workspaceId, s) =>
                  d.updateConnectorState({ connectorId, workspaceId, cursor: s.cursor ?? undefined, lastItemId: s.lastItemId ?? undefined }),
              },
              config.workspaceId,
            );
            const ingester: ConnectorItemIngester = {
              ingest: async (item, cfg, adapter) => {
                const { runIngestionPipeline } = await import("@carbon-agent/ingestion");
                const id = crypto.createHash("sha256").update(`${cfg.id}:${item.id}:${item.contentHash ?? item.body.slice(0, 200)}`).digest("hex").slice(0, 24);
                await runIngestionPipeline({
                  id,
                  workspaceId: cfg.workspaceId,
                  source: `${cfg.type}://${cfg.id}/${item.id}`,
                  content: `${item.title}\n\n${item.body}`.trim(),
                  mimeType: item.attachments?.length ? "multipart/related" : "text/plain",
                }, { memory: adapter });
              },
            };

            const run = await runConnectorSync(
              {
                recordConnectorRun: (r) => d.recordConnectorRun(r),
                getConnectorState: async (connectorId) => {
                  const r = await d.getConnectorState(connectorId);
                  if (!r) return undefined;
                  return { cursor: r.cursor ? String(r.cursor) : null, lastItemId: r.last_item_id ? String(r.last_item_id) : null };
                },
                updateConnectorState: (connectorId, workspaceId, s) =>
                  d.updateConnectorState({ connectorId, workspaceId, cursor: s.cursor ?? undefined, lastItemId: s.lastItemId ?? undefined }),
              },
              config,
              adapter,
              memoryAdapter,
              { ingester },
            );
            getWatcherManager().submitConnectorSyncResult({
              connectorId: config.id,
              workspaceId: config.workspaceId,
              itemsProcessed: run.itemsProcessed,
            }).catch(() => {});
          } catch (e) {
            console.error("[Connector] sync error", e);
            await d.recordConnectorRun({
              id: crypto.randomUUID(),
              connectorId: request.id,
              workspaceId: config.workspaceId,
              startedAt: new Date().toISOString(),
              status: "failed",
              errorMessage: e instanceof Error ? e.message : String(e),
            });
          }
        })().catch(() => {});

        return { type: "connector/sync.success", data: { id: crypto.randomUUID(), connectorId: request.id, workspaceId: config.workspaceId, startedAt: new Date().toISOString(), finishedAt: null, status: "running", itemsProcessed: 0, errorMessage: null } };
      }
      case "connector/runs": {
        const rows = await d.listConnectorRuns(request.id, request.limit ?? 50);
        return { type: "connector/runs.success", data: rows.map((row) => mapConnectorRunRow(row as Record<string, unknown>)) };
      }
      case "connector/state/get": {
        const row = await d.getConnectorState(request.id);
        return { type: "connector/state/get.success", data: row ? mapConnectorStateRow(row as Record<string, unknown>) : null };
      }

      // ==================== Anomaly Rules (Phase 3) ====================
      case "watcher/rules/list": {
        const rows = await d.listAnomalyRulesForWatcher(request.watcherId);
        return { type: "watcher/rules/list.success", data: rows.map((row) => mapWatcherRuleRow(row as Record<string, unknown>)) };
      }
      case "watcher/rules/create": {
        const id = crypto.randomUUID();
        await d.createAnomalyRule({
          id,
          watcherId: request.watcherId,
          metric: request.data.metric,
          operator: request.data.operator,
          threshold: request.data.threshold ?? null,
          windowMinutes: request.data.windowMinutes,
          severity: request.data.severity,
          enabled: request.data.enabled,
          targetId: request.data.targetId ?? null,
        });
        const rows = await d.listAnomalyRulesForWatcher(request.watcherId);
        const created = rows.find((r) => String(r.id) === id);
        return { type: "watcher/rules/create.success", data: mapWatcherRuleRow(created as Record<string, unknown>) };
      }
      case "watcher/rules/delete": {
        await d.deleteAnomalyRule(request.id);
        return { type: "watcher/rules/delete.success" };
      }

      default:
        return { type: "error", error: `Unhandled: ${(request as { type: string }).type}`, code: "UNHANDLED" };
    }
  } catch (err: unknown) {
    return { type: "error", error: err instanceof Error ? err.message : String(err), code: "VALIDATION_ERROR" };
  }
});
