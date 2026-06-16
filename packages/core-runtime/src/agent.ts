/**
 * Core Runtime — ReAct Agent Loop
 *
 * Control Corridor:
 * - Owns: Agent loop, tool execution, LLM routing
 * - Must NOT own: Browser profile storage internals
 *
 * Simple ReAct loop with max step limits.
 * All tool calls and LLM streams are written to JSONL run logs.
 */

import type { LLMProvider, ChatMessage, ToolDefinition } from "./gateway.js";
import { createProvider } from "./gateway.js";
import type { AIProviderConfig } from "@carbon-agent/shared-schemas";
import type { AgenticMemorySystem } from "./memory/system.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Minimal JSONL event builders (self-contained to avoid circular deps)
// ---------------------------------------------------------------------------

function makeEvent(runId: string, type: string, payload: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    runId,
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

// ---------------------------------------------------------------------------
// Tool Definitions (the 6 core tools)
// ---------------------------------------------------------------------------

export const CORE_TOOLS: ToolDefinition[] = [
  {
    name: "stealth_open",
    description: "Open a URL using a saved browser profile session. Use this to navigate to authenticated pages.",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "The browser profile ID to use" },
        url: { type: "string", description: "The URL to open" },
      },
      required: ["profileId", "url"],
    },
  },
  {
    name: "stealth_scrape",
    description: "Extract readable text from the current page or a target URL using a saved browser profile.",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "The browser profile ID to use" },
        url: { type: "string", description: "Optional URL to navigate to before scraping" },
      },
      required: ["profileId"],
    },
  },
  {
    name: "stealth_download",
    description: "Download a file from a URL using a saved browser profile session.",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "The browser profile ID to use" },
        url: { type: "string", description: "The URL of the file to download" },
        filename: { type: "string", description: "Optional filename to save as" },
      },
      required: ["profileId", "url"],
    },
  },
  {
    name: "ingest_file",
    description: "Parse and index a downloaded or local file into the RAG knowledge base.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Absolute path to the file to ingest" },
        workspaceId: { type: "string", description: "The workspace to store the document in" },
        sourceUrl: { type: "string", description: "Optional original URL the file came from" },
        profileId: { type: "string", description: "Optional browser profile ID used to obtain the file" },
      },
      required: ["filePath", "workspaceId"],
    },
  },
  {
    name: "rag_retrieve",
    description: "Query the local RAG knowledge base for relevant document chunks.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        workspaceId: { type: "string", description: "The workspace to search in" },
        limit: { type: "number", description: "Maximum number of chunks to return (default 5)" },
      },
      required: ["query", "workspaceId"],
    },
  },
  {
    name: "write_note",
    description: "Save a Markdown note to the local vault for the user.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the note" },
        content: { type: "string", description: "Markdown content" },
        workspaceId: { type: "string", description: "The workspace to save the note in" },
      },
      required: ["title", "content", "workspaceId"],
    },
  },
  {
    name: "delegate_task",
    description: "Delegate a complex task to a specialized sub-agent. Use claude-code or codex for coding tasks that require file editing, multi-file reasoning, or terminal access. Use researcher/extractor/drafter/navigator for browser-based tasks.",
    inputSchema: {
      type: "object",
      properties: {
        taskDescription: { type: "string", description: "Clear description of the task to delegate" },
        targetAgentRole: { type: "string", enum: ["claude-code", "codex", "researcher", "extractor", "drafter", "navigator", "general"], description: "The sub-agent role to use" },
        context: { type: "string", description: "Optional additional context for the sub-agent" },
        workspaceId: { type: "string", description: "The workspace context for the task" },
        maxSteps: { type: "number", description: "Maximum steps for in-process sub-agents (ignored for CLI sub-agents)" },
      },
      required: ["taskDescription", "targetAgentRole", "workspaceId"],
    },
  },
  {
    name: "memory_recall",
    description: "Recall relevant memories from the knowledge base. Use this to retrieve previously stored facts, decisions, and context that may help with the current task.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language query to search for relevant memories" },
        workspaceId: { type: "string", description: "The workspace to search in" },
        limit: { type: "number", description: "Maximum number of memories to return (default 5)" },
      },
      required: ["query", "workspaceId"],
    },
  },
  {
    name: "memory_store",
    description: "Store an important fact, decision, or piece of context as a memory for future recall. Use this to persist key findings from the current task.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Short identifier for the memory (e.g., 'api-endpoint-auth')" },
        content: { type: "string", description: "The content to remember" },
        workspaceId: { type: "string", description: "The workspace to store the memory in" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags for categorization" },
      },
      required: ["key", "content", "workspaceId"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Executor Interface
// ---------------------------------------------------------------------------

export interface ToolExecutor {
  stealth_open(input: { profileId: string; url: string }): Promise<unknown>;
  stealth_scrape(input: { profileId: string; url?: string }): Promise<unknown>;
  stealth_download(input: { profileId: string; url: string; filename?: string }): Promise<unknown>;
  stealth_interact(input: { profileId: string; url: string; action: string }): Promise<unknown>;
  stealth_screenshot(input: { profileId: string; url?: string }): Promise<unknown>;
  stealth_evaluate(input: { profileId: string; url: string; script: string }): Promise<unknown>;
  graph_query(input: { query: string; workspaceId: string }): Promise<unknown>;
  generate_document(input: { format: string; content: string; title?: string; workspaceId: string }): Promise<unknown>;
  stealth_axtree(input: { profileId: string }): Promise<unknown>;
  recall_skill(input: { skillId: string }): Promise<unknown>;
  store_skill(input: { name: string; trigger: string; definition: string }): Promise<unknown>;
  vault_read(input: { vaultId: string; path: string }): Promise<unknown>;
  vault_write(input: { vaultId: string; path: string; content: string }): Promise<unknown>;
  vault_link(input: { vaultId: string; sourcePath: string; targetPath: string }): Promise<unknown>;
  ingest_file(input: { filePath: string; workspaceId: string; sourceUrl?: string; profileId?: string }): Promise<unknown>;
  rag_retrieve(input: { query: string; workspaceId: string; limit?: number }): Promise<unknown>;
  write_note(input: { title: string; content: string; workspaceId: string }): Promise<unknown>;
  delegate_task(input: { taskDescription: string; targetAgentRole: string; context?: string; workspaceId: string; maxSteps?: number }): Promise<unknown>;
  memory_recall(input: { query: string; workspaceId: string; limit?: number }): Promise<unknown>;
  memory_store(input: { key: string; content: string; workspaceId: string; tags?: string[] }): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// ReAct Agent Loop
// ---------------------------------------------------------------------------

export interface AgentRunConfig {
  providerConfig?: AIProviderConfig;
  runId: string;
  workspaceId: string;
  conversationId: string;
  systemPrompt?: string;
  maxSteps?: number;
  tools?: ToolDefinition[];
  model?: string;
  /** Bypass createProvider and use this LLM provider directly. */
  providerOverride?: LLMProvider;
  /** Optional agentic memory system; if provided, memory tools use it. */
  memory?: AgenticMemorySystem;
}

export interface AgentStep {
  step: number;
  role: "assistant" | "tool";
  content: string;
  toolCalls?: { name: string; input: Record<string, unknown>; output?: unknown; error?: string }[];
}

export class AgentRuntime {
  private provider: LLMProvider;
  private config: AgentRunConfig;
  private executor: ToolExecutor;
  private memory?: AgenticMemorySystem;
  private history: ChatMessage[] = [];
  private steps: AgentStep[] = [];
  private cancelled = false;

  constructor(config: AgentRunConfig, executor: ToolExecutor) {
    if (!config.providerConfig && !config.providerOverride) {
      throw new Error("AgentRunConfig requires providerConfig or providerOverride");
    }
    this.provider = config.providerOverride ?? createProvider(config.providerConfig!);
    this.config = config;
    this.executor = executor;
    this.memory = config.memory;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async *run(userMessage: string): AsyncGenerator<{ type: "text" | "tool" | "done" | "error"; content?: string; step?: AgentStep; error?: string }> {
    const maxSteps = this.config.maxSteps ?? 50;

    // Initialize run log
    const runLogPath = this.initRunLog(this.config.runId);
    this.logEvent(runLogPath, makeEvent(this.config.runId, "system_message", { message: `Agent run started. Max steps: ${maxSteps}` }));
    this.logEvent(runLogPath, makeEvent(this.config.runId, "user_message", { content: userMessage }));

    // System prompt
    const systemPrompt = this.config.systemPrompt ??
      `You are Carbon Agent, an AI assistant that can use browser sessions to access authenticated enterprise content.
You have access to the following tools:
- stealth_open: Navigate to a URL using a saved browser profile
- stealth_scrape: Extract text from a web page
- stealth_download: Download a file
- ingest_file: Parse and index a file into the knowledge base
- rag_retrieve: Search the knowledge base
- write_note: Save a note to the vault

When you use a tool, respond with a tool call. When you have the answer, respond directly.
Always cite your sources when answering from retrieved documents.`;

    this.history = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    yield { type: "text", content: "" };

    for (let stepNum = 0; stepNum < maxSteps; stepNum++) {
      if (this.cancelled) {
        this.logEvent(runLogPath, makeEvent(this.config.runId, "system_message", { message: "Run cancelled by user" }));
        yield { type: "done" };
        return;
      }

      // Log LLM request
      const activeModel = this.config.model ?? this.config.providerConfig?.model ?? "";
      this.logEvent(runLogPath, makeEvent(this.config.runId, "llm_request", { model: activeModel, messages: this.history }));

      // Call LLM
      let response;
      try {
        response = await this.provider.chat({
          messages: this.history,
          model: this.config.model ?? this.config.providerConfig?.model ?? "",
          tools: this.config.tools ?? CORE_TOOLS,
          maxTokens: 4096,
          temperature: 0.7,
        });
      } catch (err: unknown) {
        const errorMsg = `LLM error: ${err instanceof Error ? err.message : String(err)}`;
        this.logEvent(runLogPath, makeEvent(this.config.runId, "llm_error", { error: errorMsg }));
        yield { type: "error", error: errorMsg };
        return;
      }

      // Log LLM response
      this.logEvent(runLogPath, makeEvent(this.config.runId, "llm_response", { model: activeModel, content: response.content, usage: response.usage }));

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Execute tools
        const step: AgentStep = {
          step: stepNum,
          role: "assistant",
          content: response.content,
          toolCalls: [],
        };

        for (const tc of response.toolCalls) {
          if (this.cancelled) break;

          this.logEvent(runLogPath, makeEvent(this.config.runId, "tool_call_start", { tool_name: tc.name, input: tc.input }));

          let output: unknown;
          let error: string | undefined;
          try {
            output = await this.executeTool(tc.name, tc.input);
            this.logEvent(runLogPath, makeEvent(this.config.runId, "tool_call_end", { tool_name: tc.name, output }));
          } catch (err: unknown) {
            error = err instanceof Error ? err.message : String(err);
            this.logEvent(runLogPath, makeEvent(this.config.runId, "tool_call_error", { tool_name: tc.name, error }));
          }

          step.toolCalls!.push({ name: tc.name, input: tc.input, output, error });

          // Add tool result to history with rotation
          this.history.push({
            role: "assistant",
            content: `Tool call: ${tc.name}\nInput: ${JSON.stringify(tc.input)}`,
          });
          this.history.push({
            role: "user",
            content: error
              ? `Error executing ${tc.name}: ${error}`
              : `Result of ${tc.name}:\n${JSON.stringify(output, null, 2)}`,
          });
        }

        // Rotate history: keep system (idx 0) + last N messages (token-aware)
        // Default to 40 messages, but could be made token-aware with WorkingMemory
        const MAX_HISTORY = 40;
        if (this.history.length > MAX_HISTORY) {
          const systemMsg = this.history[0];
          this.history = [systemMsg, ...this.history.slice(-(MAX_HISTORY - 1))];
        }

        this.steps.push(step);
        yield { type: "tool", step };
      } else {
        // Final answer
        this.history.push({ role: "assistant", content: response.content });
        this.logEvent(runLogPath, makeEvent(this.config.runId, "assistant_message", { content: response.content }));
        yield { type: "text", content: response.content };
        yield { type: "done" };
        return;
      }
    }

    // Max steps reached
    const msg = `Reached maximum step limit (${maxSteps}). Stopping.`;
    this.logEvent(runLogPath, makeEvent(this.config.runId, "system_message", { message: msg }));
    yield { type: "error", error: msg };
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "stealth_open":
        return this.executor.stealth_open(input as { profileId: string; url: string });
      case "stealth_scrape":
        return this.executor.stealth_scrape(input as { profileId: string; url?: string });
      case "stealth_download":
        return this.executor.stealth_download(input as { profileId: string; url: string; filename?: string });
      case "ingest_file":
        return this.executor.ingest_file(input as { filePath: string; workspaceId: string; sourceUrl?: string; profileId?: string });
      case "rag_retrieve":
        return this.executor.rag_retrieve(input as { query: string; workspaceId: string; limit?: number });
      case "write_note":
        return this.executor.write_note(input as { title: string; content: string; workspaceId: string });
      case "delegate_task":
        return this.executor.delegate_task(input as { taskDescription: string; targetAgentRole: string; context?: string; workspaceId: string; maxSteps?: number });
      case "memory_recall": {
        const { query, limit } = input as { query: string; workspaceId: string; limit?: number };
        if (this.memory) {
          return this.memory.recallMemory(query, limit ?? 5);
        }
        return this.executor.memory_recall(input as { query: string; workspaceId: string; limit?: number });
      }
      case "memory_store": {
        const { key, content } = input as { key: string; content: string; workspaceId: string; tags?: string[] };
        if (this.memory) {
          return this.memory.storeMemory(key, content, { source: "agent" });
        }
        return this.executor.memory_store(input as { key: string; content: string; workspaceId: string; tags?: string[] });
      }
      default: {
        const dynamic = this.executor as unknown as Record<string, ((input: Record<string, unknown>) => Promise<unknown>) | undefined>;
        const fn = dynamic[name];
        if (typeof fn === "function") {
          return await fn(input);
        }
        throw new Error(`Unknown tool: ${name}`);
      }
    }
  }

  private initRunLog(runId: string): string {
    const runsDir = path.join(os.homedir(), ".carbon-agent", "runs");
    if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
    const logPath = path.join(runsDir, `${runId}.jsonl`);
    fs.writeFileSync(logPath, "");
    return logPath;
  }

  private logEvent(logPath: string, event: unknown): void {
    fs.appendFileSync(logPath, JSON.stringify(event) + "\n");
  }
}
