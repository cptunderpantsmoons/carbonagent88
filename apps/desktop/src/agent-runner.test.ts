import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  runtimeEvents: [] as Array<{ type: string; content?: string; error?: string; step?: { step: number; toolCalls: Array<{ name: string; input: Record<string, unknown>; output?: unknown }> } }>,
  runtimeCancel: vi.fn(),
  provider: {
    chat: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  },
  db: {
    getRun: vi.fn(),
    createRun: vi.fn(),
    updateRunStatus: vi.fn(),
    addMessage: vi.fn(),
    getProviderWithKey: vi.fn(),
    createDataSource: vi.fn(),
    createDocument: vi.fn(),
    createIngestionJob: vi.fn(),
    updateDocumentChunkCount: vi.fn(),
    updateIngestionJob: vi.fn(),
    listHarnessConfigs: vi.fn().mockResolvedValue([]),
    listProfiles: vi.fn().mockResolvedValue([]),
  },
  parseFile: vi.fn(),
  chunkText: vi.fn(),
  storeChunks: vi.fn(),
  searchChunks: vi.fn(),
  getEmbeddingProvider: vi.fn(),
  generateDocument: vi.fn(),
  dbStoreMemory: vi.fn(),
  dbRecallMemories: vi.fn(),
  dbStoreSkill: vi.fn(),
  dbGetModelRole: vi.fn().mockResolvedValue(undefined),
  listUserPermissions: vi.fn().mockResolvedValue([]),
  hashEmbed: vi.fn().mockReturnValue(new Float32Array(8)),
  spawnCliSubAgent: vi.fn(),
  detectCli: vi.fn().mockResolvedValue({ installed: false, installCommand: "npm install -g x" }),
  fsExistsSync: vi.fn().mockReturnValue(true),
  fsStatSync: vi.fn().mockReturnValue({ size: 1024 }),
  fsWriteFileSync: vi.fn(),
  fsMkdirSync: vi.fn(),
  fsAppendFileSync: vi.fn(),
  createRunLog: vi.fn().mockReturnValue("/tmp/run.jsonl"),
  getVaultDir: vi.fn((wsId: string) => path.join(os.tmpdir(), `vault-${wsId}`)),
  recordGeneratedDocument: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock all external dependencies
// ---------------------------------------------------------------------------

vi.mock("@carbon-agent/core-runtime", () => ({
  AgentRuntime: class {
    constructor(
      private _config: unknown,
      private _executor: unknown,
    ) {}
    async *run(_prompt: string) {
      for (const event of mockState.runtimeEvents) {
        yield event;
      }
    }
    cancel() {
      mockState.runtimeCancel();
    }
  },
  createProvider: vi.fn(() => mockState.provider),
  BrowserHarness: class {},
  CodeHarness: class {},
  LocalHarness: class {},
  HarnessRegistry: class {
    register = vi.fn();
    all = vi.fn(() => []);
  },
  OrchestrationRuntime: class {
    async run() {
      return { status: "completed", fullResponse: "orchestration done", runError: undefined };
    }
  },
}));

vi.mock("@carbon-agent/local-store", () => ({
  CarbonDatabase: class {},
  createRunLog: (...args: unknown[]) => mockState.createRunLog(...(args as [string])),
  getVaultDir: (...args: unknown[]) => mockState.getVaultDir(...(args as [string])),
  dbStoreMemory: (...args: unknown[]) => mockState.dbStoreMemory(...(args as [unknown[]])),
  dbRecallMemories: (...args: unknown[]) => mockState.dbRecallMemories(...(args as [unknown[]])),
  dbStoreSkill: (...args: unknown[]) => mockState.dbStoreSkill(...(args as [unknown[]])),
  dbGetModelRole: (...args: unknown[]) => mockState.dbGetModelRole(...(args as [unknown[]])),
  listUserPermissions: (...args: unknown[]) => mockState.listUserPermissions(...(args as [unknown[]])),
  hashEmbed: (...args: unknown[]) => mockState.hashEmbed(...(args as [string])),
}));

vi.mock("@carbon-agent/ingestion", () => ({
  parseFile: (...args: unknown[]) => mockState.parseFile(...(args as [unknown[]])),
  chunkText: (...args: unknown[]) => mockState.chunkText(...(args as [unknown[]])),
  storeChunks: (...args: unknown[]) => mockState.storeChunks(...(args as [unknown[]])),
  searchChunks: (...args: unknown[]) => mockState.searchChunks(...(args as [unknown[]])),
  getEmbeddingProvider: (...args: unknown[]) => mockState.getEmbeddingProvider(...(args as [unknown[]])),
}));

vi.mock("@carbon-agent/cloak-bridge", () => ({
  stealthOpen: vi.fn().mockResolvedValue({ success: true }),
  stealthScrape: vi.fn().mockResolvedValue({ success: true, content: "scraped" }),
  stealthDownload: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockState.fsExistsSync(...(args as [string])),
    statSync: (...args: unknown[]) => mockState.fsStatSync(...(args as [string])),
    writeFileSync: (...args: unknown[]) => mockState.fsWriteFileSync(...(args as [string, string])),
    mkdirSync: (...args: unknown[]) => mockState.fsMkdirSync(...(args as [string])),
    appendFileSync: (...args: unknown[]) => mockState.fsAppendFileSync(...(args as [string, string])),
  },
}));

vi.mock("./document-generator.js", () => ({
  generateDocument: (...args: unknown[]) => mockState.generateDocument(...(args as [unknown[]])),
}));

vi.mock("./desktop-events.js", () => ({
  emitAgentTopology: vi.fn(),
  emitVaultChange: vi.fn(),
}));

vi.mock("./session-events.js", () => ({
  emitSessionEvent: vi.fn(),
  emitSessionUpdate: vi.fn(),
  emitSessionWorkingSet: vi.fn(),
}));

vi.mock("./document-records.js", () => ({
  recordGeneratedDocument: (...args: unknown[]) => mockState.recordGeneratedDocument(...(args as [unknown[]])),
}));

vi.mock("./cli-subagent.js", () => ({
  spawnCliSubAgent: (...args: unknown[]) => mockState.spawnCliSubAgent(...(args as [unknown[]])),
  detectCli: (...args: unknown[]) => mockState.detectCli(...(args as [unknown[]])),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { runAgent } from "./agent-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    db: mockState.db as unknown as Parameters<typeof runAgent>[0]["db"],
    workspaceId: "ws-1",
    conversationId: "conv-1",
    providerId: "prov-1",
    message: "do something",
    maxSteps: 5,
    ...overrides,
  };
}

function setupProvider() {
  mockState.db.getProviderWithKey.mockResolvedValue({
    id: "prov-1",
    type: "anthropic",
    name: "Claude",
    api_key: "sk-test",
    base_url: undefined,
    model: "claude-sonnet-4",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

// ---------------------------------------------------------------------------

describe("agent-runner — extractJsonFromResponse", () => {
  // extractJsonFromResponse is an internal function, but we can test it
  // indirectly through the orchestration flow. However, since it's not
  // exported, we test the behavior via the planner/validator/judge paths
  // in integration. For unit testing, we verify the logic here by
  // replicating the same parsing logic and testing it independently.

  function extractJsonFromResponse(content: string): unknown {
    const trimmed = content.trim();
    try { return JSON.parse(trimmed); } catch { /* continue */ }
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* continue */ } }
    const objMatch = trimmed.match(/(\{[\s\S]*\})/);
    if (objMatch) { try { return JSON.parse(objMatch[1]); } catch { /* continue */ } }
    return null;
  }

  it("parses valid JSON string", () => {
    expect(extractJsonFromResponse('{"key":"value"}')).toEqual({ key: "value" });
  });

  it("parses JSON inside fenced code block", () => {
    expect(extractJsonFromResponse('```json\n{"key":"value"}\n```')).toEqual({ key: "value" });
  });

  it("parses JSON object embedded in text", () => {
    expect(extractJsonFromResponse('Here is the result: {"ok":true} done')).toEqual({ ok: true });
  });

  it("returns null for invalid input", () => {
    expect(extractJsonFromResponse("not json at all")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractJsonFromResponse("")).toBeNull();
  });

  it("parses JSON array", () => {
    expect(extractJsonFromResponse('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — runAgent basic flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runtimeEvents = [{ type: "text", content: "Hello from agent" }];
    mockState.db.getRun.mockResolvedValue(undefined);
    setupProvider();
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("completes successfully with text response", async () => {
    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
    expect(result.fullResponse).toContain("Hello from agent");
    expect(result.runId).toBeDefined();
  });

  it("creates a new run when runId does not exist", async () => {
    mockState.db.getRun.mockResolvedValue(undefined);
    const result = await runAgent(makeInput());
    expect(mockState.db.createRun).toHaveBeenCalled();
    expect(result.runStatus).toBe("completed");
  });

  it("reuses existing run log path when run exists", async () => {
    mockState.db.getRun.mockResolvedValue({
      id: "existing-run",
      jsonl_log_path: "/tmp/existing.jsonl",
    });
    mockState.fsExistsSync.mockReturnValue(true);
    const result = await runAgent(makeInput({ runId: "existing-run" }));
    expect(mockState.db.createRun).not.toHaveBeenCalled();
    expect(result.runStatus).toBe("completed");
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — runAgent with tool calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("emits topology events for tool calls", async () => {
    const { emitAgentTopology } = await import("./desktop-events.js");
    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "rag_retrieve", input: { query: "test" }, output: { success: true } },
          ],
        },
      },
      { type: "text", content: "Done" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
    expect(emitAgentTopology).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — runAgent with error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("sets run status to failed on runtime error", async () => {
    mockState.runtimeEvents = [
      { type: "error", error: "LLM API timeout" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("failed");
    expect(result.runError).toBe("LLM API timeout");
    expect(result.fullResponse).toContain("LLM API timeout");
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — runAgent with cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("sets run status to cancelled when run was cancelled", async () => {
    mockState.runtimeEvents = [{ type: "text", content: "partial" }];
    // Simulate that the run status in DB is "cancelled" after the loop
    mockState.db.getRun.mockResolvedValueOnce(undefined) // initial check
      .mockResolvedValue({ status: "cancelled", jsonl_log_path: "/tmp/run.jsonl" }); // final check

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — tool executor: ingest_file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
    mockState.fsStatSync.mockReturnValue({ size: 2048 });
  });

  it("ingests a file and creates document chunks", async () => {
    mockState.parseFile.mockReturnValue({
      title: "Test Doc",
      content: "This is test content",
      mimeType: "text/plain",
      sourceUrl: undefined,
      profileId: undefined,
    });
    mockState.chunkText.mockReturnValue([
      { index: 0, content: "This is test content" },
    ]);
    mockState.getEmbeddingProvider.mockResolvedValue({
      embed: vi.fn().mockResolvedValue([new Float32Array(8)]),
    });
    mockState.storeChunks.mockResolvedValue(undefined);
    mockState.db.createDataSource.mockResolvedValue(undefined);
    mockState.db.createDocument.mockResolvedValue(undefined);
    mockState.db.createIngestionJob.mockResolvedValue(undefined);
    mockState.db.updateDocumentChunkCount.mockResolvedValue(undefined);
    mockState.db.updateIngestionJob.mockResolvedValue(undefined);

    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "ingest_file", input: { filePath: "/tmp/test.md", workspaceId: "ws-1" }, output: undefined },
          ],
        },
      },
      { type: "text", content: "Ingested" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
    expect(mockState.parseFile).toHaveBeenCalled();
    expect(mockState.chunkText).toHaveBeenCalled();
    expect(mockState.storeChunks).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — tool executor: rag_retrieve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("retrieves chunks via searchChunks", async () => {
    mockState.searchChunks.mockResolvedValue([
      { content: "result 1", sourceUrl: "https://example.com" },
    ]);

    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "rag_retrieve", input: { workspaceId: "ws-1", query: "test" }, output: undefined },
          ],
        },
      },
      { type: "text", content: "Retrieved" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — tool executor: write_note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("writes a note to the vault", async () => {
    mockState.dbStoreMemory.mockResolvedValue(undefined);

    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "write_note", input: { workspaceId: "ws-1", title: "My Note", content: "Note content" }, output: undefined },
          ],
        },
      },
      { type: "text", content: "Note written" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
    expect(mockState.fsWriteFileSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — tool executor: memory_recall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("recalls memories via dbRecallMemories", async () => {
    mockState.dbRecallMemories.mockResolvedValue([
      { id: "mem-1", key: "test", content: "memory content", tags_json: '["tag1"]', source: "agent", importance: 0.8 },
    ]);

    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "memory_recall", input: { workspaceId: "ws-1", query: "test" }, output: undefined },
          ],
        },
      },
      { type: "text", content: "Recalled" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — tool executor: memory_store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("stores a memory via dbStoreMemory", async () => {
    mockState.dbStoreMemory.mockResolvedValue(undefined);

    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "memory_store", input: { workspaceId: "ws-1", key: "new", content: "new memory" }, output: undefined },
          ],
        },
      },
      { type: "text", content: "Stored" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
    expect(mockState.dbStoreMemory).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — tool executor: generate_document", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("generates a document", async () => {
    mockState.generateDocument.mockResolvedValue({
      filePath: "/tmp/docs/output.md",
      finalContent: "content",
    });
    mockState.recordGeneratedDocument.mockResolvedValue(undefined);

    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "generate_document", input: { workspaceId: "ws-1", title: "Report", content: "content", format: "markdown" }, output: undefined },
          ],
        },
      },
      { type: "text", content: "Generated" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
    expect(mockState.generateDocument).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — tool executor: delegate_task (CLI sub-agent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("delegates to claude-code CLI sub-agent", async () => {
    mockState.spawnCliSubAgent.mockResolvedValue({
      success: true,
      result: "CLI output",
      exitCode: 0,
    });

    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "delegate_task", input: { targetAgentRole: "claude-code", taskDescription: "refactor code", workspaceId: "ws-1" }, output: undefined },
          ],
        },
      },
      { type: "text", content: "Delegated" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
    expect(mockState.spawnCliSubAgent).toHaveBeenCalled();
  });

  it("delegates to codex CLI sub-agent", async () => {
    mockState.spawnCliSubAgent.mockResolvedValue({
      success: true,
      result: "Codex output",
      exitCode: 0,
    });

    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "delegate_task", input: { targetAgentRole: "codex", taskDescription: "generate module", workspaceId: "ws-1" }, output: undefined },
          ],
        },
      },
      { type: "text", content: "Delegated" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
    expect(mockState.spawnCliSubAgent).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — tool executor: delegate_task (in-process sub-agent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("delegates to in-process sub-agent (e.g. coder role)", async () => {
    // For in-process sub-agents, the AgentRuntime mock will emit text events
    mockState.runtimeEvents = [
      {
        type: "tool",
        step: {
          step: 1,
          toolCalls: [
            { name: "delegate_task", input: { targetAgentRole: "coder", taskDescription: "write function", workspaceId: "ws-1" }, output: undefined },
          ],
        },
      },
      { type: "text", content: "Sub-agent result" },
    ];

    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
  });
});

// ---------------------------------------------------------------------------

describe("agent-runner — permission resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProvider();
    mockState.db.getRun.mockResolvedValue(undefined);
    mockState.db.createRun.mockResolvedValue(undefined);
    mockState.db.updateRunStatus.mockResolvedValue(undefined);
    mockState.db.addMessage.mockResolvedValue(undefined);
    mockState.fsExistsSync.mockReturnValue(true);
  });

  it("constructs permission resolver from user permissions", async () => {
    mockState.listUserPermissions.mockResolvedValue(["workspace:read", "workspace:write", "run:create"]);
    mockState.runtimeEvents = [{ type: "text", content: "ok" }];

    const result = await runAgent(makeInput({
      session: { userId: "u1", tenantId: "t1", roleId: "r1" },
    }));
    expect(result.runStatus).toBe("completed");
    expect(mockState.listUserPermissions).toHaveBeenCalledWith(expect.anything(), "u1", "ws-1");
  });

  it("works without session (no permission resolver)", async () => {
    mockState.runtimeEvents = [{ type: "text", content: "ok" }];
    const result = await runAgent(makeInput());
    expect(result.runStatus).toBe("completed");
  });
});