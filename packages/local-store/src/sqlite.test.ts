import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CarbonDatabase, initDatabase, saveDatabase, closeDatabase } from "./sqlite";
import path from "node:path";

describe("CarbonDatabase", () => {
  let db: CarbonDatabase;
  const testDbPath = "/tmp/carbon-test-local-store.db";

  beforeAll(async () => {
    await initDatabase(testDbPath);
    db = new CarbonDatabase();
  });

  afterAll(() => {
    saveDatabase();
    closeDatabase();
    // Clean up test file
    const fs = require("node:fs");
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    for (const ext of ["-wal", "-shm"]) {
      const walPath = testDbPath + ext;
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    }
  });

  describe("workspaces", () => {
    it("creates and retrieves a workspace", async () => {
      const wsId = "550e8400-e29b-41d4-a716-446655440004";
      await db.createWorkspace({
        id: wsId,
        name: "Test Workspace",
        description: "For testing",
        vaultDir: "/tmp/vault/test",
      });

      const ws = await db.getWorkspace(wsId);
      expect(ws).toBeDefined();
      expect(ws?.name).toBe("Test Workspace");
    });

    it("lists all workspaces", async () => {
      await db.createWorkspace({ id: "ws-2", name: "Second", vaultDir: "/tmp/v2" });
      const list = await db.listWorkspaces();
      expect(list.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ai_providers", () => {
    it("creates and lists providers", async () => {
      await db.createProvider({
        id: "prov-1",
        type: "anthropic",
        name: "Claude",
        apiKey: "sk-test",
        model: "claude-sonnet-4",
      });

      const list = await db.listProviders();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.find((p: any) => p.name === "Claude")).toBeDefined();
    });

    it("updates a provider", async () => {
      await db.updateProvider({ id: "prov-1", model: "claude-sonnet-4-20250514" });
      const p = await db.getProvider("prov-1");
      expect(p?.model).toBe("claude-sonnet-4-20250514");
    });

    it("deletes a provider", async () => {
      await db.deleteProvider("prov-1");
      const p = await db.getProvider("prov-1");
      expect(p).toBeUndefined();
    });
  });

  describe("browser_profiles", () => {
    it("creates and lists profiles", async () => {
      await db.createProfile({
        id: "prof-1",
        name: "Corporate",
        profileDir: "/tmp/profiles/corp",
        targetDomains: ["https://portal.test.com"],
      });

      const list = await db.listProfiles();
      expect(list.length).toBeGreaterThanOrEqual(1);
    });

    it("updates profile status", async () => {
      await db.updateProfile({ id: "prof-1", status: "active" });
      const p = await db.getProfile("prof-1");
      expect(p?.status).toBe("active");
    });
  });

  describe("conversations & messages", () => {
    it("creates a conversation and adds messages", async () => {
      const wsId = "ws-convo-test";
      await db.createWorkspace({ id: wsId, name: "Convo Test", vaultDir: "/tmp/v-convo" });
      const convId = "conv-test-1";
      await db.createConversation({ id: convId, workspaceId: wsId });
      await db.addMessage({
        id: "msg-1",
        conversationId: convId,
        role: "user",
        content: "Hello",
      });
      await db.addMessage({
        id: "msg-2",
        conversationId: convId,
        role: "assistant",
        content: "Hi there!",
      });

      const conv = await db.getConversation(convId);
      expect(conv).toBeDefined();
    });
  });

  describe("runs", () => {
    it("creates a run with JSONL log path", async () => {
      const wsId = "ws-run-test";
      await db.createWorkspace({ id: wsId, name: "Run Test", vaultDir: "/tmp/v-run" });
      await db.createConversation({ id: "conv-run-1", workspaceId: wsId });

      await db.createRun({
        id: "run-1",
        conversationId: "conv-run-1",
        workspaceId: wsId,
        providerId: null,
        jsonlLogPath: "/tmp/runs/run-1.jsonl",
      });

      const run = await db.getRun("run-1");
      expect(run).toBeDefined();
      expect(run?.status).toBe("idle");
    });

    it("updates run status", async () => {
      await db.updateRunStatus("run-1", "running", {
        startedAt: new Date().toISOString(),
      });
      const run = await db.getRun("run-1");
      expect(run?.status).toBe("running");
    });
  });

  describe("orchestration sessions", () => {
    it("creates and reads an orchestration session with events and working set", async () => {
      const workspaceId = "550e8400-e29b-41d4-a716-446655440010";
      const conversationId = "550e8400-e29b-41d4-a716-446655440012";
      const runId = "550e8400-e29b-41d4-a716-446655440013";
      const sessionId = "550e8400-e29b-41d4-a716-446655440011";

      await db.createWorkspace({
        id: workspaceId,
        name: "WS",
        vaultDir: "/tmp/ws",
      });
      await db.createConversation({
        id: conversationId,
        workspaceId,
      });
      await db.createRun({
        id: runId,
        conversationId,
        workspaceId,
        providerId: null,
        jsonlLogPath: "/tmp/orchestration-run.jsonl",
      });

      await db.createOrchestrationSession({
        id: sessionId,
        workspaceId,
        conversationId,
        runId,
        rootKind: "outlook-thread",
        rootJson: JSON.stringify({
          threadId: "t-1",
          threadSubject: "Month end",
          mailbox: "finance@client.com",
        }),
        supervisionMode: "watch",
        status: "running",
        currentGoal: "Collect supporting financial data",
      });

      await db.appendSessionEvent({
        id: "550e8400-e29b-41d4-a716-446655440014",
        sessionId,
        role: "planner",
        kind: "plan_updated",
        summary: "Search Outlook attachments first",
        payloadJson: JSON.stringify({ sources: ["outlook-thread"] }),
      });

      await db.saveSessionWorkingSet({
        sessionId,
        entitiesJson: JSON.stringify([{ type: "client", name: "Acme" }]),
        documentsJson: JSON.stringify([
          {
            id: "doc-1",
            source: "outlook-thread",
            title: "P&L draft",
            confidence: 0.9,
            provenance: ["event-1"],
          },
        ]),
        metricsJson: JSON.stringify([]),
        gapsJson: JSON.stringify(["Need Xero confirmation"]),
        provenanceScore: 0.78,
      });

      const session = await db.getOrchestrationSession(sessionId);
      const events = await db.listSessionEvents(sessionId);
      const workingSet = await db.getSessionWorkingSet(sessionId);

      expect(session?.current_goal).toBe("Collect supporting financial data");
      expect(events).toHaveLength(1);
      expect(JSON.parse(String(workingSet?.gaps_json))).toEqual(["Need Xero confirmation"]);
    });
  });

  describe("tool_calls", () => {
    it("records a tool call", async () => {
      await db.addToolCall({
        id: "tc-1",
        runId: "run-1",
        toolName: "stealth_scrape",
        input: JSON.stringify({ url: "https://example.com" }),
      });

      await db.completeToolCall("tc-1", JSON.stringify({ content: "Hello World" }));
      // No assertion failure means it worked
    });
  });

  describe("documents", () => {
    it("lists workspace documents with file metadata", async () => {
      const wsId = "ws-docs-test";
      await db.createWorkspace({ id: wsId, name: "Docs Test", vaultDir: "/tmp/v-docs" });
      await db.createDataSource({
        id: "ds-doc-1",
        workspaceId: wsId,
        type: "file",
        name: "Draft.md",
        path: "/tmp/v-docs/Draft.md",
        mimeType: "text/plain",
        sizeBytes: 42,
      });
      await db.createDocument({
        id: "doc-1",
        workspaceId: wsId,
        dataSourceId: "ds-doc-1",
        title: "Draft",
        content: "# Draft\n\nHello",
      });

      const docs = await (db as any).listDocuments(wsId);
      expect(docs).toHaveLength(1);
      expect(docs[0].file_path).toBe("/tmp/v-docs/Draft.md");
      expect(docs[0].title).toBe("Draft");
      expect(docs[0].workspace_id).toBe(wsId);
    });
  });
});
