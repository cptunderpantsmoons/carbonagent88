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

export const AIProviderPublicSchema = AIProviderConfigSchema.omit({ apiKey: true });

export type AIProviderPublic = z.infer<typeof AIProviderPublicSchema>;

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
// Anomaly Rules (Phase 3)
// ---------------------------------------------------------------------------

export const AnomalyMetricSchema = z.enum([
  "new_file_count",
  "file_size",
  "run_failure_rate",
  "connector_item_count",
]);

export const AnomalyOperatorSchema = z.enum(["gt", "lt", "eq", "changed"]);

export const AnomalySeveritySchema = z.enum(["info", "warning", "critical"]);

export const WatcherRuleSchema = z.object({
  id: UuidSchema,
  watcherId: UuidSchema,
  metric: AnomalyMetricSchema,
  operator: AnomalyOperatorSchema,
  threshold: z.number().nullable().optional(),
  windowMinutes: z.number().int().positive().default(60),
  severity: AnomalySeveritySchema.default("warning"),
  enabled: z.boolean().default(true),
  targetId: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type WatcherRule = z.infer<typeof WatcherRuleSchema>;

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

export const WatcherStatusSchema = z.enum(["success", "failed", "running", "pending"]);

export const WatcherTriggerSchema = z.enum(["cron", "filesystem"]);

export const WatcherSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  name: z.string().min(1),
  prompt: z.string().min(1),
  trigger: WatcherTriggerSchema.default("cron"),
  cronExpression: z.string().default(""),
  watchPath: z.string().nullable().optional(),
  recursive: z.boolean().default(true),
  enabled: z.boolean(),
  profileId: UuidSchema.nullable(),
  rules: z.array(WatcherRuleSchema.omit({ watcherId: true })).default([]),
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
// Episodic Memory
// ---------------------------------------------------------------------------

export const EpisodicEventTypeSchema = z.enum(["conversation", "task", "tool_use", "decision", "error"]);

export const EpisodicOutcomeSchema = z.enum(["success", "failure", "partial"]);

export const EpisodicEventSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  type: EpisodicEventTypeSchema,
  summary: z.string().min(1),
  details: z.record(z.unknown()).default({}),
  outcome: EpisodicOutcomeSchema,
  embedding: z.array(z.number()).default([]),
  importance: z.number().min(0).max(1).default(0.5),
  accessCount: z.number().int().nonnegative().default(0),
  decayFactor: z.number().min(0).max(1).default(1),
  createdAt: TimestampSchema,
  lastAccessedAt: TimestampSchema,
});

export type EpisodicEvent = z.infer<typeof EpisodicEventSchema>;

// ---------------------------------------------------------------------------
// Model Roles
// ---------------------------------------------------------------------------

export const ModelRoleNameSchema = z.enum(["assistant", "planner", "browser", "knowledge-graph", "validator", "judge", "coder", "meeting-notes", "track-block"]);

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
  originalName: z.string().optional(),
  fileType: z.string().optional(),
  size: z.number().optional(),
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
    "delegate_task",
    "memory_recall",
    "memory_store",
  ]),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).nullable(),
  error: z.string().max(2048).nullable(),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

// ---------------------------------------------------------------------------
// Browser Orchestration
// ---------------------------------------------------------------------------

export const SupervisionModeSchema = z.enum(["watch", "confirm"]);

export const SessionSourceSchema = z.enum([
  "outlook-thread",
  "sharepoint",
  "monday",
  "xero",
  "spreadsheet-web",
]);

export const OrchestrationSessionStatusSchema = z.enum([
  "draft",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

export const CoreAgentRoleSchema = z.enum([
  "main-assistant",
  "goals",
  "planner",
  "browser",
  "harness",
  "knowledge",
  "validator",
  "judge",
]);

export const SessionRootSchema = z.object({
  kind: z.literal("outlook-thread"),
  threadId: z.string().min(1),
  threadSubject: z.string().min(1),
  mailbox: z.string().min(1),
});

export const WorkingSetDocumentSchema = z.object({
  id: UuidSchema,
  source: SessionSourceSchema,
  title: z.string().min(1),
  mimeType: z.string().nullable(),
  filePath: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  provenance: z.array(z.string()).default([]),
});

export const SessionEventKindSchema = z.enum([
  "goal_defined",
  "plan_updated",
  "browser_action_started",
  "browser_action_completed",
  "harness_action_started",
  "harness_action_completed",
  "action_denied",
  "document_discovered",
  "document_acquired",
  "working_set_updated",
  "validation_passed",
  "validation_failed",
  "judgment_requested",
  "judgment_returned",
  "drift_detected",
  "specialist_spawned",
  "specialist_completed",
  "output_approved",
  "output_rejected",
]);

export const OrchestrationSessionSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  conversationId: UuidSchema,
  runId: UuidSchema,
  root: SessionRootSchema,
  supervisionMode: SupervisionModeSchema,
  status: OrchestrationSessionStatusSchema,
  currentGoal: z.string().min(1),
  completionSummary: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type OrchestrationSession = z.infer<typeof OrchestrationSessionSchema>;

export const SessionEventSchema = z.object({
  id: UuidSchema,
  sessionId: UuidSchema,
  role: CoreAgentRoleSchema,
  kind: SessionEventKindSchema,
  summary: z.string().min(1),
  payload: z.record(z.unknown()),
  createdAt: TimestampSchema,
});

export type SessionEvent = z.infer<typeof SessionEventSchema>;

export const SessionWorkingSetSchema = z.object({
  sessionId: UuidSchema,
  entities: z.array(z.record(z.unknown())).default([]),
  documents: z.array(WorkingSetDocumentSchema).default([]),
  metrics: z.array(z.record(z.unknown())).default([]),
  gaps: z.array(z.string()).default([]),
  provenanceScore: z.number().min(0).max(1).default(0),
  updatedAt: TimestampSchema,
});

export type SessionWorkingSet = z.infer<typeof SessionWorkingSetSchema>;

// ---------------------------------------------------------------------------
// Human-in-the-Loop Approval
// ---------------------------------------------------------------------------

export const ApprovalKindSchema = z.enum(["tool", "plan", "plan-step"]);

export const ApprovalPrioritySchema = z.enum(["low", "medium", "high"]);

export const ApprovalDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});

export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalRequestSchema = z.object({
  correlationId: UuidSchema,
  sessionId: UuidSchema,
  kind: ApprovalKindSchema,
  priority: ApprovalPrioritySchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  toolName: z.string().optional(),
  arguments: z.record(z.unknown()).optional(),
  requestedAt: TimestampSchema,
  timeoutAt: TimestampSchema.optional(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const SessionApprovalRequestSchema = ApprovalRequestSchema;

// ---------------------------------------------------------------------------
// Graph Memory
// ---------------------------------------------------------------------------

export const GraphNodeSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  name: z.string().min(1),
  entityType: z.string().min(1),
  properties: z.record(z.unknown()).default({}),
  embedding: z.array(z.number()).default([]),
  mentionCount: z.number().int().nonnegative().default(1),
  createdAt: TimestampSchema,
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  sourceId: UuidSchema,
  targetId: UuidSchema,
  relationType: z.string().min(1),
  weight: z.number().min(0).max(1).default(0.5),
  properties: z.record(z.unknown()).default({}),
  documentId: UuidSchema.optional(),
  createdAt: TimestampSchema,
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphStatsSchema = z.object({
  totalNodes: z.number().int().nonnegative(),
  totalEdges: z.number().int().nonnegative(),
  byEntityType: z.record(z.number().int().nonnegative()),
  byRelationType: z.record(z.number().int().nonnegative()),
  averageDegree: z.number(),
});

export type GraphStats = z.infer<typeof GraphStatsSchema>;

// ---------------------------------------------------------------------------
// Harness Config
// ---------------------------------------------------------------------------

export const HarnessConfigSchema = z.object({
  id: UuidSchema,
  workspaceId: UuidSchema,
  harnessId: z.string().min(1),
  enabled: z.boolean().default(true),
  taskTemplate: z.string().max(4000).nullable(),
  qualityGates: z.array(z.string()).default([]),
  extraJson: z.record(z.unknown()).default({}),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;

export const HarnessConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  taskTemplate: z.string().max(4000).optional(),
  qualityGates: z.array(z.string()).optional(),
  extraJson: z.record(z.unknown()).optional(),
});

export type HarnessConfigUpdate = z.infer<typeof HarnessConfigUpdateSchema>;

// ---------------------------------------------------------------------------
// Connectors (Phase 3)
// ---------------------------------------------------------------------------

export const ConnectorTypeSchema = z.enum(["directory", "rest", "email", "calendar", "pm", "database"]);

export const ConnectorConfigSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(256),
  workspaceId: UuidSchema,
  type: ConnectorTypeSchema,
  enabled: z.boolean().default(true),
  schedule: z.string().nullable().optional(),
  credentialsEncrypted: z.string().nullable().optional(),
  options: z.record(z.unknown()).default({}),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

export const ConnectorRunStatusSchema = z.enum(["success", "failed", "partial", "running"]);

export const ConnectorRunSchema = z.object({
  id: UuidSchema,
  connectorId: UuidSchema,
  workspaceId: UuidSchema,
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.nullable(),
  status: ConnectorRunStatusSchema,
  itemsProcessed: z.number().int().nonnegative().default(0),
  errorMessage: z.string().max(2048).nullable().optional(),
});

export type ConnectorRun = z.infer<typeof ConnectorRunSchema>;

export const ConnectorStateSchema = z.object({
  connectorId: z.string().min(1),
  workspaceId: z.string().min(1),
  cursor: z.string().nullable(),
  lastItemId: z.string().nullable(),
  updatedAt: TimestampSchema,
});

export type ConnectorState = z.infer<typeof ConnectorStateSchema>;

// ---------------------------------------------------------------------------
// Authentication / Authorization
// ---------------------------------------------------------------------------

export const TenantSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1),
  createdAt: TimestampSchema,
});

export type Tenant = z.infer<typeof TenantSchema>;

export const UserSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  email: z.string().email(),
  name: z.string().nullable().optional(),
  active: z.boolean(),
  roleId: UuidSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type User = z.infer<typeof UserSchema>;

export const UserRoleSchema = z.object({
  id: UuidSchema,
  tenantId: UuidSchema,
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  isSystem: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type UserRole = z.infer<typeof UserRoleSchema>;

export const PermissionSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export type Permission = z.infer<typeof PermissionSchema>;

export const TenantMemberSchema = z.object({
  tenantId: UuidSchema,
  userId: UuidSchema,
  roleId: UuidSchema,
  email: z.string().email(),
  name: z.string().nullable().optional(),
  roleName: z.string(),
});

export type TenantMember = z.infer<typeof TenantMemberSchema>;

export const WorkspaceMemberSchema = z.object({
  workspaceId: UuidSchema,
  userId: UuidSchema,
  roleId: UuidSchema,
  email: z.string().email(),
  name: z.string().nullable().optional(),
  roleName: z.string(),
});

export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const LoginRequestSchema = z.object({
  type: z.literal("auth/login"),
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const SessionResponseSchema = z.object({
  token: z.string().min(1),
  user: UserSchema,
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const AuthTokenFieldSchema = z.object({
  authToken: z.string().optional(),
});

// ---------------------------------------------------------------------------
// IPC Contracts — Renderer → Main (requests)
// ---------------------------------------------------------------------------

export const SessionCreateRequestSchema = z.object({
  type: z.literal("session/create"),
  workspaceId: UuidSchema,
  conversationId: UuidSchema,
  runId: UuidSchema,
  root: SessionRootSchema,
  supervisionMode: SupervisionModeSchema,
  goal: z.string().min(1),
});

export const SessionStartRequestSchema = z.object({
  type: z.literal("session/start"),
  id: UuidSchema,
});

export const SessionGetRequestSchema = z.object({
  type: z.literal("session/get"),
  id: UuidSchema,
});

export const SessionEventsRequestSchema = z.object({
  type: z.literal("session/events"),
  id: UuidSchema,
});

export const SessionWorkingSetRequestSchema = z.object({
  type: z.literal("session/working-set"),
  id: UuidSchema,
});

export const SessionApproveRequestSchema = z.object({
  type: z.literal("session/approve"),
  sessionId: UuidSchema,
  correlationId: UuidSchema,
});

export const SessionRejectRequestSchema = z.object({
  type: z.literal("session/reject"),
  sessionId: UuidSchema,
  correlationId: UuidSchema,
  reason: z.string().optional(),
});

export const SessionApprovalsRequestSchema = z.object({
  type: z.literal("session/approvals"),
  sessionId: UuidSchema,
});

export const StrictIpcRequestSchema = z.discriminatedUnion("type", [
  // Auth
  LoginRequestSchema,
  z.object({ type: z.literal("auth/logout") }),
  z.object({ type: z.literal("auth/me") }),
  // Admin users
  z.object({ type: z.literal("admin/user/create"), data: z.object({ email: z.string().email(), name: z.string().optional(), password: z.string().min(6), roleId: UuidSchema }) }),
  z.object({ type: z.literal("admin/user/update"), id: UuidSchema, data: z.object({ email: z.string().email().optional(), name: z.string().optional(), roleId: UuidSchema.optional(), active: z.boolean().optional() }) }),
  z.object({ type: z.literal("admin/user/delete"), id: UuidSchema }),
  z.object({ type: z.literal("admin/user/list") }),
  // Admin roles
  z.object({ type: z.literal("admin/role/create"), data: z.object({ name: z.string().min(1), description: z.string().optional(), permissionIds: z.array(UuidSchema).optional() }) }),
  z.object({ type: z.literal("admin/role/delete"), id: UuidSchema }),
  z.object({ type: z.literal("admin/role/list") }),
  z.object({ type: z.literal("admin/role/assign-permission"), id: UuidSchema, permissionId: UuidSchema }),
  z.object({ type: z.literal("admin/role/revoke-permission"), id: UuidSchema, permissionId: UuidSchema }),
  // Admin tenants
  z.object({ type: z.literal("admin/tenant/list") }),
  z.object({ type: z.literal("admin/tenant/members/add"), tenantId: UuidSchema, userId: UuidSchema, roleId: UuidSchema }),
  z.object({ type: z.literal("admin/tenant/members/remove"), tenantId: UuidSchema, userId: UuidSchema }),
  // Workspace membership
  z.object({ type: z.literal("workspace/members/add"), workspaceId: UuidSchema, userId: UuidSchema, roleId: UuidSchema }),
  z.object({ type: z.literal("workspace/members/remove"), workspaceId: UuidSchema, userId: UuidSchema }),
  z.object({ type: z.literal("workspace/members/list"), workspaceId: UuidSchema }),
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
  // Orchestration
  SessionCreateRequestSchema,
  SessionStartRequestSchema,
  SessionGetRequestSchema,
  SessionEventsRequestSchema,
  SessionWorkingSetRequestSchema,
  // Approvals
  SessionApproveRequestSchema,
  SessionRejectRequestSchema,
  SessionApprovalsRequestSchema,
  // Ingestion
  z.object({ type: z.literal("ingestion/scan"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("ingestion/retry"), jobId: UuidSchema }),
  // Watcher
  z.object({ type: z.literal("watcher/list") }),
  z.object({ type: z.literal("watcher/create"), data: z.object({ workspaceId: UuidSchema, name: z.string().min(1), cronExpression: z.string().min(1).optional(), watchPath: z.string().optional(), recursive: z.boolean().optional(), prompt: z.string().min(1), enabled: z.boolean(), profileId: UuidSchema.nullable().optional(), trigger: WatcherTriggerSchema.optional() }) }),
  z.object({ type: z.literal("watcher/update"), id: UuidSchema, data: z.object({ workspaceId: UuidSchema, name: z.string().min(1), cronExpression: z.string().min(1).optional(), watchPath: z.string().optional(), recursive: z.boolean().optional(), prompt: z.string().min(1), enabled: z.boolean(), profileId: UuidSchema.nullable().optional(), trigger: WatcherTriggerSchema.optional() }) }),
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

  // Episodic Memory
  z.object({ type: z.literal("memory/episodic/list"), workspaceId: UuidSchema, eventType: EpisodicEventTypeSchema.optional(), outcome: EpisodicOutcomeSchema.optional(), after: z.string().datetime().optional(), before: z.string().datetime().optional(), limit: z.number().int().positive().optional() }),
  z.object({ type: z.literal("memory/episodic/create"), workspaceId: UuidSchema, summary: z.string().min(1), details: z.record(z.unknown()).optional(), eventType: EpisodicEventTypeSchema.optional(), outcome: EpisodicOutcomeSchema.optional(), importance: z.number().min(0).max(1).optional() }),
  z.object({ type: z.literal("memory/episodic/delete"), ids: z.array(UuidSchema).min(1) }),

  // Model Roles
  z.object({ type: z.literal("model-roles/list"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("model-roles/set"), data: z.object({ role: ModelRoleNameSchema, providerId: UuidSchema, workspaceId: UuidSchema }) }),
  z.object({ type: z.literal("model-roles/delete"), role: ModelRoleNameSchema, workspaceId: UuidSchema }),
  // Stats
  z.object({ type: z.literal("stats/list") }),
  // Graph Memory
  z.object({ type: z.literal("graph/list"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("graph/get"), id: UuidSchema }),
  z.object({ type: z.literal("graph/createNode"), workspaceId: UuidSchema, entityType: z.string().min(1), label: z.string().min(1), properties: z.record(z.unknown()).optional(), embedding: z.array(z.number()).optional() }),
  z.object({ type: z.literal("graph/createEdge"), workspaceId: UuidSchema, sourceId: UuidSchema, targetId: UuidSchema, relationType: z.string().min(1), documentId: UuidSchema.optional(), weight: z.number().min(0).max(1).optional() }),
  z.object({ type: z.literal("graph/delete"), id: UuidSchema, kind: z.enum(["node", "edge"]) }),
  z.object({ type: z.literal("graph/query"), workspaceId: UuidSchema, nodeIds: z.array(UuidSchema).optional(), relationType: z.string().optional(), hops: z.number().int().min(1).max(5).optional() }),
  // Harness Configs
  z.object({ type: z.literal("harness-configs/list"), workspaceId: UuidSchema }),
  z.object({ type: z.literal("harness-configs/get"), workspaceId: UuidSchema, harnessId: z.string() }),
  z.object({ type: z.literal("harness-configs/update"), id: UuidSchema, workspaceId: UuidSchema, harnessId: z.string(), data: HarnessConfigUpdateSchema }),
  z.object({ type: z.literal("harness-configs/test"), workspaceId: UuidSchema, harnessId: z.string() }),

  // Connectors (Phase 3)
  z.object({ type: z.literal("connector/list"), workspaceId: UuidSchema }),
  z.object({
    type: z.literal("connector/create"),
    data: z.object({
      name: z.string().min(1),
      workspaceId: UuidSchema,
      type: ConnectorTypeSchema,
      enabled: z.boolean().optional(),
      schedule: z.string().optional(),
      credentials: z.string().optional(),
      options: z.record(z.unknown()).optional(),
    }),
  }),
  z.object({
    type: z.literal("connector/update"),
    id: UuidSchema,
    data: z.object({
      name: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
      schedule: z.string().optional(),
      credentials: z.string().optional(),
      options: z.record(z.unknown()).optional(),
    }),
  }),
  z.object({ type: z.literal("connector/delete"), id: UuidSchema }),
  z.object({ type: z.literal("connector/sync"), id: UuidSchema }),
  z.object({ type: z.literal("connector/runs"), id: UuidSchema, limit: z.number().int().positive().optional() }),
  z.object({ type: z.literal("connector/state/get"), id: UuidSchema }),

  // Anomaly rules (Phase 3)
  z.object({
    type: z.literal("watcher/rules/list"),
    watcherId: UuidSchema,
  }),
  z.object({
    type: z.literal("watcher/rules/create"),
    data: WatcherRuleSchema.omit({ id: true, watcherId: true, createdAt: true, updatedAt: true }),
    watcherId: UuidSchema,
  }),
  z.object({ type: z.literal("watcher/rules/delete"), id: UuidSchema }),
]);

export const IpcRequestSchema = z.preprocess(
  (val) => {
    if (val && typeof val === "object") {
      const next = { ...(val as Record<string, unknown>) };
      delete next.authToken;
      return next;
    }
    return val;
  },
  StrictIpcRequestSchema,
);

export type StrictIpcRequest = z.infer<typeof StrictIpcRequestSchema>;
export type IpcRequest = StrictIpcRequest & { authToken?: string };

// ---------------------------------------------------------------------------
// IPC Contracts — Main → Renderer (responses)
// ---------------------------------------------------------------------------

export const LoginSuccessSchema = z.object({
  type: z.literal("auth/login.success"),
  data: SessionResponseSchema,
});

export const SessionVerifySuccessSchema = z.object({
  type: z.literal("auth/session.success"),
  data: UserSchema,
});

export const UserListSuccessSchema = z.object({
  type: z.literal("admin/user/list.success"),
  data: z.array(UserSchema),
});

export const RoleListSuccessSchema = z.object({
  type: z.literal("admin/role/list.success"),
  data: z.array(UserRoleSchema),
});

export const TenantListSuccessSchema = z.object({
  type: z.literal("admin/tenant/list.success"),
  data: z.array(TenantSchema),
});

export const WorkspaceMemberListSuccessSchema = z.object({
  type: z.literal("workspace/members/list.success"),
  data: z.array(WorkspaceMemberSchema),
});

export const SessionCreateSuccessSchema = z.object({
  type: z.literal("session/create.success"),
  data: OrchestrationSessionSchema,
});

export const SessionGetSuccessSchema = z.object({
  type: z.literal("session/get.success"),
  data: OrchestrationSessionSchema,
});

export const SessionStartSuccessSchema = z.object({
  type: z.literal("session/start.success"),
  data: z.object({
    runStatus: z.enum(["completed", "failed", "cancelled"]),
    fullResponse: z.string(),
    runError: z.string().optional(),
    runId: UuidSchema,
  }),
});

export const SessionEventsSuccessSchema = z.object({
  type: z.literal("session/events.success"),
  events: z.array(SessionEventSchema),
});

export const SessionWorkingSetSuccessSchema = z.object({
  type: z.literal("session/working-set.success"),
  data: SessionWorkingSetSchema,
});

export const SessionApproveSuccessSchema = z.object({
  type: z.literal("session/approve.success"),
  approved: z.boolean(),
});

export const SessionRejectSuccessSchema = z.object({
  type: z.literal("session/reject.success"),
  rejected: z.boolean(),
});

export const SessionApprovalsSuccessSchema = z.object({
  type: z.literal("session/approvals.success"),
  approvals: z.array(ApprovalRequestSchema),
});

export const IpcResponseSchema = z.discriminatedUnion("type", [
  // Success wrappers
  z.object({ type: z.literal("provider/list.success"), data: z.array(AIProviderPublicSchema) }),
  z.object({ type: z.literal("provider/create.success"), data: AIProviderPublicSchema }),
  z.object({ type: z.literal("provider/update.success"), data: AIProviderPublicSchema }),
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
  // Orchestration responses
  SessionCreateSuccessSchema,
  SessionGetSuccessSchema,
  SessionStartSuccessSchema,
  SessionEventsSuccessSchema,
  SessionWorkingSetSuccessSchema,
  // Approval responses
  SessionApproveSuccessSchema,
  SessionRejectSuccessSchema,
  SessionApprovalsSuccessSchema,
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
  // Episodic Memory responses
  z.object({ type: z.literal("memory/episodic/list.success"), data: z.array(EpisodicEventSchema) }),
  z.object({ type: z.literal("memory/episodic/create.success"), data: EpisodicEventSchema }),
  z.object({ type: z.literal("memory/episodic/delete.success") }),
  // Model Roles responses
  z.object({ type: z.literal("model-roles/list.success"), data: z.array(ModelRoleSchema) }),
  z.object({ type: z.literal("model-roles/set.success"), data: ModelRoleSchema.nullable() }),
  z.object({ type: z.literal("model-roles/delete.success") }),
  // Harness Config responses
  z.object({ type: z.literal("harness-configs/list.success"), data: z.array(HarnessConfigSchema) }),
  z.object({ type: z.literal("harness-configs/get.success"), data: HarnessConfigSchema.nullable() }),
  z.object({ type: z.literal("harness-configs/update.success"), data: HarnessConfigSchema }),
  z.object({ type: z.literal("harness-configs/test.success"), passed: z.boolean(), message: z.string() }),
  // Connector responses (Phase 3)
  z.object({ type: z.literal("connector/list.success"), data: z.array(ConnectorConfigSchema) }),
  z.object({ type: z.literal("connector/create.success"), data: ConnectorConfigSchema }),
  z.object({ type: z.literal("connector/update.success"), data: ConnectorConfigSchema }),
  z.object({ type: z.literal("connector/delete.success") }),
  z.object({ type: z.literal("connector/sync.success"), data: ConnectorRunSchema }),
  z.object({ type: z.literal("connector/runs.success"), data: z.array(ConnectorRunSchema) }),
  z.object({ type: z.literal("connector/state/get.success"), data: ConnectorStateSchema.nullable() }),
  // Anomaly rule responses (Phase 3)
  z.object({ type: z.literal("watcher/rules/list.success"), data: z.array(WatcherRuleSchema) }),
  z.object({ type: z.literal("watcher/rules/create.success"), data: WatcherRuleSchema }),
  z.object({ type: z.literal("watcher/rules/delete.success") }),
  // Stats
  z.object({ type: z.literal("stats/list.success"), activeRuns: z.number() }),
  // Graph Memory responses
  z.object({ type: z.literal("graph/list.success"), data: z.array(GraphNodeSchema) }),
  z.object({ type: z.literal("graph/get.success"), data: GraphNodeSchema.nullable() }),
  z.object({ type: z.literal("graph/createNode.success"), data: GraphNodeSchema }),
  z.object({ type: z.literal("graph/createEdge.success"), data: GraphEdgeSchema }),
  z.object({ type: z.literal("graph/delete.success") }),
  z.object({ type: z.literal("graph/query.success"), data: z.array(GraphEdgeSchema) }),
  // Auth / Admin / Membership responses
  LoginSuccessSchema,
  SessionVerifySuccessSchema,
  z.object({ type: z.literal("auth/logout.success") }),
  UserListSuccessSchema,
  z.object({ type: z.literal("admin/user/create.success"), data: UserSchema }),
  z.object({ type: z.literal("admin/user/update.success"), data: UserSchema }),
  z.object({ type: z.literal("admin/user/delete.success") }),
  RoleListSuccessSchema,
  z.object({ type: z.literal("admin/role/create.success"), data: UserRoleSchema }),
  z.object({ type: z.literal("admin/role/delete.success") }),
  z.object({ type: z.literal("admin/role/assign-permission.success") }),
  z.object({ type: z.literal("admin/role/revoke-permission.success") }),
  TenantListSuccessSchema,
  z.object({ type: z.literal("admin/tenant/members/add.success"), data: TenantMemberSchema }),
  z.object({ type: z.literal("admin/tenant/members/remove.success") }),
  WorkspaceMemberListSuccessSchema,
  z.object({ type: z.literal("workspace/members/add.success"), data: WorkspaceMemberSchema }),
  z.object({ type: z.literal("workspace/members/remove.success") }),
  // Errors
  z.object({ type: z.literal("error"), error: z.string(), code: z.string().optional() }),
  // Events (streaming)
  z.object({ type: z.literal("event"), event: RunEventSchema }),
]);

export type IpcResponse = z.infer<typeof IpcResponseSchema>;

// ---------------------------------------------------------------------------
// Enterprise Harness Schemas (re-export)
// ---------------------------------------------------------------------------

export {
  AgentRoleSchema,
  AgentDefinitionSchema,
  AgentStateSchema,
  AgentStatusSchema,
  ToolCategorySchema,
  EnterpriseToolSchema,
  ToolExecutionResultSchema,
  AgentTaskSchema,
  AgentTaskResultSchema,
  HarnessExecutionPlanSchema,
  HarnessExecutionResultSchema,
  StreamEventTypeSchema,
  StreamEventSchema,
  ProgressTrackerSchema,
  FallbackStrategyTypeSchema,
  ErrorRecoveryPolicySchema,
  CheckpointSchema,
  FileContextSchema,
  DependencyInfoSchema,
  GitInfoSchema,
  DocumentInfoSchema,
  ContextMemorySchema,
  WorkspaceContextSchema,
  MCPServerConfigSchema,
  MCPToolSchema,
  HarnessRequestSchema,
  HarnessResponseSchema,
} from "./enterprise-harness-schemas.js";

export type {
  AgentRole as EnterpriseAgentRole,
  AgentDefinition as EnterpriseAgentDefinition,
  AgentState as EnterpriseAgentState,
  EnterpriseTool as EnterpriseToolType,
  AgentTask as EnterpriseAgentTask,
  AgentTaskResult as EnterpriseAgentTaskResult,
  HarnessExecutionPlan as EnterpriseHarnessExecutionPlan,
  HarnessExecutionResult as EnterpriseHarnessExecutionResult,
  StreamEvent as EnterpriseStreamEvent,
  ProgressTracker as EnterpriseProgressTracker,
  ErrorRecoveryPolicy as EnterpriseErrorRecoveryPolicy,
  Checkpoint as EnterpriseCheckpoint,
  WorkspaceContext as EnterpriseWorkspaceContext,
  MCPServerConfig as EnterpriseMCPServerConfig,
  MCPTool as EnterpriseMCPTool,
  HarnessRequest as EnterpriseHarnessRequest,
  HarnessResponse as EnterpriseHarnessResponse,
} from "./enterprise-harness-schemas.js";

export type {
  AgentRole,
  AgentDefinition,
  AgentState,
  AgentTask,
  AgentTaskResult,
  HarnessExecutionPlan,
  HarnessExecutionResult,
  StreamEvent,
  StreamEventType,
  ProgressTracker,
  ErrorRecoveryPolicy,
  Checkpoint,
  WorkspaceContext,
  FileContext,
  DependencyInfo,
  GitInfo,
  DocumentInfo,
  ContextMemory,
  EnterpriseTool,
  ToolExecutionResult,
  MCPServerConfig,
  MCPTool,
} from "./enterprise-harness-schemas.js";
