/**
 * Enterprise Harness — Shared Zod Schemas
 *
 * Control Corridor: These schemas define the IPC contracts for the
 * enterprise agent harness system. All communication must be validated.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Agent Roles
// ---------------------------------------------------------------------------

export const AgentRoleSchema = z.enum([
  "orchestrator",
  "coder",
  "researcher",
  "analyst",
  "writer",
  "reviewer",
  "debugger",
  "planner",
  "executor",
  "custom",
]);

export type AgentRole = z.infer<typeof AgentRoleSchema>;

// ---------------------------------------------------------------------------
// Agent Definitions
// ---------------------------------------------------------------------------

export const AgentDefinitionSchema = z.object({
  role: AgentRoleSchema,
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(512),
  systemPrompt: z.string().min(1),
  tools: z.array(z.string()),
  maxSteps: z.number().int().positive().max(100),
  maxTokens: z.number().int().positive().max(32768),
  temperature: z.number().min(0).max(2),
  model: z.string().optional(),
  parallel: z.boolean().optional(),
  dependencies: z.array(AgentRoleSchema).optional(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

// ---------------------------------------------------------------------------
// Agent State
// ---------------------------------------------------------------------------

export const AgentStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const AgentStateSchema = z.object({
  id: z.string().uuid(),
  role: AgentRoleSchema,
  status: AgentStatusSchema,
  steps: z.number().int().nonnegative(),
  startTime: z.string().datetime().nullable(),
  endTime: z.string().datetime().nullable(),
  error: z.string().nullable(),
  result: z.string().nullable(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// ---------------------------------------------------------------------------
// Enterprise Tools
// ---------------------------------------------------------------------------

export const ToolCategorySchema = z.enum([
  "file",
  "code",
  "terminal",
  "browser",
  "rag",
  "memory",
  "mcp",
  "custom",
]);

export const EnterpriseToolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(512),
  category: ToolCategorySchema,
  inputSchema: z.record(z.unknown()),
  timeout: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional(),
  /**
   * Permissions required to register, list, or execute this tool.
   *
   * Examples:
   * - tools:browser — browser automation
   * - tools:terminal — terminal/command execution
   * - tools:file — file read/write/edit tools
   * - tools:mcp — MCP-provided tools
   * - skills:write — skill authoring
   * - memory:write — memory mutation
   */
  permissions: z.array(z.string()).optional(),
});

export type EnterpriseTool = z.infer<typeof EnterpriseToolSchema>;

/**
 * Common permission constants referenced by tool definitions.
 */
export const CategoryPermissions = {
  tools: {
    browser: "tools:browser",
    terminal: "tools:terminal",
    file: "tools:file",
    mcp: "tools:mcp",
  },
  skills: {
    write: "skills:write",
    admin: "skills:admin",
  },
  memory: {
    write: "memory:write",
  },
} as const;

// ---------------------------------------------------------------------------
// Tool Execution Result
// ---------------------------------------------------------------------------

export const ToolExecutionResultSchema = z.object({
  success: z.boolean(),
  output: z.unknown(),
  error: z.string().nullable().optional(),
  duration: z.number().optional(),
  retryCount: z.number().optional(),
});

export type ToolExecutionResult = z.infer<typeof ToolExecutionResultSchema>;

// ---------------------------------------------------------------------------
// Agent Tasks
// ---------------------------------------------------------------------------

export const AgentTaskSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(1).max(4096),
  role: AgentRoleSchema,
  input: z.record(z.unknown()),
  dependencies: z.array(z.string().uuid()).optional(),
  priority: z.number().int().min(0).max(100),
  timeout: z.number().int().positive().optional(),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

// ---------------------------------------------------------------------------
// Task Results
// ---------------------------------------------------------------------------

export const AgentTaskResultSchema = z.object({
  taskId: z.string().uuid(),
  agentId: z.string().uuid(),
  success: z.boolean(),
  output: z.string(),
  artifacts: z.array(z.object({
    name: z.string(),
    path: z.string(),
    content: z.string(),
  })).optional(),
  metrics: z.record(z.unknown()).optional(),
  error: z.string().nullable(),
  duration: z.number().int().nonnegative(),
});

export type AgentTaskResult = z.infer<typeof AgentTaskResultSchema>;

// ---------------------------------------------------------------------------
// Execution Plan
// ---------------------------------------------------------------------------

export const HarnessExecutionPlanSchema = z.object({
  tasks: z.array(AgentTaskSchema),
  executionOrder: z.array(z.array(z.string().uuid())),
  estimatedDuration: z.number().int().nonnegative(),
  sessionId: z.string().uuid().optional(),
  supervisionMode: z.enum(["watch", "confirm"]).default("watch"),
});

export type HarnessExecutionPlan = z.infer<typeof HarnessExecutionPlanSchema>;

// ---------------------------------------------------------------------------
// Execution Result
// ---------------------------------------------------------------------------

export const HarnessExecutionResultSchema = z.object({
  planId: z.string().uuid(),
  status: z.enum(["completed", "failed", "partial"]),
  results: z.array(AgentTaskResultSchema),
  summary: z.string(),
  totalDuration: z.number().int().nonnegative(),
  metrics: z.object({
    tasksTotal: z.number().int().nonnegative(),
    tasksCompleted: z.number().int().nonnegative(),
    tasksFailed: z.number().int().nonnegative(),
    averageDuration: z.number().int().nonnegative(),
  }),
});

export type HarnessExecutionResult = z.infer<typeof HarnessExecutionResultSchema>;

// ---------------------------------------------------------------------------
// Streaming Events
// ---------------------------------------------------------------------------

export const StreamEventTypeSchema = z.enum([
  "agent_start",
  "agent_step",
  "agent_complete",
  "agent_error",
  "tool_start",
  "tool_complete",
  "tool_error",
  "text_delta",
  "progress",
  "checkpoint",
  "warning",
]);

export type StreamEventType = z.infer<typeof StreamEventTypeSchema>;

export const StreamEventSchema = z.object({
  type: StreamEventTypeSchema,
  agentId: z.string().uuid(),
  timestamp: z.string().datetime(),
  data: z.record(z.unknown()),
});

export type StreamEvent = z.infer<typeof StreamEventSchema>;

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export const ProgressTrackerSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
  currentStep: z.string().optional(),
});

export type ProgressTracker = z.infer<typeof ProgressTrackerSchema>;

// ---------------------------------------------------------------------------
// Error Recovery
// ---------------------------------------------------------------------------

export const FallbackStrategyTypeSchema = z.enum([
  "model_fallback",
  "tool_fallback",
  "agent_fallback",
  "skip",
  "abort",
]);

export const ErrorRecoveryPolicySchema = z.object({
  maxRetries: z.number().int().nonnegative().max(10),
  retryDelay: z.number().int().nonnegative(),
  backoffMultiplier: z.number().positive(),
  fallbackStrategies: z.array(z.object({
    type: FallbackStrategyTypeSchema,
    target: z.string().optional(),
  })),
});

export type ErrorRecoveryPolicy = z.infer<typeof ErrorRecoveryPolicySchema>;

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export const CheckpointSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  step: z.number().int().nonnegative(),
  state: z.record(z.unknown()),
  timestamp: z.string().datetime(),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

// ---------------------------------------------------------------------------
// Workspace Context
// ---------------------------------------------------------------------------

export const FileContextSchema = z.object({
  path: z.string(),
  content: z.string().optional(),
  language: z.string().optional(),
  size: z.number().int().nonnegative(),
  lastModified: z.string().datetime(),
  isTest: z.boolean(),
  isConfig: z.boolean(),
});

export type FileContext = z.infer<typeof FileContextSchema>;

export const DependencyInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  type: z.enum(["npm", "pip", "cargo", "go", "system"]),
  location: z.string(),
});

export type DependencyInfo = z.infer<typeof DependencyInfoSchema>;

export const GitInfoSchema = z.object({
  branch: z.string(),
  commit: z.string(),
  status: z.enum(["clean", "dirty"]),
  recentCommits: z.array(z.object({
    hash: z.string(),
    message: z.string(),
    author: z.string(),
  })),
});

export type GitInfo = z.infer<typeof GitInfoSchema>;

export const DocumentInfoSchema = z.object({
  path: z.string(),
  title: z.string(),
  type: z.enum(["readme", "docs", "spec", "adr", "changelog"]),
  relevance: z.number().min(0).max(1),
});

export type DocumentInfo = z.infer<typeof DocumentInfoSchema>;

export const ContextMemorySchema = z.object({
  key: z.string(),
  value: z.string(),
  scope: z.enum(["session", "workspace", "global"]),
  ttl: z.number().int().positive().optional(),
});

export type ContextMemory = z.infer<typeof ContextMemorySchema>;

export const WorkspaceContextSchema = z.object({
  workspaceId: z.string().uuid(),
  rootPath: z.string(),
  files: z.map(z.string(), FileContextSchema),
  dependencies: z.array(DependencyInfoSchema),
  gitInfo: GitInfoSchema.optional(),
  activeDocuments: z.array(DocumentInfoSchema),
  memory: z.array(ContextMemorySchema),
});

export type WorkspaceContext = z.infer<typeof WorkspaceContextSchema>;

// ---------------------------------------------------------------------------
// MCP Types
// ---------------------------------------------------------------------------

export const MCPServerConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128),
  url: z.string().url(),
  transport: z.enum(["stdio", "sse", "streamable-http"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().int().positive().optional(),
  autoConnect: z.boolean().optional(),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
  annotations: z.object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
  }).optional(),
});

export type MCPTool = z.infer<typeof MCPToolSchema>;

// ---------------------------------------------------------------------------
// IPC Contracts — Harness Requests
// ---------------------------------------------------------------------------

export const HarnessRequestSchema = z.discriminatedUnion("type", [
  // Plan
  z.object({ type: z.literal("harness/plan"), tasks: z.array(AgentTaskSchema) }),
  // Execute
  z.object({ type: z.literal("harness/execute"), plan: HarnessExecutionPlanSchema }),
  // Stream
  z.object({ type: z.literal("harness/stream"), planId: z.string().uuid() }),
  // Cancel
  z.object({ type: z.literal("harness/cancel"), planId: z.string().uuid() }),
  // Status
  z.object({ type: z.literal("harness/status"), planId: z.string().uuid() }),
  // Metrics
  z.object({ type: z.literal("harness/metrics") }),
  // Tools
  z.object({ type: z.literal("harness/tools") }),
  z.object({ type: z.literal("harness/tool/register"), tool: EnterpriseToolSchema }),
  z.object({ type: z.literal("harness/tool/unregister"), name: z.string() }),
  // Agents
  z.object({ type: z.literal("harness/agents") }),
  z.object({ type: z.literal("harness/agent/definition"), role: AgentRoleSchema }),
  // Context
  z.object({ type: z.literal("harness/context"), workspaceId: z.string().uuid() }),
  z.object({ type: z.literal("harness/context/update"), context: WorkspaceContextSchema }),
  // MCP
  z.object({ type: z.literal("harness/mcp/connect"), config: MCPServerConfigSchema }),
  z.object({ type: z.literal("harness/mcp/disconnect"), serverId: z.string().uuid() }),
  z.object({ type: z.literal("harness/mcp/tools") }),
  // Checkpoints
  z.object({ type: z.literal("harness/checkpoints"), agentId: z.string().uuid() }),
  z.object({ type: z.literal("harness/checkpoint/restore"), checkpointId: z.string().uuid() }),
]);

export type HarnessRequest = z.infer<typeof HarnessRequestSchema>;

// ---------------------------------------------------------------------------
// IPC Contracts — Harness Responses
// ---------------------------------------------------------------------------

export const HarnessResponseSchema = z.discriminatedUnion("type", [
  // Plan
  z.object({ type: z.literal("harness/plan.success"), data: HarnessExecutionPlanSchema }),
  // Execute
  z.object({ type: z.literal("harness/execute.success"), data: HarnessExecutionResultSchema }),
  // Stream
  z.object({ type: z.literal("harness/stream.event"), event: StreamEventSchema }),
  z.object({ type: z.literal("harness/stream.complete"), result: HarnessExecutionResultSchema }),
  // Cancel
  z.object({ type: z.literal("harness/cancel.success") }),
  // Status
  z.object({ type: z.literal("harness/status.success"), data: z.object({
    planId: z.string().uuid(),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
    progress: ProgressTrackerSchema,
  }) }),
  // Metrics
  z.object({ type: z.literal("harness/metrics.success"), data: z.object({
    totalTasks: z.number(),
    completedTasks: z.number(),
    failedTasks: z.number(),
    averageDuration: z.number(),
    maxDuration: z.number(),
    minDuration: z.number(),
    throughput: z.number(),
    activeWorkers: z.number(),
    queuedTasks: z.number(),
  }) }),
  // Tools
  z.object({ type: z.literal("harness/tools.success"), data: z.array(EnterpriseToolSchema) }),
  z.object({ type: z.literal("harness/tool/register.success") }),
  z.object({ type: z.literal("harness/tool/unregister.success") }),
  // Agents
  z.object({ type: z.literal("harness/agents.success"), data: z.array(AgentDefinitionSchema) }),
  z.object({ type: z.literal("harness/agent/definition.success"), data: AgentDefinitionSchema }),
  // Context
  z.object({ type: z.literal("harness/context.success"), data: WorkspaceContextSchema }),
  z.object({ type: z.literal("harness/context.update.success") }),
  // MCP
  z.object({ type: z.literal("harness/mcp/connect.success"), data: z.object({
    serverId: z.string().uuid(),
    tools: z.array(MCPToolSchema),
  }) }),
  z.object({ type: z.literal("harness/mcp/disconnect.success") }),
  z.object({ type: z.literal("harness/mcp/tools.success"), data: z.array(MCPToolSchema) }),
  // Checkpoints
  z.object({ type: z.literal("harness/checkpoints.success"), data: z.array(CheckpointSchema) }),
  z.object({ type: z.literal("harness/checkpoint/restore.success") }),
  // Error
  z.object({ type: z.literal("harness/error"), error: z.string(), code: z.string().optional() }),
]);

export type HarnessResponse = z.infer<typeof HarnessResponseSchema>;
