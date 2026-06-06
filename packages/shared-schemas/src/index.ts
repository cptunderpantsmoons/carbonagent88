/**
 * Carbon Agent — Shared Zod Schemas
 * 
 * Strictly validated domain models. Every IPC payload between Renderer
 * and Main must use these schemas. No untyped data crosses the boundary.
 * 
 * Control Corridor: These schemas are the source of truth for all layers.
 * Neither Electron Main, Renderer, nor any package may invent ad-hoc types.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Timestamps & IDs
// ---------------------------------------------------------------------------

export const TimestampSchema = z.string().datetime().or(z.number());

export const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// AI Provider
// ---------------------------------------------------------------------------

export const AIProviderTypeSchema = z.enum(["anthropic", "openai", "custom-openai"]);

export const AIProviderConfigSchema = z.object({
  id: UuidSchema,
  type: AIProviderTypeSchema,
  name: z.string().min(1).max(128),
  apiKey: z.string().min(1), // stored encrypted in local store
  baseUrl: z.string().url().optional(), // required for custom-openai
  model: z.string().min(1).max(128),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type AIProviderConfig = z.infer<typeof AIProviderConfigSchema>;

// ---------------------------------------------------------------------------
// Browser Profile
// ---------------------------------------------------------------------------

export const BrowserProfileStatusSchema = z.enum(["active", "expired", "unknown", "locked"]);

export const BrowserProfileSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  profileDir: z.string().optional(), // absolute path to CloakBrowser profile (optional for cloud CDP)
  cdpUrl: z.string().url().optional(),
  cdpFingerprint: z.string().optional(),
  targetDomains: z.array(z.string().url().or(z.string().min(1))),
  status: BrowserProfileStatusSchema,
  lastCheckedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type BrowserProfile = z.infer<typeof BrowserProfileSchema>;

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const WorkspaceSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  vaultDir: z.string().min(1), // ~/.carbon-agent/vault/<workspace-id>/
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

// ---------------------------------------------------------------------------
// Conversation (Chat History)
// ---------------------------------------------------------------------------

export const RoleSchema = z.enum(["user", "assistant", "system"]);

export const MessageSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  role: RoleSchema,
  content: z.string().min(1),
  createdAt: TimestampSchema,
});

export type Message = z.infer<typeof MessageSchema>;

export const ConversationSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  title: z.string().max(512).default("New Conversation"),
  messages: z.array(MessageSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Conversation = z.infer<typeof ConversationSchema>;

// ---------------------------------------------------------------------------
// Run (Agent Execution)
// ---------------------------------------------------------------------------

export const RunStatusSchema = z.enum(["idle", "running", "paused", "completed", "failed", "cancelled"]);

export const RunSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  workspaceId: UuidSchema,
  providerId: UuidSchema.nullable(),
  status: RunStatusSchema,
  model: z.string().max(128).nullable(),
  messages: z.array(MessageSchema).default([]),
  jsonlLogPath: z.string().min(1), // path to the append-only JSONL file
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Run = z.infer<typeof RunSchema>;

// ---------------------------------------------------------------------------
// RunEvent (JSONL entries for audit trail)
// ---------------------------------------------------------------------------

export const RunEventTypeSchema = z.enum([
  // LLM
  "llm_request",
  "llm_response",
  "llm_error",
  // Tools
  "tool_call_start",
  "tool_call_end",
  "tool_call_error",
  // System
  "system_message",
  "ingestion_start",
  "ingestion_complete",
  "ingestion_error",
  // User
  "user_message",
  "assistant_message",
]);

export const RunEventSchema = z.object({
  id: UuidSchema,
  runId: UuidSchema,
  type: RunEventTypeSchema,
  timestamp: TimestampSchema,
  payload: z.record(z.unknown()), // flexible, typed by `type` at runtime
});

export type RunEvent = z.infer<typeof RunEventSchema>;

export const LearnedSkillSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  trigger: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  toolSequence: z.array(z.object({
    toolName: z.string().min(1),
    input: z.record(z.unknown()),
    notes: z.string().optional(),
  })),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  version: z.number().int().positive().default(1),
  lastUsedAt: TimestampSchema.nullable(),
  pinned: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type LearnedSkill = z.infer<typeof LearnedSkillSchema>;

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

export const WatcherStatusSchema = z.enum(["success", "failed", "running", "pending"]);

export const WatcherSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  name: z.string().min(1),
  prompt: z.string().min(1),
  cronExpression: z.string().min(1),
  enabled: z.boolean(),
  profileId: UuidSchema.nullable(),
  lastRunAt: TimestampSchema.nullable(),
  lastRunStatus: WatcherStatusSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Watcher = z.infer<typeof WatcherSchema>;

// ---------------------------------------------------------------------------
// Agent Memory
// ---------------------------------------------------------------------------

export const AgentMemorySchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  key: z.string().min(1),
  content: z.string(),
  tags: z.array(z.string()),
  source: z.string(),
  importance: z.number(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type AgentMemory = z.infer<typeof AgentMemorySchema>;

// ---------------------------------------------------------------------------
// Model Roles
// ---------------------------------------------------------------------------

export const ModelRoleNameSchema = z.enum(["assistant", "coder", "knowledge-graph", "meeting-notes", "track-block"]);

export type ModelRoleName = z.infer<typeof ModelRoleNameSchema>;

export const ModelRoleSchema = z.object({
  id: UuidSchema,
  role: ModelRoleNameSchema,
  providerId: UuidSchema,
  workspaceId: UuidSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ModelRole = z.infer<typeof ModelRoleSchema>;

// ---------------------------------------------------------------------------
// DataSource (ingested document source)
// ---------------------------------------------------------------------------

export const DataSourceTypeSchema = z.enum(["file", "browser_download", "web_scrape"]);

export const DataSourceSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  type: DataSourceTypeSchema,
  name: z.string().min(1).max(512),
  path: z.string().min(1),
  mimeType: z.string().max(128).nullable(),
  sizeBytes: z.number().int().positive().nullable(),
  sourceUrl: z.string().url().nullable(), // for browser_download / web_scrape
  profileId: UuidSchema.nullable(), // which browser profile was used
  ingestedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
});

export type DataSource = z.infer<typeof DataSourceSchema>;

// ---------------------------------------------------------------------------
// Document & DocumentChunk
// ---------------------------------------------------------------------------

export const DocumentSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  dataSourceId: UuidSchema,
  title: z.string().max(512),
  content: z.string(), // original extracted text
  chunkCount: z.number().int().nonnegative().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Document = z.infer<typeof DocumentSchema>;

export const GeneratedDocumentSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  dataSourceId: UuidSchema,
  title: z.string().max(512),
  content: z.string(),
  filePath: z.string().min(1),
  mimeType: z.string().nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  format: z.enum(["markdown", "docx", "pdf", "unknown"]),
  preview: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type GeneratedDocument = z.infer<typeof GeneratedDocumentSchema>;

export const DocumentChunkSchema = z.object({
  id: UuidSchema,
  documentId: UuidSchema,
  workspaceId: UuidSchema,
  chunkIndex: z.number().int().nonnegative(),
  content: z.string(),
  embedding: z.array(z.number()).optional(), // if embedded
  sourceUrl: z.string().url().nullable(),
  sourceProfileId: UuidSchema.nullable(),
  createdAt: TimestampSchema,
});

export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;

// ---------------------------------------------------------------------------
// Ingestion Job
// ---------------------------------------------------------------------------

export const IngestionStatusSchema = z.enum(["pending", "processing", "completed", "failed"]);

export const IngestionJobSchema = z.object({
  id: UuidSchema,
  documentId: UuidSchema,
  status: IngestionStatusSchema,
  chunksCreated: z.number().int().nonnegative().default(0),
  error: z.string().max(2048).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type IngestionJob = z.infer<typeof IngestionJobSchema>;

// ---------------------------------------------------------------------------
// Tool Calls (for the playground / event drawer)
// ---------------------------------------------------------------------------

export const ToolCallSchema = z.object({
  id: UuidSchema,
  runId: UuidSchema,
  toolName: z.enum([
    "stealth_open",
    "stealth_scrape",
    "stealth_download",
    "ingest_file",
    "rag_retrieve",
    "write_note",
  ]),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).nullable(),
  error: z.string().max(2048).nullable(),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

// ---------------------------------------------------------------------------
// IPC Contracts — Renderer → Main (requests)
// ---------------------------------------------------------------------------

export const IpcRequestSchema = z.discriminatedUnion("type", [
  // Provider
  z.object({ type: z.literal("provider/list") }),
  z.object({ type: z.literal("provider/create"), data: AIProviderConfigSchema.omit({ id: true, createdAt: true, updatedAt: true }) }),
  z.object({ type: z.literal("provider/update"), id: UuidSchema, data: AIProviderConfigSchema.omit({ id: true, createdAt: true, updatedAt: true }) }),
  z.object({ type: z.literal("provider/delete"), id: UuidSchema }),
  z.object({ type: z.literal("provider/test"), id: UuidSchema }),
  // Profile
  z.object({ type: z.literal("profile/list") }),
  z.object({ type: z.literal("profile/create"), data: BrowserProfileSchema.omit({ id: true, createdAt: true, updatedAt: true, status: true, lastCheckedAt: true }) }),
  z.object({ type: z.literal("profile/update"), id: UuidSchema, data: z.object({ name: z.string().optional(), description: z.string().optional(), profileDir: z.string().optional(), cdpUrl: z.string().url().optional(), cdpFingerprint: z.string().optional(), targetDomains: z.array(z.string()).optional() }) }),
  z.object({ type: z.literal("profile/delete"), id: UuidSchema }),
  z.object({ type: z.literal("profile/health"), id: UuidSchema }),
  z.object({ type: z.literal("profile/launchLogin"), id: UuidSchema }),
  z.object({ type: z.literal("profile/lock"), id: UuidSchema }),
  z.object({ type: z.literal("profile/unlock"), id: UuidSchema }),
  // Workspace
  z.object({ type: z.literal("workspace/list") }),
  z.object({ type: z.literal("workspace/create"), data: WorkspaceSchema.omit({ id: true, createdAt: true, updatedAt: true }) }),
  z.object({ type: z.literal("workspace/get"), id: UuidSchema }),
  // Conversation
  z.object({ type: z.literal("conversation/list"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("conversation/create"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("conversation/get"), id: UuidSchema }),
  z.object({ type: z.literal("conversation/delete"), id: UuidSchema }),
  // Run
  z.object({ type: z.literal("run/list"), conversationId: UuidSchema }),
  z.object({ type: z.literal("run/create"), conversationId: UuidSchema, providerId: UuidSchema.nullable() }),
  z.object({ type: z.literal("run/get"), id: UuidSchema }),
  z.object({ type: z.literal("run/cancel"), id: UuidSchema }),
  z.object({ type: z.literal("run/stream"), id: UuidSchema, message: z.string() }),
  z.object({ type: z.literal("run/events"), id: UuidSchema }),
  // Ingestion
  z.object({ type: z.literal("ingestion/scan"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("ingestion/retry"), jobId: UuidSchema }),
  // Watcher
  z.object({ type: z.literal("watcher/list") }),
  z.object({ type: z.literal("watcher/create"), data: z.object({ workspaceId: UuidSchema, name: z.string().min(1), cronExpression: z.string().min(1), prompt: z.string().min(1), enabled: z.boolean(), profileId: UuidSchema.nullable().optional() }) }),
  z.object({ type: z.literal("watcher/update"), id: UuidSchema, data: z.object({ workspaceId: UuidSchema, name: z.string().min(1), cronExpression: z.string().min(1), prompt: z.string().min(1), enabled: z.boolean(), profileId: UuidSchema.nullable().optional() }) }),
  z.object({ type: z.literal("watcher/toggle"), id: UuidSchema }),
  z.object({ type: z.literal("watcher/delete"), id: UuidSchema }),
  z.object({ type: z.literal("watcher/run"), id: UuidSchema }),
  // Document generation
  z.object({ type: z.literal("document/generate"), data: z.object({ workspaceId: z.string(), title: z.string(), content: z.string(), format: z.enum(["markdown", "docx", "pdf"]) }) }),
  // Vault / Documents / Skills
  z.object({ type: z.literal("vault/list"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("vault/read"), workspaceId: UuidSchema, filePath: z.string().min(1) }),
  z.object({ type: z.literal("vault/write"), workspaceId: UuidSchema, filePath: z.string().min(1), content: z.string() }),
  z.object({ type: z.literal("document/list"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("document/open"), filePath: z.string().min(1) }),
  z.object({ type: z.literal("document/reveal"), filePath: z.string().min(1) }),
  z.object({ type: z.literal("skills/list"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("skills/pin"), id: UuidSchema, pinned: z.boolean() }),
  z.object({ type: z.literal("skills/delete"), id: UuidSchema }),
  z.object({ type: z.literal("skills/export"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("skills/import"), data: z.array(z.object({
    id: z.string(),
    workspaceId: z.string(),
    trigger: z.string(),
    triggerEmbedding: z.array(z.number()),
    name: z.string(),
    description: z.string(),
    toolSequence: z.array(z.object({ toolName: z.string(), input: z.record(z.unknown()), notes: z.string().optional() })),
    successCount: z.number(),
    failureCount: z.number(),
    pinned: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })) }),
  // Live viewport
  z.object({ type: z.literal("viewport/start"), profileId: UuidSchema }),
  z.object({ type: z.literal("viewport/stop"), profileId: UuidSchema }),
  // CLI detection
  z.object({ type: z.literal("cli/detect") }),
  // Memory
  z.object({ type: z.literal("memory/list"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("memory/delete"), id: UuidSchema }),
  // Model Roles
  z.object({ type: z.literal("model-roles/list"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("model-roles/set"), data: z.object({ role: ModelRoleNameSchema, providerId: UuidSchema, workspaceId: UuidSchema }) }),
  z.object({ type: z.literal("model-roles/delete"), role: ModelRoleNameSchema, workspaceId: UuidSchema }),
  // Stats
  z.object({ type: z.literal("stats/list") }),
]);

export type IpcRequest = z.infer<typeof IpcRequestSchema>;

// ---------------------------------------------------------------------------
// IPC Contracts — Main → Renderer (responses)
// ---------------------------------------------------------------------------

export const IpcResponseSchema = z.discriminatedUnion("type", [
  // Success wrappers
  z.object({ type: z.literal("provider/list.success"), data: z.array(AIProviderConfigSchema) }),
  z.object({ type: z.literal("provider/create.success"), data: AIProviderConfigSchema }),
  z.object({ type: z.literal("provider/update.success"), data: AIProviderConfigSchema }),
  z.object({ type: z.literal("provider/delete.success") }),
  z.object({ type: z.literal("provider/test.success"), status: z.string() }),
  z.object({ type: z.literal("profile/list.success"), data: z.array(BrowserProfileSchema) }),
  z.object({ type: z.literal("profile/create.success"), data: BrowserProfileSchema }),
  z.object({ type: z.literal("profile/update.success"), data: BrowserProfileSchema }),
  z.object({ type: z.literal("profile/delete.success") }),
  z.object({ type: z.literal("profile/health.success"), status: BrowserProfileStatusSchema, lastCheckedAt: TimestampSchema.nullable() }),
  z.object({ type: z.literal("profile/launchLogin.success") }),
  z.object({ type: z.literal("profile/lock.success") }),
  z.object({ type: z.literal("profile/unlock.success") }),
  z.object({ type: z.literal("workspace/list.success"), data: z.array(WorkspaceSchema) }),
  z.object({ type: z.literal("workspace/create.success"), data: WorkspaceSchema }),
  z.object({ type: z.literal("workspace/get.success"), data: WorkspaceSchema }),
  z.object({ type: z.literal("conversation/list.success"), data: z.array(ConversationSchema) }),
  z.object({ type: z.literal("conversation/create.success"), data: ConversationSchema }),
  z.object({ type: z.literal("conversation/get.success"), data: ConversationSchema }),
  z.object({ type: z.literal("conversation/delete.success") }),
  z.object({ type: z.literal("run/list.success"), data: z.array(RunSchema) }),
  z.object({ type: z.literal("run/create.success"), data: RunSchema }),
  z.object({ type: z.literal("run/get.success"), data: RunSchema }),
  z.object({ type: z.literal("run/cancel.success") }),
  z.object({ type: z.literal("run/stream.success"), chunk: z.string() }),
  z.object({ type: z.literal("run/stream.complete") }),
  z.object({ type: z.literal("run/events.success"), events: z.array(RunEventSchema) }),
  z.object({ type: z.literal("ingestion/scan.success"), jobs: z.array(IngestionJobSchema) }),
  z.object({ type: z.literal("ingestion/retry.success"), data: IngestionJobSchema }),
  z.object({ type: z.literal("vault/list.success"), files: z.array(z.string()) }),
  z.object({ type: z.literal("vault/read.success"), content: z.string() }),
  z.object({ type: z.literal("vault/write.success") }),
  z.object({ type: z.literal("document/list.success"), data: z.array(GeneratedDocumentSchema) }),
  z.object({ type: z.literal("document/open.success") }),
  z.object({ type: z.literal("document/reveal.success") }),
  z.object({ type: z.literal("skills/list.success"), data: z.array(LearnedSkillSchema) }),
  z.object({ type: z.literal("skills/pin.success"), data: z.object({ id: z.string(), pinned: z.boolean() }) }),
  z.object({ type: z.literal("skills/delete.success") }),
  z.object({ type: z.literal("skills/export.success"), data: z.array(z.unknown()) }),
  z.object({ type: z.literal("skills/import.success"), data: z.object({ imported: z.number(), skipped: z.number() }) }),
  // Watcher responses
  z.object({ type: z.literal("watcher/list.success"), data: z.array(WatcherSchema) }),
  z.object({ type: z.literal("watcher/create.success"), data: WatcherSchema }),
  z.object({ type: z.literal("watcher/update.success"), data: WatcherSchema }),
  z.object({ type: z.literal("watcher/toggle.success"), data: z.object({ id: z.string(), enabled: z.boolean() }) }),
  z.object({ type: z.literal("watcher/delete.success") }),
  z.object({ type: z.literal("watcher/run.success") }),
  // Document generation responses
  z.object({ type: z.literal("document/generate.success"), data: z.object({ filePath: z.string(), finalContent: z.string() }) }),
  z.object({ type: z.literal("viewport/start.success") }),
  z.object({ type: z.literal("viewport/stop.success") }),
  z.object({ type: z.literal("cli/detect.success"), data: z.array(z.object({
    cli: z.enum(["claude-code", "codex"]),
    installed: z.boolean(),
    version: z.string().optional(),
    error: z.string().optional(),
    installCommand: z.string(),
  })) }),
  // Memory responses
  z.object({ type: z.literal("memory/list.success"), data: z.array(AgentMemorySchema) }),
  z.object({ type: z.literal("memory/delete.success") }),
  // Model Roles responses
  z.object({ type: z.literal("model-roles/list.success"), data: z.array(ModelRoleSchema) }),
  z.object({ type: z.literal("model-roles/set.success"), data: ModelRoleSchema.nullable() }),
  z.object({ type: z.literal("model-roles/delete.success") }),
  // Stats
  z.object({ type: z.literal("stats/list.success"), activeRuns: z.number() }),
  // Errors
  z.object({ type: z.literal("error"), error: z.string(), code: z.string().optional() }),
  // Events (streaming)
  z.object({ type: z.literal("event"), event: RunEventSchema }),
]);

export type IpcResponse = z.infer<typeof IpcResponseSchema>;
