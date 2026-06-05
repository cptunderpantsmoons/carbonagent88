# Browser Orchestration PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first end-to-end Carbon Agent flow for email-thread-rooted browser collection, iterative validation/judgment loops, and specialist handoff using authenticated browser sessions instead of API integrations.

**Architecture:** Add a session-oriented orchestration layer on top of the existing agent runtime. Keep the current Electron desktop shell and existing outputs, but introduce a typed session/event/working-set model, persistent core-agent roles, model routing, and a browser-collection runner that starts from an Outlook email thread and hands validated working sets to downstream specialists.

**Tech Stack:** Electron, TypeScript, Vitest, Zod, sql.js, existing `@carbon-agent/core-runtime`, existing desktop IPC bridge, existing local-store persistence, existing Cloak Bridge browser tools

---

## File Structure

### Existing files to modify

- `packages/shared-schemas/src/index.ts`
  Add typed session, supervision mode, working-set, audit-event, and orchestration IPC contracts.
- `packages/local-store/src/sqlite.ts`
  Add storage tables and repository methods for orchestration sessions, events, source links, working-set records, and tenant-scoped persistent knowledge.
- `packages/local-store/src/index.ts`
  Export new persistence helpers.
- `packages/local-store/src/model-roles.ts`
  Expand model-role coverage for planner, browser, validator, judge, and knowledge roles.
- `packages/core-runtime/src/agent.ts`
  Reuse the current agent loop, but factor the new orchestration-facing tool/event contract without collapsing into ad hoc JSON strings.
- `packages/core-runtime/src/index.ts`
  Export new orchestration types and runtime.
- `apps/desktop/src/agent-runner.ts`
  Replace the single free-form run path with session-aware orchestration that can loop through collection, validation, judgment, and specialist handoff.
- `apps/desktop/src/ipc-handlers.ts`
  Add session lifecycle, session event, working-set, and supervision-mode IPC routes.
- `apps/desktop/src/preload.ts`
  Expose typed listeners for orchestration session updates in addition to the existing live panels.
- `apps/desktop/src/renderer/types.d.ts`
  Mirror the new preload contract.
- `apps/desktop/src/renderer/index.html`
  Add a visible sidebar entry for the orchestration session view.
- `apps/desktop/src/renderer/renderer.ts`
  Register the session view, title, and command-palette navigation item.
- `apps/desktop/src/renderer/styles.css`
  Add compact operational UI styles for the email-thread launcher, event timeline, gaps, and working-set cards.
- `apps/desktop/src/renderer/views/playground-view.ts`
  Turn the current generic chat flow into an email-thread-rooted orchestration launcher with supervision mode selection.
- `apps/desktop/src/renderer/views/providers-view.ts`
  Extend model-role assignment controls so planner, browser, validator, judge, and knowledge roles can be routed to the Umans fast/intelligent models or other providers.
- `apps/desktop/src/ipc-handlers.test.ts`
  Cover new orchestration routes.
- `packages/core-runtime/src/orchestrator.test.ts`
  Add tests for looping and specialist handoff decisions.
- `packages/local-store/src/sqlite.test.ts`
  Cover new persistence tables and repository methods.

### New files to create

- `packages/core-runtime/src/browser-orchestration.ts`
  Session-oriented orchestration runtime for Goals, Planner, Browser, Knowledge, Validator, Judge, and specialist handoff contracts.
- `packages/core-runtime/src/browser-orchestration.test.ts`
  Focused runtime tests for collection loops and completion gates.
- `apps/desktop/src/session-events.ts`
  Helpers to emit orchestration session updates to the renderer.
- `apps/desktop/src/renderer/views/session-view.ts`
  Session working-set and event timeline UI for the new orchestration flow.

### Design constraints for implementation

- Keep browser collection as the center of the PoC. Do not solve future hardware orchestration here.
- Keep persistent knowledge tenant-scoped for business data.
- Let agents loop aggressively, but require structured session events for every meaningful step.
- Route outputs through validator and judge before surfacing them to the user.

## Existing-System Connection Map

- `playground-view.ts` remains the entry point for starting work. It creates the conversation and run exactly like the current chat flow, then creates a browser-orchestration session linked to that run.
- `runAgent()` in `apps/desktop/src/agent-runner.ts` remains the desktop runtime entry point. The new session fields select the orchestration path; ordinary chat runs continue using the existing ReAct path.
- `ipc-handlers.ts` remains the single `carbon-ipc` boundary. New session routes must use `IpcRequestSchema` / `IpcResponseSchema` and must not bypass the preload bridge.
- `CarbonDatabase` remains the persistence boundary. Session/event/working-set rows live next to the existing `runs`, `documents`, and `messages` tables instead of using sidecar JSON files.
- `desktop-events.ts` remains the live-debug event pattern. `session-events.ts` should follow the same `BrowserWindow.getAllWindows().webContents.send(...)` style.
- `providers-view.ts` remains the model-configuration UI. New core-agent roles should extend the existing model role workflow, not create a separate settings screen.
- `outputs-view.ts` and existing document generation stay downstream. The orchestration layer should produce validated inputs and specialist outputs; it should not duplicate the output library.

## Global Quality Gates

Every implementation task must satisfy these gates before committing:

- The task has a failing test before implementation unless it is a pure renderer presentation task.
- The task passes its focused test command.
- The touched package passes `pnpm --filter <package> typecheck`.
- New IPC routes are added to shared schemas, main handlers, preload/renderer types, and tests together.
- New persisted data is written through `CarbonDatabase`, not ad hoc files.
- New live renderer data is emitted through Electron events and has a graceful empty/loading/error UI state.
- No task may weaken existing chat, vault, outputs, provider, profile, watcher, or run-event behavior.
- In the dirty checkout, commits must stage only files touched by the task. Do not use broad `git add .`.

---

### Task 1: Add typed orchestration contracts

**Files:**
- Modify: `packages/shared-schemas/src/index.ts`
- Modify: `packages/shared-schemas/src/index.test.ts`
- Test: `pnpm --filter @carbon-agent/shared-schemas test -- index.test.ts`
- Test: `pnpm --filter @carbon-agent/shared-schemas typecheck`

- [ ] **Step 1: Write failing schema contract tests**

Add these imports to `packages/shared-schemas/src/index.test.ts` after the existing schema imports:

```ts
  OrchestrationSessionSchema,
  SessionEventSchema,
  SessionWorkingSetSchema,
```

Add this test block inside the existing `describe("Schema Validation", () => { })` body:

```ts
  describe("Orchestration session schemas", () => {
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
      expect(() => OrchestrationSessionSchema.parse({
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
      })).toThrow();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carbon-agent/shared-schemas test -- index.test.ts`

Expected: FAIL because `OrchestrationSessionSchema`, `SessionEventSchema`, and `SessionWorkingSetSchema` are not exported yet.

- [ ] **Step 3: Add orchestration enum and record schemas**

Add the following Zod-backed types and IPC messages to `packages/shared-schemas/src/index.ts`:

```ts
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
  "document_discovered",
  "document_acquired",
  "working_set_updated",
  "validation_passed",
  "validation_failed",
  "judgment_requested",
  "judgment_returned",
  "specialist_spawned",
  "specialist_completed",
  "output_approved",
  "output_rejected",
]);
```

- [ ] **Step 4: Add session-level domain objects**

Define the top-level objects that all layers must share:

```ts
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

export const SessionEventSchema = z.object({
  id: UuidSchema,
  sessionId: UuidSchema,
  role: CoreAgentRoleSchema,
  kind: SessionEventKindSchema,
  summary: z.string().min(1),
  payload: z.record(z.unknown()),
  createdAt: TimestampSchema,
});

export const SessionWorkingSetSchema = z.object({
  sessionId: UuidSchema,
  entities: z.array(z.record(z.unknown())).default([]),
  documents: z.array(WorkingSetDocumentSchema).default([]),
  metrics: z.array(z.record(z.unknown())).default([]),
  gaps: z.array(z.string()).default([]),
  provenanceScore: z.number().min(0).max(1).default(0),
  updatedAt: TimestampSchema,
});
```

- [ ] **Step 5: Add orchestration IPC request and response shapes**

Extend the existing IPC schema unions with the first orchestration routes:

```ts
const SessionCreateRequestSchema = z.object({
  type: z.literal("session/create"),
  workspaceId: UuidSchema,
  conversationId: UuidSchema,
  runId: UuidSchema,
  root: SessionRootSchema,
  supervisionMode: SupervisionModeSchema,
  goal: z.string().min(1),
});

const SessionStartRequestSchema = z.object({
  type: z.literal("session/start"),
  id: UuidSchema,
});

const SessionGetRequestSchema = z.object({
  type: z.literal("session/get"),
  id: UuidSchema,
});

const SessionEventsRequestSchema = z.object({
  type: z.literal("session/events"),
  id: UuidSchema,
});

const SessionWorkingSetRequestSchema = z.object({
  type: z.literal("session/working-set"),
  id: UuidSchema,
});
```

Add matching success responses:

```ts
const SessionCreateSuccessSchema = z.object({
  type: z.literal("session/create.success"),
  data: OrchestrationSessionSchema,
});

const SessionGetSuccessSchema = z.object({
  type: z.literal("session/get.success"),
  data: OrchestrationSessionSchema,
});

const SessionStartSuccessSchema = z.object({
  type: z.literal("session/start.success"),
  data: z.object({
    runStatus: z.enum(["completed", "failed", "cancelled"]),
    fullResponse: z.string(),
    runError: z.string().optional(),
    runId: UuidSchema,
  }),
});

const SessionEventsSuccessSchema = z.object({
  type: z.literal("session/events.success"),
  events: z.array(SessionEventSchema),
});

const SessionWorkingSetSuccessSchema = z.object({
  type: z.literal("session/working-set.success"),
  data: SessionWorkingSetSchema,
});
```

- [ ] **Step 6: Run schema tests and typecheck**

Run: `pnpm --filter @carbon-agent/shared-schemas test -- index.test.ts`

Expected: PASS with the new orchestration schema tests.

Run: `pnpm --filter @carbon-agent/shared-schemas typecheck`

Expected: PASS with no exported-type errors.

- [ ] **Step 7: Build the schema package**

Run: `pnpm --filter @carbon-agent/shared-schemas build`

Expected: build completes without type or Zod export errors.

- [ ] **Step 8: Quality gate**

Pass criteria:

- `IpcRequestSchema.parse()` accepts valid `session/create` input containing workspace, conversation, run, root, supervision mode, and goal fields.
- `IpcRequestSchema.parse()` rejects `session/create` input when `supervisionMode` is `"silent"`.
- `IpcResponseSchema` accepts `session/create.success`, `session/get.success`, `session/start.success`, `session/events.success`, and `session/working-set.success`.
- Existing provider/profile/workspace/run IPC schema tests still pass.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-schemas/src/index.ts packages/shared-schemas/src/index.test.ts
git commit -m "feat: add browser orchestration schemas"
```

### Task 2: Add local persistence for sessions, events, working sets, and tenant memory

**Files:**
- Modify: `packages/local-store/src/sqlite.ts`
- Modify: `packages/local-store/src/index.ts`
- Modify: `packages/local-store/src/model-roles.ts`
- Test: `packages/local-store/src/sqlite.test.ts`

- [ ] **Step 1: Write the failing persistence test**

Add a test like this to `packages/local-store/src/sqlite.test.ts`:

```ts
it("creates and reads an orchestration session with events and working set", async () => {
  const db = new CarbonDatabase();
  await db.createWorkspace({
    id: "550e8400-e29b-41d4-a716-446655440010",
    name: "WS",
    vaultDir: "/tmp/ws",
  });
  await db.createConversation({
    id: "550e8400-e29b-41d4-a716-446655440012",
    workspaceId: "550e8400-e29b-41d4-a716-446655440010",
  });
  await db.createRun({
    id: "550e8400-e29b-41d4-a716-446655440013",
    conversationId: "550e8400-e29b-41d4-a716-446655440012",
    workspaceId: "550e8400-e29b-41d4-a716-446655440010",
    providerId: null,
    jsonlLogPath: "/tmp/orchestration-run.jsonl",
  });

  await db.createOrchestrationSession({
    id: "550e8400-e29b-41d4-a716-446655440011",
    workspaceId: "550e8400-e29b-41d4-a716-446655440010",
    conversationId: "550e8400-e29b-41d4-a716-446655440012",
    runId: "550e8400-e29b-41d4-a716-446655440013",
    rootKind: "outlook-thread",
    rootJson: JSON.stringify({ threadId: "t-1", threadSubject: "Month end", mailbox: "finance@client.com" }),
    supervisionMode: "watch",
    status: "running",
    currentGoal: "Collect supporting financial data",
  });

  await db.appendSessionEvent({
    id: "550e8400-e29b-41d4-a716-446655440014",
    sessionId: "550e8400-e29b-41d4-a716-446655440011",
    role: "planner",
    kind: "plan_updated",
    summary: "Search Outlook attachments first",
    payloadJson: JSON.stringify({ sources: ["outlook-thread"] }),
  });

  await db.saveSessionWorkingSet({
    sessionId: "550e8400-e29b-41d4-a716-446655440011",
    entitiesJson: JSON.stringify([{ type: "client", name: "Acme" }]),
    documentsJson: JSON.stringify([{ id: "doc-1", source: "outlook-thread", title: "P&L draft", confidence: 0.9, provenance: ["event-1"] }]),
    metricsJson: JSON.stringify([]),
    gapsJson: JSON.stringify(["Need Xero confirmation"]),
    provenanceScore: 0.78,
  });

  const session = await db.getOrchestrationSession("550e8400-e29b-41d4-a716-446655440011");
  const events = await db.listSessionEvents("550e8400-e29b-41d4-a716-446655440011");
  const workingSet = await db.getSessionWorkingSet("550e8400-e29b-41d4-a716-446655440011");

  expect(session?.current_goal).toBe("Collect supporting financial data");
  expect(events).toHaveLength(1);
  expect(JSON.parse(String(workingSet?.gaps_json))).toEqual(["Need Xero confirmation"]);
});
```

- [ ] **Step 2: Add the new tables**

Extend `initTables()` in `packages/local-store/src/sqlite.ts` with:

```sql
CREATE TABLE IF NOT EXISTS orchestration_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  root_kind TEXT NOT NULL,
  root_json TEXT NOT NULL,
  supervision_mode TEXT NOT NULL CHECK(supervision_mode IN ('watch','confirm')),
  status TEXT NOT NULL CHECK(status IN ('draft','running','waiting','completed','failed','cancelled')),
  current_goal TEXT NOT NULL,
  completion_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orchestration_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orchestration_working_sets (
  session_id TEXT PRIMARY KEY REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
  entities_json TEXT NOT NULL DEFAULT '[]',
  documents_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '[]',
  gaps_json TEXT NOT NULL DEFAULT '[]',
  provenance_score REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 3: Add repository methods**

Add focused methods to `CarbonDatabase`:

```ts
async createOrchestrationSession(p: {
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
}) {
  const db = await ensureDb();
  runStmt(db,
    `INSERT INTO orchestration_sessions
      (id, workspace_id, conversation_id, run_id, root_kind, root_json, supervision_mode, status, current_goal, completion_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.workspaceId, p.conversationId, p.runId, p.rootKind, p.rootJson, p.supervisionMode, p.status, p.currentGoal, p.completionSummary ?? null],
  );
}

async getOrchestrationSession(id: string) {
  const db = await ensureDb();
  return getRow(db, "SELECT * FROM orchestration_sessions WHERE id = ?", [id]);
}

async updateOrchestrationSessionStatus(id: string, status: string, completionSummary?: string | null) {
  const db = await ensureDb();
  runStmt(db,
    `UPDATE orchestration_sessions
     SET status = ?, completion_summary = COALESCE(?, completion_summary), updated_at = datetime('now')
     WHERE id = ?`,
    [status, completionSummary ?? null, id],
  );
}

async appendSessionEvent(p: { id: string; sessionId: string; role: string; kind: string; summary: string; payloadJson: string }) {
  const db = await ensureDb();
  runStmt(db,
    `INSERT INTO orchestration_session_events (id, session_id, role, kind, summary, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [p.id, p.sessionId, p.role, p.kind, p.summary, p.payloadJson],
  );
}

async listSessionEvents(sessionId: string) {
  const db = await ensureDb();
  return getRows(db,
    "SELECT * FROM orchestration_session_events WHERE session_id = ? ORDER BY created_at ASC, id ASC",
    [sessionId],
  );
}

async saveSessionWorkingSet(p: {
  sessionId: string;
  entitiesJson: string;
  documentsJson: string;
  metricsJson: string;
  gapsJson: string;
  provenanceScore: number;
}) {
  const db = await ensureDb();
  runStmt(db,
    `INSERT INTO orchestration_working_sets
      (session_id, entities_json, documents_json, metrics_json, gaps_json, provenance_score, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(session_id) DO UPDATE SET
      entities_json = excluded.entities_json,
      documents_json = excluded.documents_json,
      metrics_json = excluded.metrics_json,
      gaps_json = excluded.gaps_json,
      provenance_score = excluded.provenance_score,
      updated_at = datetime('now')`,
    [p.sessionId, p.entitiesJson, p.documentsJson, p.metricsJson, p.gapsJson, p.provenanceScore],
  );
}

async getSessionWorkingSet(sessionId: string) {
  const db = await ensureDb();
  return getRow(db, "SELECT * FROM orchestration_working_sets WHERE session_id = ?", [sessionId]);
}
```

- [ ] **Step 4: Expand model roles for the new agents**

Update `packages/local-store/src/model-roles.ts` so the role enum and helpers support:

```ts
export type ModelRoleName =
  | "assistant"
  | "planner"
  | "browser"
  | "knowledge-graph"
  | "validator"
  | "judge"
  | "coder"
  | "meeting-notes";
```

Keep the persistence API stable so existing provider-role UI can extend rather than break.

- [ ] **Step 5: Export the new APIs**

Update `packages/local-store/src/index.ts` to export any new helpers introduced for orchestration persistence.

- [ ] **Step 6: Run the focused persistence tests**

Run: `pnpm --filter @carbon-agent/local-store test -- sqlite.test.ts`

Expected: the new orchestration persistence test passes.

- [ ] **Step 7: Run local-store typecheck**

Run: `pnpm --filter @carbon-agent/local-store typecheck`

Expected: PASS with no public API or model-role type errors.

- [ ] **Step 8: Quality gate**

Pass criteria:

- Session rows are linked to existing `workspaces`, `conversations`, and `runs`.
- Events are append-only; no update/delete method is added for session events.
- Working-set saves are idempotent for a session via `ON CONFLICT(session_id)`.
- Existing `documents`, `data_sources`, `runs`, `memories`, and `skills` tests still pass.
- Business memory stays workspace-scoped; no cross-workspace query is introduced.

- [ ] **Step 9: Commit**

```bash
git add packages/local-store/src/sqlite.ts packages/local-store/src/sqlite.test.ts packages/local-store/src/model-roles.ts packages/local-store/src/index.ts
git commit -m "feat: persist orchestration sessions and working sets"
```

### Task 3: Implement the core browser orchestration runtime

**Files:**
- Create: `packages/core-runtime/src/browser-orchestration.ts`
- Create: `packages/core-runtime/src/browser-orchestration.test.ts`
- Modify: `packages/core-runtime/src/index.ts`
- Modify: `packages/core-runtime/src/orchestrator.test.ts`

- [ ] **Step 1: Write the failing runtime tests**

Create `packages/core-runtime/src/browser-orchestration.test.ts` with tests like:

```ts
import { describe, expect, it, vi } from "vitest";
import { BrowserOrchestrationRuntime } from "./browser-orchestration.js";

function createRuntime(overrides: Partial<ConstructorParameters<typeof BrowserOrchestrationRuntime>[0]> = {}) {
  const onEvent = vi.fn();
  const saveWorkingSet = vi.fn().mockResolvedValue(undefined);
  const delegateSpecialist = vi.fn().mockResolvedValue({ success: true, result: "statement.md" });
  const browserTools = {
    stealth_open: vi.fn().mockResolvedValue({ success: true }),
    stealth_scrape: vi.fn().mockResolvedValue({ success: true, text: "Xero invoice total: 1200" }),
    stealth_download: vi.fn().mockResolvedValue({ success: true, filePath: "/tmp/report.xlsx" }),
    ingest_file: vi.fn().mockResolvedValue({ success: true, documentId: "doc-1" }),
    rag_retrieve: vi.fn().mockResolvedValue({ success: true, chunks: [] }),
  };

  return {
    onEvent,
    saveWorkingSet,
    delegateSpecialist,
    browserTools,
    runtime: new BrowserOrchestrationRuntime({
      maxRounds: 3,
      onEvent,
      saveWorkingSet,
      delegateSpecialist,
      browserTools,
      planner: vi.fn()
        .mockResolvedValueOnce({ summary: "Search SharePoint for linked budget", source: "sharepoint", query: "Month end close budget" })
        .mockResolvedValueOnce({ summary: "Search Xero for invoice totals", source: "xero", query: "Acme invoice totals" }),
      validator: vi.fn().mockResolvedValue({ ok: true, gaps: [] }),
      judge: vi.fn()
        .mockResolvedValueOnce({ complete: false, gaps: ["Need Xero totals"], summary: "Evidence is incomplete" })
        .mockResolvedValueOnce({ complete: true, gaps: [], summary: "Evidence is sufficient" }),
      ...overrides,
    }),
  };
}

it("loops planner -> browser -> validator -> judge until sufficient", async () => {
  const { runtime, onEvent, saveWorkingSet } = createRuntime();

  const result = await runtime.run({
    sessionId: "550e8400-e29b-41d4-a716-446655440040",
    workspaceId: "550e8400-e29b-41d4-a716-446655440041",
    conversationId: "550e8400-e29b-41d4-a716-446655440042",
    runId: "550e8400-e29b-41d4-a716-446655440043",
    goal: "Prepare financial evidence pack",
    supervisionMode: "watch",
    root: { kind: "outlook-thread", threadId: "t-1", threadSubject: "Month end", mailbox: "finance@client.com" },
  });

  expect(result.status).toBe("completed");
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "plan_updated" }));
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "judgment_returned" }));
  expect(saveWorkingSet).toHaveBeenCalled();
});

it("routes specialist generation only after judge completion", async () => {
  const { runtime, delegateSpecialist } = createRuntime();

  await runtime.run({
    sessionId: "550e8400-e29b-41d4-a716-446655440050",
    workspaceId: "550e8400-e29b-41d4-a716-446655440051",
    conversationId: "550e8400-e29b-41d4-a716-446655440052",
    runId: "550e8400-e29b-41d4-a716-446655440053",
    goal: "Build a financial statement from validated inputs",
    supervisionMode: "watch",
    root: { kind: "outlook-thread", threadId: "t-2", threadSubject: "Statement pack", mailbox: "finance@client.com" },
  });

  expect(delegateSpecialist).toHaveBeenCalledWith(expect.objectContaining({
    role: expect.stringMatching(/claude-code|codex|general/),
    workspaceId: "550e8400-e29b-41d4-a716-446655440051",
  }));
});

it("fails the session when max rounds are exhausted", async () => {
  const { runtime, delegateSpecialist } = createRuntime({
    maxRounds: 2,
    judge: vi.fn().mockResolvedValue({ complete: false, gaps: ["Still missing source evidence"], summary: "Not complete" }),
  });

  const result = await runtime.run({
    sessionId: "550e8400-e29b-41d4-a716-446655440060",
    workspaceId: "550e8400-e29b-41d4-a716-446655440061",
    conversationId: "550e8400-e29b-41d4-a716-446655440062",
    runId: "550e8400-e29b-41d4-a716-446655440063",
    goal: "Collect evidence",
    supervisionMode: "watch",
    root: { kind: "outlook-thread", threadId: "t-3", threadSubject: "Evidence", mailbox: "finance@client.com" },
  });

  expect(result.status).toBe("failed");
  expect(delegateSpecialist).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Create the orchestration runtime**

Implement `packages/core-runtime/src/browser-orchestration.ts` around a session-oriented contract:

```ts
export interface BrowserOrchestrationInput {
  sessionId: string;
  workspaceId: string;
  conversationId: string;
  runId: string;
  goal: string;
  supervisionMode: "watch" | "confirm";
  root: {
    kind: "outlook-thread";
    threadId: string;
    threadSubject: string;
    mailbox: string;
  };
}

export interface BrowserOrchestrationRuntimeDeps {
  onEvent(event: SessionEventLike): Promise<void> | void;
  saveWorkingSet(state: WorkingSetLike): Promise<void>;
  delegateSpecialist(input: {
    role: "claude-code" | "codex" | "general";
    taskDescription: string;
    context: string;
    workspaceId: string;
  }): Promise<{ success: boolean; result: string; error?: string }>;
  browserTools: Pick<ToolExecutor, "stealth_open" | "stealth_scrape" | "stealth_download" | "ingest_file" | "rag_retrieve">;
  planner(input: BrowserOrchestrationPlannerInput): Promise<{ summary: string; source: string; query: string }>;
  validator(input: BrowserOrchestrationValidatorInput): Promise<{ ok: boolean; gaps: string[] }>;
  judge(input: BrowserOrchestrationJudgeInput): Promise<{ complete: boolean; gaps: string[]; summary: string }>;
  maxRounds?: number;
}
```

The runtime should:

- emit structured events for every stage
- keep a mutable in-memory working set per run
- call planner/browser/validator/judge roles in sequence
- loop until the judge says complete or max orchestration rounds are hit
- invoke a specialist only after completion

- [ ] **Step 3: Reuse the existing runtime without burying everything in prompts**

Use the existing `AgentRuntime` where it helps, but keep the new orchestration loop explicit:

```ts
for (let round = 0; round < maxRounds; round += 1) {
  const plan = await planner({ input, workingSet: currentState, round });
  await onEvent({ role: "planner", kind: "plan_updated", summary: plan.summary, payload: plan });

  const browserResult = await collectWithBrowserTools(plan, browserTools);
  await onEvent({ role: "browser", kind: "browser_action_completed", summary: browserResult.summary, payload: browserResult });

  currentState = mergeBrowserResult(currentState, browserResult);
  await saveWorkingSet(currentState);

  const validation = await validator({ input, workingSet: currentState });
  await onEvent({ role: "validator", kind: validation.ok ? "validation_passed" : "validation_failed", summary: validation.gaps.join("; ") || "Validation passed", payload: validation });

  await onEvent({ role: "judge", kind: "judgment_requested", summary: "Judge working set sufficiency", payload: { goal } });
  const judgment = await judge({ input, workingSet: currentState, validation });
  await onEvent({ role: "judge", kind: "judgment_returned", summary: judgment.summary, payload: judgment });

  if (judgment.complete) break;
  currentState.gaps = judgment.gaps;
}
```

- [ ] **Step 4: Export the new runtime**

Update `packages/core-runtime/src/index.ts`:

```ts
export * from "./browser-orchestration.js";
```

- [ ] **Step 5: Run the focused runtime tests**

Run: `pnpm --filter @carbon-agent/core-runtime test -- browser-orchestration.test.ts orchestrator.test.ts`

Expected: the new loop tests pass and existing orchestrator tests remain green.

- [ ] **Step 6: Run core-runtime typecheck**

Run: `pnpm --filter @carbon-agent/core-runtime typecheck`

Expected: PASS with all orchestration runtime exports resolved.

- [ ] **Step 7: Quality gate**

Pass criteria:

- The runtime emits at least `goal_defined`, `plan_updated`, `browser_action_completed`, `working_set_updated`, `validation_passed` or `validation_failed`, `judgment_requested`, and `judgment_returned`.
- The runtime never calls `delegateSpecialist` until a judge returns `complete: true`.
- Exhausting `maxRounds` returns `status: "failed"` and writes a final judge event with remaining gaps.
- Planner, validator, and judge are injectable so desktop model routing can wire real providers later.
- Existing `SupervisorOrchestrator` tests still pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core-runtime/src/browser-orchestration.ts packages/core-runtime/src/browser-orchestration.test.ts packages/core-runtime/src/index.ts packages/core-runtime/src/orchestrator.test.ts
git commit -m "feat: add browser orchestration runtime"
```

### Task 4: Wire the desktop runner and IPC to orchestration sessions

**Files:**
- Modify: `apps/desktop/src/agent-runner.ts`
- Modify: `apps/desktop/src/ipc-handlers.ts`
- Create: `apps/desktop/src/session-events.ts`
- Modify: `apps/desktop/src/ipc-handlers.test.ts`

- [ ] **Step 1: Write the failing IPC tests**

Extend `apps/desktop/src/ipc-handlers.test.ts` with:

```ts
it("creates an orchestration session", async () => {
  const response = await mockState.registeredHandler?.({}, {
    type: "session/create",
    workspaceId: "550e8400-e29b-41d4-a716-446655440020",
    conversationId: "550e8400-e29b-41d4-a716-446655440021",
    runId: "550e8400-e29b-41d4-a716-446655440022",
    root: { kind: "outlook-thread", threadId: "t-1", threadSubject: "Month end", mailbox: "finance@client.com" },
    supervisionMode: "watch",
    goal: "Collect and prepare reporting inputs",
  });

  expect(response).toMatchObject({
    type: "session/create.success",
    data: expect.objectContaining({
      supervisionMode: "watch",
      currentGoal: "Collect and prepare reporting inputs",
    }),
  });
});

it("returns working-set and event snapshots", async () => {
  const events = await mockState.registeredHandler?.({}, { type: "session/events", id: "550e8400-e29b-41d4-a716-446655440022" });
  const workingSet = await mockState.registeredHandler?.({}, { type: "session/working-set", id: "550e8400-e29b-41d4-a716-446655440022" });
  expect(events).toMatchObject({ type: "session/events.success" });
  expect(workingSet).toMatchObject({ type: "session/working-set.success" });
});
```

Update the `CarbonDatabase` mock in `apps/desktop/src/ipc-handlers.test.ts` with these methods:

```ts
createOrchestrationSession = vi.fn().mockResolvedValue(undefined);
getOrchestrationSession = vi.fn().mockResolvedValue({
  id: "550e8400-e29b-41d4-a716-446655440022",
  workspace_id: "550e8400-e29b-41d4-a716-446655440020",
  conversation_id: "550e8400-e29b-41d4-a716-446655440021",
  run_id: "550e8400-e29b-41d4-a716-446655440023",
  root_json: JSON.stringify({ kind: "outlook-thread", threadId: "t-1", threadSubject: "Month end", mailbox: "finance@client.com" }),
  supervision_mode: "watch",
  status: "draft",
  current_goal: "Collect and prepare reporting inputs",
  completion_summary: null,
  created_at: "2026-06-06T00:00:00.000Z",
  updated_at: "2026-06-06T00:00:00.000Z",
});
listSessionEvents = vi.fn().mockResolvedValue([]);
getSessionWorkingSet = vi.fn().mockResolvedValue(undefined);
getRun = vi.fn().mockResolvedValue({
  id: "550e8400-e29b-41d4-a716-446655440023",
  provider_id: "550e8400-e29b-41d4-a716-446655440024",
});
```

- [ ] **Step 2: Create desktop event helpers**

Create `apps/desktop/src/session-events.ts`:

```ts
import { BrowserWindow } from "electron";

export function emitSessionUpdate(payload: {
  sessionId: string;
  status: string;
  currentGoal: string;
}) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("carbon-event:session-update", payload);
  }
}

export function emitSessionWorkingSet(payload: {
  sessionId: string;
  documents: unknown[];
  gaps: string[];
  provenanceScore: number;
}) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("carbon-event:session-working-set", payload);
  }
}
```

- [ ] **Step 3: Replace the free-form runner path with session-aware orchestration**

Refactor `apps/desktop/src/agent-runner.ts` so the existing `runAgent()` can call the new runtime when a session context is present:

```ts
export interface RunAgentInput {
  db: CarbonDatabase;
  workspaceId: string;
  conversationId: string;
  providerId: string;
  message: string;
  sessionId?: string;
  sessionGoal?: string;
  sessionRoot?: {
    kind: "outlook-thread";
    threadId: string;
    threadSubject: string;
    mailbox: string;
  };
  supervisionMode?: "watch" | "confirm";
}
```

Inside the session path:

- load model-role assignments for planner/browser/knowledge/validator/judge
- append session events through the database
- persist working-set snapshots after each loop
- emit desktop session updates for the renderer
- hand specialist output through the validator/judge gates before writing the final assistant message

- [ ] **Step 4: Add IPC routes**

In `apps/desktop/src/ipc-handlers.ts`, add:

```ts
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
  return { type: "session/create.success", data: mapOrchestrationSessionRow(row) };
}

case "session/get": {
  const row = await d.getOrchestrationSession(request.id);
  if (!row) return { type: "error", error: "Session not found", code: "SESSION_NOT_FOUND" };
  return { type: "session/get.success", data: mapOrchestrationSessionRow(row) };
}

case "session/events": {
  const rows = await d.listSessionEvents(request.id);
  return { type: "session/events.success", events: rows.map(mapSessionEventRow) };
}

case "session/working-set": {
  const row = await d.getSessionWorkingSet(request.id);
  return { type: "session/working-set.success", data: mapWorkingSetRow(request.id, row) };
}

case "session/start": {
  const row = await d.getOrchestrationSession(request.id);
  if (!row) return { type: "error", error: "Session not found", code: "SESSION_NOT_FOUND" };
  const run = await d.getRun(String(row.run_id));
  if (!run) return { type: "error", error: "Run not found", code: "RUN_NOT_FOUND" };
  if (!run.provider_id) return { type: "error", error: "Run has no provider", code: "PROVIDER_NOT_FOUND" };
  const root = JSON.parse(String(row.root_json)) as { kind: "outlook-thread"; threadId: string; threadSubject: string; mailbox: string };
  const runResult = await runAgent({
    db: d,
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    providerId: String(run.provider_id),
    message: String(row.current_goal),
    runId: String(row.run_id),
    sessionId: String(row.id),
    sessionGoal: String(row.current_goal),
    sessionRoot: root,
    supervisionMode: String(row.supervision_mode) as "watch" | "confirm",
  });
  return { type: "session/start.success", data: runResult };
}
```

For `session/start`, reuse the existing run lifecycle instead of inventing a second run table.

Add these mapper helpers near the existing `mapDocumentRow`, `mapSkillRow`, and `mapMemoryRow` helpers:

```ts
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
```

- [ ] **Step 5: Run the desktop tests**

Run: `pnpm --filter carbon-agent-desktop test -- ipc-handlers.test.ts`

Expected: session IPC tests pass alongside the existing routes.

- [ ] **Step 6: Run desktop typecheck**

Run: `pnpm --filter carbon-agent-desktop typecheck`

Expected: PASS with session IPC routes, runner inputs, and event emitters typed.

- [ ] **Step 7: Quality gate**

Pass criteria:

- `session/start` reuses an existing `runs` row through `runId`; it does not create a second run history system.
- `run/events` still returns JSONL events for the same run used by orchestration.
- Session events are visible through `session/events` and live through `carbon-event:session-update`.
- Missing session IDs return a typed `error` response, not an uncaught exception.
- Existing `document/list`, `skills/list`, `vault/list`, `run/create`, and `run/stream` IPC tests still pass.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/agent-runner.ts apps/desktop/src/ipc-handlers.ts apps/desktop/src/ipc-handlers.test.ts apps/desktop/src/session-events.ts
git commit -m "feat: wire desktop orchestration sessions"
```

### Task 5: Add the email-thread launcher and session timeline UI

**Files:**
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/renderer/types.d.ts`
- Modify: `apps/desktop/src/renderer/index.html`
- Modify: `apps/desktop/src/renderer/renderer.ts`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/views/playground-view.ts`
- Modify: `apps/desktop/src/renderer/views/providers-view.ts`
- Create: `apps/desktop/src/renderer/views/session-view.ts`

- [ ] **Step 1: Add the preload listeners**

Extend `CarbonAPI` in `apps/desktop/src/preload.ts`:

```ts
export interface CarbonAPI {
  invoke(request: IpcRequest): Promise<IpcResponse>;
  onSessionUpdate?: (callback: (payload: { sessionId: string; status: string; currentGoal: string }) => void) => () => void;
  onSessionWorkingSet?: (callback: (payload: { sessionId: string; documents: unknown[]; gaps: string[]; provenanceScore: number }) => void) => () => void;
}

const api: CarbonAPI = {
  invoke: async (request) => ipcRenderer.invoke("carbon-ipc", request) as Promise<IpcResponse>,
  onSessionUpdate: createListener("carbon-event:session-update"),
  onSessionWorkingSet: createListener("carbon-event:session-working-set"),
};
```

Mirror those listener types in `apps/desktop/src/renderer/types.d.ts`.

- [ ] **Step 2: Add model-role controls for core agents**

Update `apps/desktop/src/renderer/views/providers-view.ts` so the existing role assignment UI includes:

```ts
const roleDefinitions = [
  { role: "assistant", label: "Main Assistant", hint: "User-facing coordination and final delivery" },
  { role: "planner", label: "Planner", hint: "Collection strategy and source traversal" },
  { role: "browser", label: "Browser Execution", hint: "Fast browser operation and extraction loops" },
  { role: "knowledge-graph", label: "Knowledge Graph", hint: "Entity, document, metric, and provenance normalization" },
  { role: "validator", label: "Validator", hint: "Extraction quality and consistency checks" },
  { role: "judge", label: "Judge", hint: "Completion and output approval gates" },
  { role: "coder", label: "Coder", hint: "Claude Code or Codex task execution" },
  { role: "meeting-notes", label: "Drafting", hint: "Document and report drafting" },
] as const;
```

Quality requirement: the role selector must use the existing `model-roles/list`, `model-roles/set`, and `model-roles/delete` IPC routes. Do not create a second model configuration store.

- [ ] **Step 3: Register the session view in navigation**

Update `apps/desktop/src/renderer/index.html` by adding a Core nav item after Playground:

```html
<div class="nav-item" data-view="sessions">S Sessions</div>
```

Update `apps/desktop/src/renderer/renderer.ts`:

```ts
import { renderSessionView } from "./views/session-view.js";

const titleMap: Record<string, string> = {
  playground: "Playground",
  sessions: "Sessions",
  // keep existing entries
};

function getCommandPaletteItems(): CommandPaletteItem[] {
  return [
    { group: "Navigation", iconClass: "icon-playground", label: "Go to Playground", action: () => setActiveView("playground"), shortcut: "G P" },
    { group: "Navigation", iconClass: "icon-session", label: "Go to Sessions", action: () => setActiveView("sessions"), shortcut: "G S" },
    // keep existing entries
  ];
}

registerView("sessions", { render: renderSessionView });
```

If `G S` conflicts with Learned Skills, assign Sessions to `G E` and keep Skills unchanged.

- [ ] **Step 4: Convert the playground entry form**

Replace the current generic chat-only launch path in `apps/desktop/src/renderer/views/playground-view.ts` with the fields required by the PoC:

```ts
const threadSubjectInput = createInput("Email thread subject");
const threadIdInput = createInput("Outlook thread ID or URL fragment");
const mailboxInput = createInput("Mailbox");
const supervisionMode = document.createElement("select");
supervisionMode.innerHTML = `
  <option value="watch">Watch Mode</option>
  <option value="confirm">Confirm Mode</option>
`;
```

On send:

```ts
const convResp = await window.carbonAPI.invoke({ type: "conversation/create", workspaceId } as any);
const runResp = await window.carbonAPI.invoke({ type: "run/create", conversationId, providerId } as any);
const sessionResp = await window.carbonAPI.invoke({
  type: "session/create",
  workspaceId,
  conversationId,
  runId,
  root: { kind: "outlook-thread", threadId, threadSubject, mailbox },
  supervisionMode: supervisionMode.value,
  goal: text,
} as any);
await window.carbonAPI.invoke({ type: "session/start", id: sessionResp.data.id } as any);
```

On successful `session/create`, set `appState.currentRunId` to the linked run, append a system message containing the session ID, and expose a "View Session" button that calls `window.__setActiveView__?.("sessions")`.

- [ ] **Step 5: Add a session timeline panel**

Create `apps/desktop/src/renderer/views/session-view.ts` with a minimal event and working-set panel:

```ts
function createTimelineRow(status: string, text: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "session-timeline-row";
  const statusEl = document.createElement("span");
  statusEl.className = "session-status";
  statusEl.textContent = status;
  const textEl = document.createElement("span");
  textEl.textContent = text;
  row.append(statusEl, textEl);
  return row;
}

function renderGap(gap: string): HTMLElement {
  const item = document.createElement("li");
  item.textContent = gap;
  return item;
}

function renderDocumentCard(rawDocument: unknown): HTMLElement {
  const doc = rawDocument as { title?: string; source?: string; confidence?: number };
  const card = document.createElement("div");
  card.className = "session-document-card";
  const title = document.createElement("strong");
  title.textContent = doc.title ?? "Untitled document";
  const source = document.createElement("span");
  source.textContent = doc.source ?? "unknown source";
  const confidence = document.createElement("small");
  confidence.textContent = `${Math.round((doc.confidence ?? 0) * 100)}% confidence`;
  card.append(title, source, confidence);
  return card;
}

export function renderSessionView(container: HTMLElement): void {
  container.innerHTML = "";
  const timeline = document.createElement("div");
  timeline.className = "session-timeline";
  const gaps = document.createElement("ul");
  gaps.className = "session-gaps";
  const docs = document.createElement("div");
  docs.className = "session-documents";

  window.carbonAPI.onSessionUpdate?.((payload) => {
    timeline.prepend(createTimelineRow(payload.status, payload.currentGoal));
  });

  window.carbonAPI.onSessionWorkingSet?.((payload) => {
    gaps.replaceChildren(...payload.gaps.map(renderGap));
    docs.replaceChildren(...payload.documents.map(renderDocumentCard));
  });

  container.append(timeline, gaps, docs);
}
```

Keep it simple. The first goal is observability of the orchestration loop, not polished UX.

- [ ] **Step 6: Add compact operational styles**

Update `apps/desktop/src/renderer/styles.css` with stable, compact styles:

```css
.session-launch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.session-timeline {
  display: grid;
  gap: 8px;
}

.session-timeline-row,
.session-document-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  background: var(--surface);
}

.session-status {
  display: inline-block;
  min-width: 82px;
  font-weight: 600;
}

.session-documents {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}
```

Use existing CSS variables where available. Do not introduce a new visual theme for this view.

- [ ] **Step 7: Run the desktop build**

Run: `pnpm --filter carbon-agent-desktop build`

Expected: preload, renderer, and new session UI compile cleanly.

- [ ] **Step 8: Run desktop typecheck**

Run: `pnpm --filter carbon-agent-desktop typecheck`

Expected: PASS with no renderer or preload contract errors.

- [ ] **Step 9: GUI quality gate**

Pass criteria:

- Sidebar contains a visible `Sessions` nav item.
- Command palette can navigate to `Sessions`.
- Playground starts a session from workspace, provider, thread subject, thread ID, mailbox, supervision mode, and goal.
- Provider settings expose model-role routing for assistant, planner, browser, knowledge graph, validator, judge, coder, and drafting roles.
- Session view displays live status, gaps, and documents without overlapping text at desktop widths.
- Empty session view renders a useful empty state instead of blank content.
- Existing Playground generic chat behavior is either preserved for non-session runs or intentionally replaced with session launch behavior in a way that does not break `run/create` and `run/stream`.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/preload.ts apps/desktop/src/renderer/types.d.ts apps/desktop/src/renderer/index.html apps/desktop/src/renderer/renderer.ts apps/desktop/src/renderer/styles.css apps/desktop/src/renderer/views/playground-view.ts apps/desktop/src/renderer/views/providers-view.ts apps/desktop/src/renderer/views/session-view.ts
git commit -m "feat: add browser orchestration session UI"
```

### Task 6: End-to-end verification and regression sweep

**Files:**
- Verify only; no required source changes unless defects appear

- [ ] **Step 1: Run package-level typecheck**

Run: `pnpm -r typecheck`

Expected: all workspace packages typecheck successfully.

- [ ] **Step 2: Run workspace tests**

Run: `pnpm -r test`

Expected: local-store, core-runtime, and desktop tests all pass.

- [ ] **Step 3: Run desktop build**

Run: `pnpm --filter carbon-agent-desktop build`

Expected: desktop app builds without IPC or renderer errors.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`

Expected: no new lint errors beyond pre-existing accepted warnings.

- [ ] **Step 5: Run integration route smoke tests**

Run: `pnpm --filter carbon-agent-desktop test -- ipc-handlers.test.ts`

Expected:

- `session/create` creates a session linked to a real run ID.
- `session/start` invokes `runAgent()` with session context.
- `session/events` returns ordered event rows.
- `session/working-set` returns empty defaults before the first update and persisted values after updates.
- Existing `document/list`, `skills/list`, `vault/list`, and `run/events` tests remain green.

- [ ] **Step 6: Manual GUI smoke check**

Run the desktop app and verify this flow:

1. Create/select a workspace
2. Create/select a provider using the Umans-compatible base URL and model
3. Assign model roles for assistant, planner, browser, knowledge graph, validator, and judge in Providers
4. Authenticate browser profiles for the relevant web systems
5. Enter Outlook thread subject, thread ID, mailbox, supervision mode, and goal in Playground
6. Start a session in `Watch Mode`
7. Confirm the `Sessions` view opens from sidebar and command palette
8. Confirm live session status updates appear
9. Confirm working-set documents/gaps update
10. Confirm final output passes back through the conversation and run log

- [ ] **Step 7: Final quality gate**

Pass criteria:

- Full verification commands pass: `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter carbon-agent-desktop build`, and `pnpm lint`.
- The final diff contains no new mock API path and no synthetic/demo backing data for these features.
- The session event trail is sufficient to reconstruct the plan, browser collection result, validation result, judge decision, and specialist handoff.
- The GUI exposes all required PoC controls without hiding the existing Vault, Outputs, Skills, Watchers, Providers, Profiles, and Debug views.
- No unrelated dirty files are staged.

- [ ] **Step 8: Final commit**

```bash
git status --short
git add packages/shared-schemas/src/index.ts packages/shared-schemas/src/index.test.ts
git add packages/local-store/src/sqlite.ts packages/local-store/src/sqlite.test.ts packages/local-store/src/model-roles.ts packages/local-store/src/index.ts
git add packages/core-runtime/src/browser-orchestration.ts packages/core-runtime/src/browser-orchestration.test.ts packages/core-runtime/src/index.ts packages/core-runtime/src/orchestrator.test.ts
git add apps/desktop/src/agent-runner.ts apps/desktop/src/ipc-handlers.ts apps/desktop/src/ipc-handlers.test.ts apps/desktop/src/session-events.ts
git add apps/desktop/src/preload.ts apps/desktop/src/renderer/types.d.ts apps/desktop/src/renderer/index.html apps/desktop/src/renderer/renderer.ts apps/desktop/src/renderer/styles.css apps/desktop/src/renderer/views/playground-view.ts apps/desktop/src/renderer/views/providers-view.ts apps/desktop/src/renderer/views/session-view.ts
git commit -m "feat: ship browser orchestration PoC foundation"
```

---

## Self-Review

- Spec coverage:
  - email-thread root: covered in Tasks 1, 4, and 5
  - persistent core agents and looping: covered in Task 3
  - machine-structured events and working sets: covered in Tasks 1 and 2
  - browser-native collection path and specialist handoff: covered in Tasks 3 and 4
  - renderer launch/supervision mode: covered in Task 5
- Banned-token scan:
  - no unresolved implementation markers remain
- Type consistency:
  - `session/create`, `session/start`, `session/events`, and `session/working-set` names match across schema, IPC, and renderer tasks
  - `watch` / `confirm` supervision modes are used consistently
