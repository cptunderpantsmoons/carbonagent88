/**
 * Enterprise Agent Harness — Multi-Agent Orchestration Framework
 *
 * Control Corridor:
 * - Owns: Agent lifecycle, parallel execution, streaming, workspace context
 * - Must NOT own: LLM provider instantiation, browser profile internals
 *
 * Enterprise-grade harness that competes with Claude Cowork and Copilot:
 * - Parallel agent execution with dependency resolution
 * - Real-time streaming with progress tracking
 * - Workspace-aware context management
 * - Tool registry with MCP support
 * - Error recovery and checkpointing
 * - Multi-model routing
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { LLMProvider, ToolDefinition } from "./gateway.js";
import { AgentRuntime, type ToolExecutor } from "./agent.js";
import { CachingProvider } from "./cache/caching-provider.js";
import type { ResponseCache, SemanticCache } from "./cache/index.js";
import { MCPClient, MCPToolAdapter } from "./mcp-integration.js";
import { SkillAdvisor } from "./skills/index.js";
import type { MCPServerConfig } from "@carbon-agent/shared-schemas";
import type {
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
  EnterpriseTool,
  ToolExecutionResult,
} from "@carbon-agent/shared-schemas";

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
} from "@carbon-agent/shared-schemas";

// ---------------------------------------------------------------------------
// Enterprise Tool Executor
// ---------------------------------------------------------------------------

export interface EnterpriseToolExecutor {
  execute(tool: EnterpriseTool, input: Record<string, unknown>): Promise<ToolExecutionResult>;
}

// ---------------------------------------------------------------------------
// Workspace Context (runtime helpers)
// ---------------------------------------------------------------------------

export interface EnterpriseHarnessConfig {
  maxConcurrentAgents: number;
  maxStepsPerAgent: number;
  defaultTimeout: number;
  enableStreaming: boolean;
  enableCheckpoints: boolean;
  errorPolicy: ErrorRecoveryPolicy;
  workspaceContext?: WorkspaceContext;
  /** Optional caches to wrap selected providers with. */
  cache?: {
    responseCache?: ResponseCache;
    semanticCache?: SemanticCache;
  };
  /** Enable in-memory skill learning via SkillAdvisor. */
  enableSkillLearning?: boolean;
}

export interface FallbackStrategy {
  type: "model_fallback" | "tool_fallback" | "agent_fallback" | "skip" | "abort";
  target?: string;
  condition?: (error: Error) => boolean;
}

// ---------------------------------------------------------------------------
// Enterprise Agent Harness Implementation
// ---------------------------------------------------------------------------

export class EnterpriseAgentHarness extends EventEmitter {
  private config: EnterpriseHarnessConfig;
  private providers: Map<string, LLMProvider> = new Map();
  private toolRegistry: Map<string, EnterpriseTool> = new Map();
  private toolExecutor?: EnterpriseToolExecutor;
  private agentDefinitions: Map<AgentRole, AgentDefinition> = new Map();
  private activeAgents: Map<string, AgentState> = new Map();
  private _checkpoints: Map<string, Checkpoint[]> = new Map();
  private workspaceContext?: WorkspaceContext;
  private mcpClient: MCPClient = new MCPClient();
  private mcpToolAdapter: MCPToolAdapter = new MCPToolAdapter(this.mcpClient);
  private skillAdvisor?: SkillAdvisor;

  constructor(config: EnterpriseHarnessConfig) {
    super();
    this.config = config;
    this.workspaceContext = config.workspaceContext;
    if (config.enableSkillLearning) {
      this.skillAdvisor = new SkillAdvisor();
    }
    this.registerDefaultAgentDefinitions();
  }

  getSkillAdvisor(): SkillAdvisor | undefined {
    return this.skillAdvisor;
  }

  getCheckpoint(agentId: string): Checkpoint[] {
    return this._checkpoints.get(agentId) ?? [];
  }

  saveCheckpoint(checkpoint: Checkpoint): void {
    const existing = this._checkpoints.get(checkpoint.agentId) ?? [];
    existing.push(checkpoint);
    this._checkpoints.set(checkpoint.agentId, existing);
  }

  // ---------------------------------------------------------------------------
  // Provider Management
  // ---------------------------------------------------------------------------

  addProvider(id: string, provider: LLMProvider): void {
    this.providers.set(id, provider);
  }

  removeProvider(id: string): boolean {
    return this.providers.delete(id);
  }

  getProvider(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  // ---------------------------------------------------------------------------
  // Tool Registry
  // ---------------------------------------------------------------------------

  registerTool(tool: EnterpriseTool): void {
    this.toolRegistry.set(tool.name, tool);
  }

  registerTools(tools: EnterpriseTool[]): void {
    for (const tool of tools) {
      this.toolRegistry.set(tool.name, tool);
    }
  }

  unregisterTool(name: string): boolean {
    return this.toolRegistry.delete(name);
  }

  getTool(name: string): EnterpriseTool | undefined {
    return this.toolRegistry.get(name);
  }

  getToolsByCategory(category: EnterpriseTool["category"]): EnterpriseTool[] {
    return Array.from(this.toolRegistry.values()).filter((t) => t.category === category);
  }

  setToolExecutor(executor: EnterpriseToolExecutor): void {
    this.toolExecutor = executor;
  }

  // ---------------------------------------------------------------------------
  // MCP Integration
  // ---------------------------------------------------------------------------

  async connectMCPServer(config: MCPServerConfig) {
    await this.mcpClient.connectServer(config);
    const tools = this.mcpToolAdapter.toEnterpriseTools();
    this.registerTools(tools);
    return this.mcpClient.getServer(config.id);
  }

  async disconnectMCPServer(serverId: string): Promise<void> {
    await this.mcpClient.disconnectServer(serverId);
    // Unregister tools provided by this server
    for (const [name, tool] of this.toolRegistry) {
      if (tool.category === "mcp" && name.startsWith(`mcp_${serverId}_`)) {
        this.toolRegistry.delete(name);
      }
    }
  }

  getMCPClient(): MCPClient {
    return this.mcpClient;
  }

  // ---------------------------------------------------------------------------
  // Agent Definitions
  // ---------------------------------------------------------------------------

  registerAgentDefinition(def: AgentDefinition): void {
    this.agentDefinitions.set(def.role, def);
  }

  getAgentDefinition(role: AgentRole): AgentDefinition | undefined {
    return this.agentDefinitions.get(role);
  }

  // ---------------------------------------------------------------------------
  // Workspace Context
  // ---------------------------------------------------------------------------

  updateWorkspaceContext(context: WorkspaceContext): void {
    this.workspaceContext = context;
    this.emit("context_updated", { workspaceId: context.workspaceId });
  }

  getWorkspaceContext(): WorkspaceContext | undefined {
    return this.workspaceContext;
  }

  // ---------------------------------------------------------------------------
  // Task Planning
  // ---------------------------------------------------------------------------

  async createExecutionPlan(tasks: AgentTask[]): Promise<HarnessExecutionPlan> {
    const sorted = this.topologicalSort(tasks);
    const executionOrder = this.groupByDependencies(sorted);
    const estimatedDuration = this.estimateDuration(tasks);

    return {
      tasks: sorted,
      executionOrder,
      estimatedDuration,
    };
  }

  private topologicalSort(tasks: AgentTask[]): AgentTask[] {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const visited = new Set<string>();
    const result: AgentTask[] = [];

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      const task = taskMap.get(taskId);
      if (!task) return;

      for (const depId of task.dependencies ?? []) {
        visit(depId);
      }

      result.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  private groupByDependencies(tasks: AgentTask[]): string[][] {
    const groups: string[][] = [];
    const completed = new Set<string>();

    let remaining = [...tasks];

    while (remaining.length > 0) {
      const group: string[] = [];

      for (const task of remaining) {
        const deps = task.dependencies ?? [];
        const allDepsCompleted = deps.every((d) => completed.has(d));
        if (allDepsCompleted) {
          group.push(task.id);
        }
      }

      if (group.length === 0) {
        // Circular dependency or error - break by priority
        group.push(remaining.sort((a, b) => b.priority - a.priority)[0]!.id);
      }

      groups.push(group);
      for (const id of group) {
        completed.add(id);
      }
      remaining = remaining.filter((t) => !completed.has(t.id));
    }

    return groups;
  }

  private estimateDuration(tasks: AgentTask[]): number {
    // Rough estimate: 10 seconds per step, 5 steps per task average
    return tasks.length * 10 * 5;
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  async executePlan(plan: HarnessExecutionPlan): Promise<HarnessExecutionResult> {
    const startTime = Date.now();
    const results: AgentTaskResult[] = [];
    let completed = 0;
    let failed = 0;

    for (const group of plan.executionOrder) {
      // Respect maxConcurrentAgents from config
      const maxConcurrent = this.config.maxConcurrentAgents;
      const batches: string[][] = [];
      for (let i = 0; i < group.length; i += maxConcurrent) {
        batches.push(group.slice(i, i + maxConcurrent));
      }

      for (const batch of batches) {
        const batchPromises = batch.map((taskId) => {
          const task = plan.tasks.find((t) => t.id === taskId)!;
          return this.executeTask(task);
        });

        const batchResults = await Promise.allSettled(batchPromises);

        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            results.push(result.value);
            if (result.value.success) {
              completed++;
            } else {
              failed++;
            }
          } else {
            failed++;
            results.push({
              taskId: "unknown",
              agentId: "unknown",
              success: false,
              output: "",
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
              duration: 0,
            });
          }
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    const status = failed === 0 ? "completed" : completed > 0 ? "partial" : "failed";

    // Record outcomes for skill learning when enabled.
    if (this.skillAdvisor) {
      for (const taskResult of results) {
        const task = plan.tasks.find((t) => t.id === taskResult.taskId);
        if (task) {
          this.skillAdvisor.recordOutcome(task.role, taskResult.success, taskResult.duration);
        }
      }
    }

    return {
      planId: randomUUID(),
      status,
      results,
      summary: this.generateSummary(results, totalDuration),
      totalDuration,
      metrics: {
        tasksTotal: plan.tasks.length,
        tasksCompleted: completed,
        tasksFailed: failed,
        averageDuration: totalDuration / plan.tasks.length,
      },
    };
  }

  private async executeTask(task: AgentTask): Promise<AgentTaskResult> {
    const startTime = Date.now();
    const agentId = randomUUID();

    const agentState: AgentState = {
      id: agentId,
      role: task.role,
      status: "running",
      steps: 0,
      startTime: new Date().toISOString(),
      endTime: null,
      error: null,
      result: null,
    };

    this.activeAgents.set(agentId, agentState);
    this.emit("agent_start", { agentId, task });

    try {
      const def = this.getAgentDefinition(task.role) ?? this.getDefaultDefinition(task.role);
      let provider = this.getBestProvider(def.model);

      if (!provider) {
        throw new Error("No LLM provider available");
      }

      if (this.config.cache && (this.config.cache.responseCache || this.config.cache.semanticCache)) {
        provider = new CachingProvider(provider, {
          responseCache: this.config.cache.responseCache,
          semanticCache: this.config.cache.semanticCache,
        });
      }

      const tools = this.buildToolDefinitions(def.tools);
      const executor = this.buildExecutor();
      const runtime = new AgentRuntime(
        {
          providerOverride: provider,
          runId: agentId,
          workspaceId: this.workspaceContext?.workspaceId ?? "unknown",
          conversationId: agentId,
          model: def.model,
          systemPrompt: this.buildSystemPrompt(def),
          maxSteps: def.maxSteps,
          tools,
        },
        executor,
      );

      let finalResult = "";
      for await (const event of runtime.run(task.description)) {
        if (event.type === "tool") {
          this.emit("agent_step", { agentId, step: event.step?.step ?? 0, response: { content: event.step?.content ?? "", toolCalls: event.step?.toolCalls } });
          agentState.steps = event.step?.step ?? 0;
        } else if (event.type === "text") {
          finalResult = event.content ?? "";
        } else if (event.type === "error") {
          throw new Error(event.error ?? "Agent runtime error");
        }
      }

      agentState.status = "completed";
      agentState.result = finalResult;
      agentState.endTime = new Date().toISOString();

      return {
        taskId: task.id,
        agentId,
        success: true,
        output: finalResult,
        error: null,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      agentState.status = "failed";
      agentState.error = err instanceof Error ? err.message : String(err);
      agentState.endTime = new Date().toISOString();

      return {
        taskId: task.id,
        agentId,
        success: false,
        output: "",
        error: agentState.error,
        duration: Date.now() - startTime,
      };
    } finally {
      this.activeAgents.delete(agentId);
      this.emit("agent_complete", { agentId, task });
    }
  }

  private buildExecutor(): ToolExecutor {
    return new Proxy({} as ToolExecutor, {
      get: (_target, name) => {
        if (typeof name !== "string") return undefined;
        return async (input: Record<string, unknown>) => {
          const tool = this.toolRegistry.get(name);
          if (!tool) {
            throw new Error(`Tool ${name} not registered`);
          }

          // Route MCP-registered tools directly through the MCP adapter
          if (tool.category === "mcp" && name.startsWith("mcp_")) {
            const result = await this.mcpToolAdapter.createExecutor()(tool, input);
            if (!result.success) {
              throw new Error(result.error ?? `MCP tool ${name} failed`);
            }
            return result.output;
          }

          if (!this.toolExecutor) {
            throw new Error(`Tool executor not configured for ${name}`);
          }
          const result = await this.toolExecutor.execute(tool, input);
          if (!result.success) {
            throw new Error(result.error ?? `Tool ${name} failed`);
          }
          return result.output;
        };
      },
    });
  }

  private buildSystemPrompt(def: AgentDefinition): string {
    const parts = [def.systemPrompt];
    if (this.workspaceContext) {
      parts.push(
        `Workspace context:\n- Root: ${this.workspaceContext.rootPath}\n- Files: ${Array.from(this.workspaceContext.files.keys()).slice(0, 20).join(", ")}\n- Branch: ${this.workspaceContext.gitInfo?.branch ?? "unknown"}`,
      );
    }
    return parts.join("\n\n");
  }

  private buildToolDefinitions(toolNames: string[]): ToolDefinition[] {
    const defs: ToolDefinition[] = [];

    for (const name of toolNames) {
      const tool = this.toolRegistry.get(name);
      if (tool) {
        defs.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }

    return defs;
  }

  private getBestProvider(preferredModel?: string): LLMProvider | undefined {
    const providers = Array.from(this.providers.values());
    if (providers.length === 0) return undefined;

    if (preferredModel) {
      const match = providers.find((p) => p.name.includes(preferredModel));
      if (match) return match;
    }

    return providers[0];
  }

  private getDefaultDefinition(role: AgentRole): AgentDefinition {
    return {
      role,
      name: role,
      description: `${role} agent`,
      systemPrompt: `You are a ${role} agent. Complete the assigned task.`,
      tools: [],
      maxSteps: 10,
      maxTokens: 4096,
      temperature: 0.7,
    };
  }

  private generateSummary(results: AgentTaskResult[], duration: number): string {
    const completed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return `Execution completed: ${completed} succeeded, ${failed} failed in ${(duration / 1000).toFixed(1)}s`;
  }

  // ---------------------------------------------------------------------------
  // Default Agent Definitions
  // ---------------------------------------------------------------------------

  private registerDefaultAgentDefinitions(): void {
    this.registerAgentDefinition({
      role: "orchestrator",
      name: "Orchestrator",
      description: "Coordinates and manages other agents",
      systemPrompt: `You are an orchestrator agent. Break down complex tasks into subtasks and delegate them to specialized agents.`,
      tools: ["delegate_task", "memory_store", "memory_recall"],
      maxSteps: 20,
      maxTokens: 4096,
      temperature: 0.5,
    });

    this.registerAgentDefinition({
      role: "coder",
      name: "Coder",
      description: "Writes and edits code",
      systemPrompt: `You are a coding agent. Write clean, efficient code following best practices.`,
      tools: ["file_read", "file_write", "file_edit", "terminal_execute", "rag_retrieve"],
      maxSteps: 30,
      maxTokens: 8192,
      temperature: 0.3,
      model: "claude",
    });

    this.registerAgentDefinition({
      role: "researcher",
      name: "Researcher",
      description: "Researches topics and gathers information",
      systemPrompt: `You are a research agent. Thoroughly investigate topics and provide well-sourced information.`,
      tools: ["rag_retrieve", "memory_recall", "content_search"],
      maxSteps: 25,
      maxTokens: 4096,
      temperature: 0.7,
    });

    this.registerAgentDefinition({
      role: "analyst",
      name: "Analyst",
      description: "Analyzes data and provides insights",
      systemPrompt: `You are an analysis agent. Analyze data, identify patterns, and provide actionable insights.`,
      tools: ["file_read", "rag_retrieve", "memory_recall"],
      maxSteps: 20,
      maxTokens: 4096,
      temperature: 0.5,
    });

    this.registerAgentDefinition({
      role: "writer",
      name: "Writer",
      description: "Creates documents and content",
      systemPrompt: `You are a writing agent. Create clear, well-structured documents and content.`,
      tools: ["file_read", "file_write", "rag_retrieve"],
      maxSteps: 15,
      maxTokens: 8192,
      temperature: 0.7,
    });

    this.registerAgentDefinition({
      role: "reviewer",
      name: "Reviewer",
      description: "Reviews code and provides feedback",
      systemPrompt: `You are a review agent. Review code for quality, security, and best practices.`,
      tools: ["file_read", "memory_recall"],
      maxSteps: 15,
      maxTokens: 4096,
      temperature: 0.3,
    });

    this.registerAgentDefinition({
      role: "debugger",
      name: "Debugger",
      description: "Debugs issues and provides fixes",
      systemPrompt: `You are a debugging agent. Identify root causes and provide fixes for issues.`,
      tools: ["file_read", "file_edit", "terminal_execute", "rag_retrieve"],
      maxSteps: 25,
      maxTokens: 4096,
      temperature: 0.3,
    });

    this.registerAgentDefinition({
      role: "planner",
      name: "Planner",
      description: "Creates execution plans",
      systemPrompt: `You are a planning agent. Create detailed execution plans for complex tasks.`,
      tools: ["memory_recall", "rag_retrieve"],
      maxSteps: 10,
      maxTokens: 2048,
      temperature: 0.5,
    });

    this.registerAgentDefinition({
      role: "executor",
      name: "Executor",
      description: "Executes commands and operations",
      systemPrompt: `You are an execution agent. Execute commands and operations precisely.`,
      tools: ["terminal_execute", "file_write", "file_edit"],
      maxSteps: 20,
      maxTokens: 2048,
      temperature: 0.2,
    });
  }
}

// ---------------------------------------------------------------------------
// Enterprise Tool Definitions
// ---------------------------------------------------------------------------

export const ENTERPRISE_TOOLS: EnterpriseTool[] = [
  // File Operations
  {
    name: "file_read",
    description: "Read file contents from the workspace",
    category: "file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" },
      },
      required: ["path"],
    },
    timeout: 5000,
  },
  {
    name: "file_write",
    description: "Write content to a file in the workspace",
    category: "file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        content: { type: "string", description: "Content to write" },
        createDirs: { type: "boolean", default: true },
      },
      required: ["path", "content"],
    },
    timeout: 10000,
  },
  {
    name: "file_edit",
    description: "Edit a file using exact string replacement",
    category: "file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        oldString: { type: "string", description: "Exact string to replace" },
        newString: { type: "string", description: "Replacement string" },
      },
      required: ["path", "oldString", "newString"],
    },
    timeout: 5000,
  },
  {
    name: "file_search",
    description: "Search for files by pattern in the workspace",
    category: "file",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern" },
        path: { type: "string", description: "Directory to search in" },
      },
      required: ["pattern"],
    },
    timeout: 5000,
  },
  {
    name: "content_search",
    description: "Search file contents using regex patterns",
    category: "file",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern" },
        path: { type: "string", description: "Directory to search in" },
        include: { type: "string", description: "File pattern to include" },
      },
      required: ["pattern"],
    },
    timeout: 10000,
  },

  // Code Operations
  {
    name: "code_analyze",
    description: "Analyze code for issues, complexity, or patterns",
    category: "code",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        analysisType: { type: "string", enum: ["lint", "types", "complexity", "security"] },
      },
      required: ["path", "analysisType"],
    },
    timeout: 30000,
  },
  {
    name: "code_format",
    description: "Format code according to project conventions",
    category: "code",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
      },
      required: ["path"],
    },
    timeout: 10000,
  },

  // Terminal Operations
  {
    name: "terminal_execute",
    description: "Execute a terminal command",
    category: "terminal",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
        cwd: { type: "string", description: "Working directory" },
        timeout: { type: "number", description: "Timeout in ms" },
      },
      required: ["command"],
    },
    timeout: 60000,
  },
  {
    name: "terminal_background",
    description: "Execute a terminal command in background",
    category: "terminal",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["command"],
    },
    timeout: 5000,
  },

  // RAG Operations
  {
    name: "rag_retrieve",
    description: "Retrieve relevant context from the knowledge base",
    category: "rag",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", default: 5 },
      },
      required: ["query"],
    },
    timeout: 10000,
  },
  {
    name: "rag_index",
    description: "Index a document into the knowledge base",
    category: "rag",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        content: { type: "string", description: "Content to index" },
      },
      required: ["content"],
    },
    timeout: 30000,
  },

  // Memory Operations
  {
    name: "memory_store",
    description: "Store information in agent memory",
    category: "memory",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Memory key" },
        value: { type: "string", description: "Memory value" },
        scope: { type: "string", enum: ["session", "workspace", "global"], default: "session" },
      },
      required: ["key", "value"],
    },
    timeout: 5000,
  },
  {
    name: "memory_recall",
    description: "Recall information from agent memory",
    category: "memory",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        scope: { type: "string", enum: ["session", "workspace", "global"] },
      },
      required: ["query"],
    },
    timeout: 5000,
  },

  // Delegation
  {
    name: "delegate_task",
    description: "Delegate a task to another agent",
    category: "custom",
    inputSchema: {
      type: "object",
      properties: {
        role: { type: "string", description: "Agent role to delegate to" },
        task: { type: "string", description: "Task description" },
        context: { type: "string", description: "Additional context" },
      },
      required: ["role", "task"],
    },
    timeout: 120000,
  },
];

// ---------------------------------------------------------------------------
// Streaming Execution Engine
// ---------------------------------------------------------------------------

export class StreamingExecutionEngine extends EventEmitter {
  private harness: EnterpriseAgentHarness;
  private eventBuffer: StreamEvent[] = [];
  private progress: ProgressTracker = { total: 0, completed: 0, failed: 0, percentage: 0 };

  constructor(harness: EnterpriseAgentHarness) {
    super();
    this.harness = harness;

    // Forward harness events
    harness.on("agent_start", (data) => this.emitEvent("agent_start", data.agentId, data));
    harness.on("agent_step", (data) => this.emitEvent("agent_step", data.agentId, data));
    harness.on("agent_complete", (data) => this.emitEvent("agent_complete", data.agentId, data));
    harness.on("agent_error", (data) => this.emitEvent("agent_error", data.agentId, data));
  }

  async executeWithStreaming(plan: HarnessExecutionPlan): Promise<HarnessExecutionResult> {
    this.progress = {
      total: plan.tasks.length,
      completed: 0,
      failed: 0,
      percentage: 0,
    };

    this.emit("progress", { ...this.progress });

    const result = await this.harness.executePlan(plan);

    this.progress.completed = result.metrics.tasksCompleted;
    this.progress.failed = result.metrics.tasksFailed;
    this.progress.percentage = 100;

    this.emit("progress", { ...this.progress });

    return result;
  }

  private emitEvent(type: StreamEventType, agentId: string, data: Record<string, unknown>): void {
    const event: StreamEvent = {
      type,
      agentId,
      timestamp: new Date().toISOString(),
      data,
    };

    this.eventBuffer.push(event);
    this.emit("stream_event", event);
  }

  getProgress(): ProgressTracker {
    return { ...this.progress };
  }

  getEventBuffer(): StreamEvent[] {
    return [...this.eventBuffer];
  }

  clearBuffer(): void {
    this.eventBuffer = [];
  }
}

// ---------------------------------------------------------------------------
// Multi-Model Router
// ---------------------------------------------------------------------------

export interface ModelRoute {
  pattern: RegExp;
  providerId: string;
  model: string;
  priority: number;
}

export class MultiModelRouter {
  private routes: ModelRoute[] = [];
  private providers: Map<string, LLMProvider> = new Map();

  addRoute(route: ModelRoute): void {
    this.routes.push(route);
    this.routes.sort((a, b) => b.priority - a.priority);
  }

  addProvider(id: string, provider: LLMProvider): void {
    this.providers.set(id, provider);
  }

  route(taskDescription: string): { provider: LLMProvider; model: string } | undefined {
    for (const route of this.routes) {
      if (route.pattern.test(taskDescription)) {
        const provider = this.providers.get(route.providerId);
        if (provider) {
          return { provider, model: route.model };
        }
      }
    }

    // Fallback to first available provider
    const firstProvider = this.providers.values().next().value;
    if (firstProvider) {
      return { provider: firstProvider, model: firstProvider.name };
    }

    return undefined;
  }
}
