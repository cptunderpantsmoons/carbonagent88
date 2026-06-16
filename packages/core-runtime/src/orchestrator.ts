/**
 * Cognitive Orchestrator — Supervisor / Sub-Agent Multi-Agent System
 *
 * Control Corridor:
 * - Owns: Supervisor routing, sub-agent spawning, reflection loops
 * - Must NOT own: Browser automation, LLM provider instantiation
 */

import { AgentRuntime, type ToolExecutor, type AgentRunConfig, type AgentStep } from "./agent.js";
import type { LLMProvider } from "./gateway.js";
import { createProvider } from "./gateway.js";
export type SubAgentRole = "researcher" | "extractor" | "drafter" | "navigator" | "general" | "claude-code" | "codex";

export interface SubAgentDef {
  role: SubAgentRole;
  description: string;
  maxSteps: number;
  systemPrompt: string;
  cli?: boolean;
}

export const SUB_AGENT_REGISTRY: Record<SubAgentRole, SubAgentDef> = {
  researcher: {
    role: "researcher",
    description: "Deep web research specialist. Excels at finding, reading, and synthesizing information from multiple sources.",
    maxSteps: 30,
    systemPrompt: `You are a Research Sub-Agent. Your job is to thoroughly research a topic using browser tools.
Break complex research into sequential searches. Use stealth_scrape and stealth_screenshot to gather information.
Always cite sources. Return a concise, well-organized research summary.`,
  },
  extractor: {
    role: "extractor",
    description: "Data extraction specialist. Excels at pulling structured data from tables, forms, and enterprise portals.",
    maxSteps: 25,
    systemPrompt: `You are a Data Extraction Sub-Agent. Your job is to extract structured data from web pages and documents.
Use stealth_evaluate for precise DOM queries. Use stealth_screenshot for visual verification.
Return data in structured JSON or tabular format.`,
  },
  drafter: {
    role: "drafter",
    description: "Document drafting specialist. Excels at writing, editing, and formatting documents from research and data.",
    maxSteps: 20,
    systemPrompt: `You are a Document Drafting Sub-Agent. Your job is to create well-structured documents from research and data.
Use write_note and generate_document tools. Follow formatting conventions.
Return the final document content and file path.`,
  },
  navigator: {
    role: "navigator",
    description: "Portal navigation specialist. Excels at understanding and navigating complex enterprise web applications.",
    maxSteps: 30,
    systemPrompt: `You are a Navigation Sub-Agent. Your job is to navigate complex enterprise portals efficiently.
Use stealth_axtree for semantic understanding of the page structure.
Use stealth_interact for humanized clicking and typing.
Return the final page state and any extracted data.`,
  },
  general: {
    role: "general",
    description: "General-purpose sub-agent for tasks that don't require a specialized role.",
    maxSteps: 20,
    systemPrompt: `You are a General Sub-Agent. Complete the assigned task using available tools.
Be thorough and return clear results.`,
  },
  "claude-code": {
    role: "claude-code",
    description: "Claude Code CLI sub-agent. Full coding agent with file editing, terminal access, and multi-file reasoning. Best for complex code changes, refactoring, debugging, and implementation tasks.",
    maxSteps: 0,
    systemPrompt: "",
    cli: true,
  },
  codex: {
    role: "codex",
    description: "OpenAI Codex CLI sub-agent. Autonomous coding agent sandboxed to the workspace. Best for code generation, analysis, and multi-step coding workflows.",
    maxSteps: 0,
    systemPrompt: "",
    cli: true,
  },
};

export interface DelegateTaskInput {
  taskDescription: string;
  targetAgentRole: SubAgentRole;
  context?: string;
  profileId?: string;
  workspaceId: string;
  maxSteps?: number;
}

export interface DelegateTaskOutput {
  success: boolean;
  subAgentRole: string;
  result: string;
  stepsTaken: number;
  toolCalls: { name: string; input: Record<string, unknown>; output?: unknown }[];
  error?: string;
}

export interface ReflectionResult {
  success: boolean;
  reflection: string;
  shouldRetry: boolean;
  adjustedParams?: Record<string, unknown>;
  error?: string;
}

/**
 * SupervisorOrchestrator — wraps or extends AgentRuntime to add multi-agent
 * delegation and self-correction capabilities.
 */
export class SupervisorOrchestrator {
  private provider: LLMProvider;
  private baseConfig: Pick<AgentRunConfig, "providerConfig" | "workspaceId" | "conversationId" | "permissionResolver" | "approvalCoordinator" | "supervisionMode">;
  private executor: ToolExecutor;
  private subAgentHistories: Map<string, AgentStep[]> = new Map();

  constructor(
    baseConfig: Pick<AgentRunConfig, "providerConfig" | "workspaceId" | "conversationId" | "permissionResolver" | "approvalCoordinator" | "supervisionMode">,
    executor: ToolExecutor,
  ) {
    this.provider = createProvider(baseConfig.providerConfig!);
    this.baseConfig = baseConfig;
    this.executor = executor;
  }

  /**
   * Delegate a task to a specialized Sub-Agent.
   * The Sub-Agent gets a fresh AgentRuntime with a focused system prompt.
   */
  async delegateTask(input: DelegateTaskInput): Promise<DelegateTaskOutput> {
    const def = SUB_AGENT_REGISTRY[input.targetAgentRole] ?? SUB_AGENT_REGISTRY.general;
    const subRunId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Human-in-the-loop confirmation for delegate_task in "confirm" mode.
    if (this.baseConfig.supervisionMode === "confirm" && this.baseConfig.approvalCoordinator) {
      const decision = await this.baseConfig.approvalCoordinator.requestApproval(
        input.workspaceId,
        "tool",
        `Delegate task to ${input.targetAgentRole}`,
        input.taskDescription,
        {
          priority: "high",
          toolName: "delegate_task",
          arguments: { role: input.targetAgentRole, task: input.taskDescription, context: input.context },
        },
      );
      if (decision.decision !== "approved") {
        const reason = decision.reason ?? "delegation approval denied";
        return {
          success: false,
          subAgentRole: input.targetAgentRole,
          result: "",
          stepsTaken: 0,
          toolCalls: [],
          error: reason,
        };
      }
    }

    // Build a sub-agent executor that explicitly strips delegation and reflection
    // tools to prevent infinite recursion.
    const subExecutor = {
      stealth_open: this.executor.stealth_open,
      stealth_scrape: this.executor.stealth_scrape,
      stealth_download: this.executor.stealth_download,
      stealth_interact: this.executor.stealth_interact,
      stealth_screenshot: this.executor.stealth_screenshot,
      stealth_evaluate: this.executor.stealth_evaluate,
      ingest_file: this.executor.ingest_file,
      rag_retrieve: this.executor.rag_retrieve,
      graph_query: this.executor.graph_query,
      write_note: this.executor.write_note,
      generate_document: this.executor.generate_document,
      stealth_axtree: this.executor.stealth_axtree,
      recall_skill: this.executor.recall_skill,
      store_skill: this.executor.store_skill,
      vault_read: this.executor.vault_read,
      vault_write: this.executor.vault_write,
      vault_link: this.executor.vault_link,
    };

    const subRuntime = new AgentRuntime(
      {
        ...this.baseConfig,
        runId: subRunId,
        systemPrompt: `${def.systemPrompt}\n\nOriginal task from Supervisor: ${input.taskDescription}\n\nAdditional context: ${input.context ?? "None"}`,
        maxSteps: input.maxSteps ?? def.maxSteps,
      },
      subExecutor as ToolExecutor,
    );

    const fullPrompt = input.context
      ? `Task: ${input.taskDescription}\n\nContext:\n${input.context}`
      : input.taskDescription;

    const toolCalls: { name: string; input: Record<string, unknown>; output?: unknown }[] = [];
    let stepsTaken = 0;
    let finalResult = "";

    try {
      for await (const event of subRuntime.run(fullPrompt)) {
        if (event.type === "tool" && event.step?.toolCalls) {
          stepsTaken = event.step.step;
          for (const tc of event.step.toolCalls) {
            toolCalls.push({
              name: tc.name,
              input: tc.input,
              output: tc.output,
            });
          }
        } else if (event.type === "text" && event.content) {
          finalResult = event.content;
        }
      }

      // Store history for later reflection
      this.subAgentHistories.set(subRunId, [] /* populated below if needed */);

      return {
        success: true,
        subAgentRole: def.role,
        result: finalResult || "(no textual result)",
        stepsTaken,
        toolCalls,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        subAgentRole: def.role,
        result: "",
        stepsTaken,
        toolCalls,
        error: msg,
      };
    }
  }

  /**
   * Reflect on a failed tool call and decide whether to retry with adjusted params.
   */
  async reflectAndRetry(
    toolName: string,
    originalInput: Record<string, unknown>,
    originalOutput: unknown,
    error?: string,
  ): Promise<ReflectionResult> {
    const prompt = `You are a self-correction engine. A tool call failed or produced poor output.

TOOL: ${toolName}
INPUT: ${JSON.stringify(originalInput, null, 2)}
OUTPUT: ${JSON.stringify(originalOutput, null, 2)}
ERROR: ${error ?? "none"}

Analyze what went wrong and decide:
1. Was this a transient error (network, timing)? → retry with same params
2. Was the input wrong (bad selector, wrong URL)? → retry with adjusted params
3. Was the approach wrong? → suggest a different strategy
4. Should we stop and report failure?

Respond ONLY with a JSON object:
{
  "reflection": "your analysis",
  "shouldRetry": true|false,
  "adjustedParams": { /* only if shouldRetry is true */ }
}`;

    try {
      const response = await this.provider.chat({
        messages: [{ role: "system", content: "You are a tool-call reflection engine." }, { role: "user", content: prompt }],
        model: "gpt-4o-mini", // Use a cheap model for reflection
        maxTokens: 1024,
        temperature: 0.2,
      });

      let parsed: { reflection?: string; shouldRetry?: boolean; adjustedParams?: Record<string, unknown> } | undefined;
      try {
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(response.content);
      } catch {
        return {
          success: false,
          reflection: "Reflection parse failed: " + response.content,
          shouldRetry: false,
        };
      }

      return {
        success: true,
        reflection: String(parsed?.reflection ?? "no reflection"),
        shouldRetry: Boolean(parsed?.shouldRetry),
        adjustedParams: parsed?.adjustedParams,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        reflection: "",
        shouldRetry: false,
        error: msg,
      };
    }
  }
}
