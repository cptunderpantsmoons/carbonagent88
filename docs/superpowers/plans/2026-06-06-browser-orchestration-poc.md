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
- `apps/desktop/src/renderer/views/playground-view.ts`
  Turn the current generic chat flow into an email-thread-rooted orchestration launcher with supervision mode selection.
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

---

### Task 1: Add typed orchestration contracts

**Files:**
- Modify: `packages/shared-schemas/src/index.ts`
- Test: `packages/shared-schemas` build via `pnpm --filter @carbon-agent/shared-schemas build`

- [ ] **Step 1: Add failing schema-usage tests indirectly by defining the target types in the plan**

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

- [ ] **Step 2: Add session-level domain objects**

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

- [ ] **Step 3: Add orchestration IPC request and response shapes**

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

const SessionEventsSuccessSchema = z.object({
  type: z.literal("session/events.success"),
  events: z.array(SessionEventSchema),
});

const SessionWorkingSetSuccessSchema = z.object({
  type: z.literal("session/working-set.success"),
  data: SessionWorkingSetSchema,
});
```

- [ ] **Step 4: Build the schema package**

Run: `pnpm --filter @carbon-agent/shared-schemas build`

Expected: build completes without type or Zod export errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-schemas/src/index.ts
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
}) { /* INSERT */ }

async getOrchestrationSession(id: string) { /* SELECT one */ }
async updateOrchestrationSessionStatus(id: string, status: string, completionSummary?: string | null) { /* UPDATE */ }
async appendSessionEvent(p: { id: string; sessionId: string; role: string; kind: string; summary: string; payloadJson: string }) { /* INSERT */ }
async listSessionEvents(sessionId: string) { /* SELECT ORDER BY created_at ASC */ }
async saveSessionWorkingSet(p: { sessionId: string; entitiesJson: string; documentsJson: string; metricsJson: string; gapsJson: string; provenanceScore: number }) { /* INSERT OR REPLACE */ }
async getSessionWorkingSet(sessionId: string) { /* SELECT one */ }
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

- [ ] **Step 7: Commit**

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
it("loops planner -> browser -> validator -> judge until sufficient", async () => {
  const runtime = new BrowserOrchestrationRuntime({
    models: {
      planner: fakeModel(["Search SharePoint for linked budget"]),
      browser: fakeModel([]),
      validator: fakeModel([{ ok: true, gaps: [] }]),
      judge: fakeModel([
        { complete: false, gaps: ["Need Xero totals"] },
        { complete: true, gaps: [] },
      ]),
    },
    tools: fakeBrowserTools(),
    onEvent: vi.fn(),
  });

  const result = await runtime.run({
    goal: "Prepare financial evidence pack",
    supervisionMode: "watch",
    root: { kind: "outlook-thread", threadId: "t-1", threadSubject: "Month end", mailbox: "finance@client.com" },
  });

  expect(result.status).toBe("completed");
  expect(result.events.some((event) => event.kind === "judgment_returned")).toBe(true);
});

it("routes specialist generation only after judge completion", async () => {
  const specialist = vi.fn().mockResolvedValue({ output: "statement.md" });
  const runtime = new BrowserOrchestrationRuntime({ /* ... */ specialist });
  await runtime.run(/* ... */);
  expect(specialist).toHaveBeenCalledTimes(1);
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
  const plan = await planner.plan(currentState);
  await onEvent({ role: "planner", kind: "plan_updated", summary: plan.summary, payload: plan });

  const browserResult = await browser.execute(plan);
  await onEvent({ role: "browser", kind: "browser_action_completed", summary: browserResult.summary, payload: browserResult });

  currentState = knowledge.merge(currentState, browserResult);
  await saveWorkingSet(currentState);

  const validation = await validator.check(currentState);
  const judgment = await judge.check(currentState, goal);

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

- [ ] **Step 6: Commit**

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
case "session/create": { /* insert session row, return mapped session */ }
case "session/get": { /* read session row */ }
case "session/events": { /* read ordered events */ }
case "session/working-set": { /* read working set */ }
case "session/start": { /* call runAgent with session context */ }
```

For `session/start`, reuse the existing run lifecycle instead of inventing a second run table.

- [ ] **Step 5: Run the desktop tests**

Run: `pnpm --filter carbon-agent-desktop test -- ipc-handlers.test.ts`

Expected: session IPC tests pass alongside the existing routes.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/agent-runner.ts apps/desktop/src/ipc-handlers.ts apps/desktop/src/ipc-handlers.test.ts apps/desktop/src/session-events.ts
git commit -m "feat: wire desktop orchestration sessions"
```

### Task 5: Add the email-thread launcher and session timeline UI

**Files:**
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/renderer/types.d.ts`
- Modify: `apps/desktop/src/renderer/views/playground-view.ts`
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

- [ ] **Step 2: Convert the playground entry form**

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

- [ ] **Step 3: Add a session timeline panel**

Create `apps/desktop/src/renderer/views/session-view.ts` with a minimal event and working-set panel:

```ts
export function renderSessionView(container: HTMLElement): void {
  const timeline = document.createElement("div");
  const gaps = document.createElement("ul");
  const docs = document.createElement("div");

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

- [ ] **Step 4: Run the desktop build**

Run: `pnpm --filter carbon-agent-desktop build`

Expected: preload, renderer, and new session UI compile cleanly.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preload.ts apps/desktop/src/renderer/types.d.ts apps/desktop/src/renderer/views/playground-view.ts apps/desktop/src/renderer/views/session-view.ts
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

- [ ] **Step 5: Manual smoke check**

Run the desktop app and verify this flow:

1. Create/select a workspace
2. Select providers for assistant plus new orchestration roles
3. Enter an Outlook thread root and goal in Playground
4. Start a session in `Watch Mode`
5. Confirm the session timeline updates
6. Confirm working-set documents/gaps update
7. Confirm final output passes back through the conversation

- [ ] **Step 6: Final commit**

```bash
git status --short
git add .
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
- Placeholder scan:
  - no `TBD`, `TODO`, or “similar to Task N” placeholders remain
- Type consistency:
  - `session/create`, `session/start`, `session/events`, and `session/working-set` names match across schema, IPC, and renderer tasks
  - `watch` / `confirm` supervision modes are used consistently

