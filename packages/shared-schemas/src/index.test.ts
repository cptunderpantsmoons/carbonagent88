import { describe, it, expect } from "vitest";
import {
  AIProviderConfigSchema,
  BrowserProfileSchema,
  WorkspaceSchema,
  ConversationSchema,
  ModelRoleNameSchema,
  OrchestrationSessionSchema,
  SessionEventSchema,
  SessionWorkingSetSchema,
  RunSchema,
  IpcRequestSchema,
  IpcResponseSchema,
  RunEventSchema,
} from "../src/index";

describe("Schema Validation", () => {
  describe("AIProviderConfigSchema", () => {
    it("validates a complete config", () => {
      const now = new Date().toISOString();
      const result = AIProviderConfigSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "anthropic",
        name: "Claude",
        apiKey: "sk-ant-1234",
        model: "claude-sonnet-4-20250514",
        createdAt: now,
        updatedAt: now,
      });
      expect(result.type).toBe("anthropic");
      expect(result.apiKey).toBe("sk-ant-1234");
    });

    it("rejects missing fields", () => {
      expect(() =>
        AIProviderConfigSchema.parse({
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "anthropic",
          name: "",
          apiKey: "sk-ant-1234",
          model: "claude",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ).toThrow();
    });

    it("accepts custom-openai with baseUrl", () => {
      const now = new Date().toISOString();
      const result = AIProviderConfigSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440001",
        type: "custom-openai",
        name: "Local LLM",
        apiKey: "local-key",
        baseUrl: "http://localhost:1234/v1",
        model: "llama-3.1",
        createdAt: now,
        updatedAt: now,
      });
      expect(result.baseUrl).toBe("http://localhost:1234/v1");
    });
  });

  describe("BrowserProfileSchema", () => {
    it("validates a complete profile", () => {
      const now = new Date().toISOString();
      const result = BrowserProfileSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440002",
        name: "Corporate Portal",
        description: "Single sign-on browser profile",
        profileDir: "/home/user/.carbon-agent/profiles/corp",
        targetDomains: ["https://portal.carbongroup.com"],
        status: "unknown",
        lastCheckedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      expect(result.targetDomains).toEqual(["https://portal.carbongroup.com"]);
      expect(result.status).toBe("unknown");
    });

    it("rejects invalid status", () => {
      expect(() =>
        BrowserProfileSchema.parse({
          id: "550e8400-e29b-41d4-a716-446655440003",
          name: "Test",
          profileDir: "/tmp/test",
          targetDomains: [],
          status: "INVALID" as any,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ).toThrow();
    });
  });

  describe("WorkspaceSchema", () => {
    it("validates a workspace", () => {
      const now = new Date().toISOString();
      const result = WorkspaceSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440004",
        name: "Carbon Analysis",
        description: "Q2 2025 emissions tracking",
        vaultDir: "/home/user/.carbon-agent/vault/work-4",
        createdAt: now,
        updatedAt: now,
      });
      expect(result.name).toBe("Carbon Analysis");
    });
  });

  describe("ConversationSchema", () => {
    it("validates a conversation with messages", () => {
      const now = new Date().toISOString();
      const result = ConversationSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440005",
        workspaceId: "550e8400-e29b-41d4-a716-446655440004",
        title: "Emissions Q&A",
        messages: [
          {
            id: "550e8400-e29b-41d4-a716-446655440010",
            conversationId: "550e8400-e29b-41d4-a716-446655440005",
            role: "user",
            content: "What were our Q2 emissions?",
            createdAt: now,
          },
          {
            id: "550e8400-e29b-41d4-a716-446655440011",
            conversationId: "550e8400-e29b-41d4-a716-446655440005",
            role: "assistant",
            content: "Based on the uploaded report...",
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      expect(result.messages.length).toBe(2);
      expect(result.messages[0].role).toBe("user");
    });
  });

  describe("RunSchema", () => {
    it("validates a run", () => {
      const now = new Date().toISOString();
      const result = RunSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440006",
        conversationId: "550e8400-e29b-41d4-a716-446655440005",
        workspaceId: "550e8400-e29b-41d4-a716-446655440004",
        providerId: null,
        status: "idle",
        model: null,
        messages: [],
        jsonlLogPath: "/home/user/.carbon-agent/runs/run-6.jsonl",
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      expect(result.status).toBe("idle");
      expect(result.jsonlLogPath.endsWith(".jsonl")).toBe(true);
    });
  });

  describe("RunEventSchema", () => {
    it("validates an LLM request event", () => {
      const result = RunEventSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440020",
        runId: "550e8400-e29b-41d4-a716-446655440006",
        type: "llm_request",
        timestamp: new Date().toISOString(),
        payload: {
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: "Hello" }],
        },
      });
      expect(result.type).toBe("llm_request");
    });
  });

  describe("Orchestration session schemas", () => {
    it("accepts the orchestration model role set", () => {
      expect(ModelRoleNameSchema.parse("planner")).toBe("planner");
      expect(ModelRoleNameSchema.parse("browser")).toBe("browser");
      expect(ModelRoleNameSchema.parse("validator")).toBe("validator");
      expect(ModelRoleNameSchema.parse("judge")).toBe("judge");
    });

    it("validates an email-thread-rooted orchestration session", () => {
      const now = new Date().toISOString();
      const result = OrchestrationSessionSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440030",
        workspaceId: "550e8400-e29b-41d4-a716-446655440031",
        conversationId: "550e8400-e29b-41d4-a716-446655440032",
        runId: "550e8400-e29b-41d4-a716-446655440033",
        root: {
          kind: "outlook-thread",
          threadId: "AAMkAGI2-thread",
          threadSubject: "Month end close",
          mailbox: "finance@example.com",
        },
        supervisionMode: "watch",
        status: "running",
        currentGoal: "Collect reporting inputs from Outlook and SharePoint",
        completionSummary: null,
        createdAt: now,
        updatedAt: now,
      });

      expect(result.root.threadSubject).toBe("Month end close");
      expect(result.supervisionMode).toBe("watch");
    });

    it("validates structured session events and working sets", () => {
      const now = new Date().toISOString();
      const event = SessionEventSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440034",
        sessionId: "550e8400-e29b-41d4-a716-446655440030",
        role: "judge",
        kind: "judgment_returned",
        summary: "More Xero evidence is required",
        payload: { complete: false, gaps: ["Need Xero invoice total"] },
        createdAt: now,
      });

      const workingSet = SessionWorkingSetSchema.parse({
        sessionId: "550e8400-e29b-41d4-a716-446655440030",
        entities: [{ type: "client", name: "Acme" }],
        documents: [{
          id: "550e8400-e29b-41d4-a716-446655440035",
          source: "outlook-thread",
          title: "Draft P&L.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          filePath: "/tmp/Draft-PL.xlsx",
          sourceUrl: null,
          confidence: 0.92,
          provenance: ["550e8400-e29b-41d4-a716-446655440034"],
        }],
        metrics: [],
        gaps: ["Need Xero invoice total"],
        provenanceScore: 0.75,
        updatedAt: now,
      });

      expect(event.kind).toBe("judgment_returned");
      expect(workingSet.documents[0]?.source).toBe("outlook-thread");
    });

    it("rejects invalid supervision modes", () => {
      expect(() =>
        OrchestrationSessionSchema.parse({
          id: "550e8400-e29b-41d4-a716-446655440030",
          workspaceId: "550e8400-e29b-41d4-a716-446655440031",
          conversationId: "550e8400-e29b-41d4-a716-446655440032",
          runId: "550e8400-e29b-41d4-a716-446655440033",
          root: {
            kind: "outlook-thread",
            threadId: "thread",
            threadSubject: "Subject",
            mailbox: "finance@example.com",
          },
          supervisionMode: "silent",
          status: "running",
          currentGoal: "Collect reporting inputs",
          completionSummary: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ).toThrow();
    });
  });

  describe("IpcRequestSchema", () => {
    it("validates a provider list request", () => {
      const result = IpcRequestSchema.parse({ type: "provider/list" });
      expect(result.type).toBe("provider/list");
    });

    it("validates a profile health check request", () => {
      const result = IpcRequestSchema.parse({
        type: "profile/health",
        id: "550e8400-e29b-41d4-a716-446655440002",
      });
      expect(result.type).toBe("profile/health");
    });

    it("rejects unknown request types", () => {
      expect(() => IpcRequestSchema.parse({ type: "unknown/thing" })).toThrow();
    });
  });

  describe("IpcResponseSchema", () => {
    it("validates a provider list success response", () => {
      const raw = {
        type: "provider/list.success",
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440000",
            type: "anthropic",
            name: "Claude",
            model: "claude-sonnet-4-20250514",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };
      const result = IpcResponseSchema.parse(raw);
      if (result.type !== "provider/list.success") {
        throw new Error("type guard failed");
      }
      expect(result.type).toBe("provider/list.success");
      expect(result.data.length).toBe(1);
    });

    it("validates an error response", () => {
      const raw = {
        type: "error",
        error: "Something went wrong",
        code: "PROVIDER_NOT_FOUND",
      };
      const result = IpcResponseSchema.parse(raw);
      if (result.type !== "error") {
        throw new Error("type guard failed");
      }
      expect(result.type).toBe("error");
      expect(result.error).toBe("Something went wrong");
    });

    it("rejects unknown response types", () => {
      expect(() => IpcResponseSchema.parse({ type: "unknown/thing" })).toThrow();
    });
  });
});
