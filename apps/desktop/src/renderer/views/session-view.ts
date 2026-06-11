import { appState, createEmptyState, escapeHtml, Toast } from "../view-helpers.js";

type OrchestrationSession = {
  id: string;
  workspaceId: string;
  conversationId: string;
  runId: string;
  root: { kind: string; threadId: string; threadSubject: string; mailbox: string };
  supervisionMode: string;
  status: string;
  currentGoal: string;
  completionSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

type SessionEvent = {
  id: string;
  sessionId: string;
  role: string;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type WorkingSetDocument = {
  id: string;
  source: string;
  title: string;
  mimeType: string | null;
  filePath: string | null;
  sourceUrl: string | null;
  confidence: number;
  provenance: string[];
};

type SessionWorkingSet = {
  sessionId: string;
  entities: Array<Record<string, unknown>>;
  documents: WorkingSetDocument[];
  metrics: Array<Record<string, unknown>>;
  gaps: string[];
  provenanceScore: number;
  updatedAt: string;
};

type ErrorResponse = { type: "error"; error: string; code?: string };
type SessionGetResponse = { type: "session/get.success"; data: OrchestrationSession } | ErrorResponse;
type SessionEventsResponse = { type: "session/events.success"; events: SessionEvent[] } | ErrorResponse;
type SessionWorkingSetResponse = { type: "session/working-set.success"; data: SessionWorkingSet } | ErrorResponse;

type PipelineStage = "planner" | "harness" | "validate" | "judge" | "specialist";

const STAGE_ORDER: PipelineStage[] = ["planner", "harness", "validate", "judge", "specialist"];
const STAGE_LABELS: Record<PipelineStage, string> = {
  planner: "Planner",
  harness: "Harness",
  validate: "Validate",
  judge: "Judge",
  specialist: "Specialist",
};

type SessionViewState = {
  session: OrchestrationSession | null;
  events: SessionEvent[];
  workingSet: SessionWorkingSet | null;
  cleanup: Array<() => void>;
  renderToken: number;
};

const state: SessionViewState = {
  session: null,
  events: [],
  workingSet: null,
  cleanup: [],
  renderToken: 0,
};

function deriveDriftState(events: SessionEvent[]): { detected: boolean; gaps: string[] } {
  const driftEvents = events.filter((e) => e.kind === "drift_detected");
  const gaps: string[] = [];
  for (const e of driftEvents) {
    const dg = e.payload?.driftGaps;
    if (Array.isArray(dg)) {
      for (const g of dg as unknown[]) if (typeof g === "string") gaps.push(g);
    }
  }
  return { detected: driftEvents.length > 0, gaps };
}

export function cleanupSessionView(): void {
  for (const dispose of state.cleanup.splice(0)) {
    try { dispose(); } catch { /* noop */ }
  }
  state.renderToken += 1;
}

export function renderSessionView(container: HTMLElement): void {
  cleanupSessionView();
  container.innerHTML = "";

  const sessionId = appState.currentSessionId;
  if (!sessionId) {
    container.appendChild(createEmptyState("icon-session", "No active mission", "Launch an orchestration mission from Playground to monitor the live pipeline, evidence collection, and judgment."));
    return;
  }

  const renderToken = state.renderToken;
  state.session = null;
  state.events = [];
  state.workingSet = null;

  const shell = document.createElement("div");
  shell.className = "mc-shell";

  // ── Mission Header ──────────────────────────────────────────────────
  const missionHeader = document.createElement("div");
  missionHeader.className = "mc-header";
  missionHeader.innerHTML = `
    <div class="mc-header-main">
      <div class="mc-header-kicker">Mission Control</div>
      <div class="mc-header-goal" id="mc-goal">Loading mission...</div>
      <div class="mc-header-meta" id="mc-header-meta">
        <span class="mc-badge" id="mc-status">idle</span>
        <span class="mc-id" id="mc-session-id">${escapeHtml(sessionId)}</span>
        <span class="mc-elapsed" id="mc-elapsed">--:--</span>
      </div>
    </div>
    <div class="mc-provenance-wrap" id="mc-provenance-wrap">
      ${renderProvenanceRadialSVG(0)}
    </div>
  `;

  // ── Pipeline ────────────────────────────────────────────────────────
  const pipeline = document.createElement("div");
  pipeline.className = "mc-pipeline";
  pipeline.innerHTML = `<div class="mc-pipeline-track" id="mc-pipeline"></div>`;

  // ── Main Grid ───────────────────────────────────────────────────────
  const grid = document.createElement("div");
  grid.className = "mc-grid";

  // Left column: Active Harness + Timeline
  const leftCol = document.createElement("div");
  leftCol.className = "mc-col";

  const harnessPanel = document.createElement("section");
  harnessPanel.className = "mc-panel";
  harnessPanel.innerHTML = `
    <div class="mc-panel-header">
      <div>
        <div class="mc-panel-title">Active Harnesses</div>
        <div class="mc-panel-desc">Live agent execution status.</div>
      </div>
    </div>
    <div class="mc-harness-list" id="mc-harness-list"></div>
  `;

  const timelinePanel = document.createElement("section");
  timelinePanel.className = "mc-panel";
  timelinePanel.innerHTML = `
    <div class="mc-panel-header">
      <div>
        <div class="mc-panel-title">Event Timeline</div>
        <div class="mc-panel-desc">Real-time mission events.</div>
      </div>
    </div>
    <div class="mc-timeline" id="mc-timeline"></div>
  `;
  leftCol.append(harnessPanel, timelinePanel);

  // Right column: Evidence + Gaps
  const rightCol = document.createElement("div");
  rightCol.className = "mc-col";

  const evidencePanel = document.createElement("section");
  evidencePanel.className = "mc-panel";
  evidencePanel.innerHTML = `
    <div class="mc-panel-header">
      <div>
        <div class="mc-panel-title">Evidence Working Set</div>
        <div class="mc-panel-desc" id="mc-evidence-count">0 documents</div>
      </div>
    </div>
    <div class="mc-evidence-grid" id="mc-evidence-grid"></div>
  `;

  const consistencyPanel = document.createElement("section");
  consistencyPanel.className = "mc-panel";
  consistencyPanel.innerHTML = `
    <div class="mc-panel-header">
      <div>
        <div class="mc-panel-title">Consistency Check</div>
        <div class="mc-panel-desc" id="mc-consistency-desc">Cross-harness drift detection.</div>
      </div>
    </div>
    <div class="mc-consistency-list" id="mc-consistency-list"></div>
  `;

  const gapsPanel = document.createElement("section");
  gapsPanel.className = "mc-panel";
  gapsPanel.innerHTML = `
    <div class="mc-panel-header">
      <div>
        <div class="mc-panel-title">Gap Analysis</div>
        <div class="mc-panel-desc">Missing evidence and blockers.</div>
      </div>
    </div>
    <div class="mc-gaps-list" id="mc-gaps-list"></div>
  `;
  rightCol.append(evidencePanel, consistencyPanel, gapsPanel);

  grid.append(leftCol, rightCol);
  shell.append(missionHeader, pipeline, grid);
  container.appendChild(shell);

  // Cache element refs
  const mcGoal = missionHeader.querySelector("#mc-goal") as HTMLElement;
  const mcStatus = missionHeader.querySelector("#mc-status") as HTMLElement;
  const mcSessionId = missionHeader.querySelector("#mc-session-id") as HTMLElement;
  const mcElapsed = missionHeader.querySelector("#mc-elapsed") as HTMLElement;
  const mcProvenanceWrap = missionHeader.querySelector("#mc-provenance-wrap") as HTMLElement;
  const mcPipeline = pipeline.querySelector("#mc-pipeline") as HTMLElement;
  const mcHarnessList = harnessPanel.querySelector("#mc-harness-list") as HTMLElement;
  const mcTimeline = timelinePanel.querySelector("#mc-timeline") as HTMLElement;
  const mcEvidenceGrid = evidencePanel.querySelector("#mc-evidence-grid") as HTMLElement;
  const mcEvidenceCount = evidencePanel.querySelector("#mc-evidence-count") as HTMLElement;
  const mcConsistencyList = consistencyPanel.querySelector("#mc-consistency-list") as HTMLElement;
  const mcGapsList = gapsPanel.querySelector("#mc-gaps-list") as HTMLElement;

  const carbonAPI = window.carbonAPI as typeof window.carbonAPI & {
    onSessionUpdate?: (callback: (data: { sessionId: string; status: string; currentGoal: string }) => void) => (() => void);
    onSessionWorkingSet?: (callback: (data: { sessionId: string; documents: unknown[]; gaps: string[]; provenanceScore: number }) => void) => (() => void);
    onSessionEvent?: (callback: (data: { sessionId: string; event: SessionEvent }) => void) => (() => void);
  };

  // Elapsed timer
  let timerInterval: ReturnType<typeof setInterval>;
  function startElapsedTimer(createdAt: string) {
    if (timerInterval) clearInterval(timerInterval);
    const start = new Date(createdAt).getTime();
    function tick() {
      const elapsed = Math.max(0, Date.now() - start);
      const mins = Math.floor(elapsed / 60000);
      const secs = Math.floor((elapsed % 60000) / 1000);
      mcElapsed.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    tick();
    timerInterval = setInterval(tick, 1000);
    state.cleanup.push(() => clearInterval(timerInterval));
  }

  // Event subscriptions
  const updateUnsub = carbonAPI.onSessionUpdate?.((payload) => {
    if (payload.sessionId !== sessionId) return;
    if (state.session) {
      state.session = { ...state.session, status: payload.status, currentGoal: payload.currentGoal, updatedAt: new Date().toISOString() };
    }
    applyMissionStatus(mcStatus, payload.status);
    mcGoal.textContent = payload.currentGoal;
  });
  if (updateUnsub) state.cleanup.push(updateUnsub);

  const workingSetUnsub = carbonAPI.onSessionWorkingSet?.((payload) => {
    if (payload.sessionId !== sessionId) return;
    state.workingSet = {
      sessionId,
      entities: state.workingSet?.entities ?? [],
      documents: Array.isArray(payload.documents) ? (payload.documents as WorkingSetDocument[]) : [],
      metrics: state.workingSet?.metrics ?? [],
      gaps: Array.isArray(payload.gaps) ? payload.gaps : [],
      provenanceScore: typeof payload.provenanceScore === "number" ? payload.provenanceScore : 0,
      updatedAt: new Date().toISOString(),
    };
    mcProvenanceWrap.innerHTML = renderProvenanceRadialSVG(state.workingSet.provenanceScore);
    renderEvidence(mcEvidenceGrid, mcEvidenceCount);
    renderGaps(mcGapsList);
  });
  if (workingSetUnsub) state.cleanup.push(workingSetUnsub);

  const eventUnsub = carbonAPI.onSessionEvent?.((payload: { sessionId: string; event: SessionEvent }) => {
    if (payload.sessionId !== sessionId) return;
    const evt = payload.event;
    if (state.events.some((e) => e.id === evt.id)) return;
    state.events = [...state.events, evt];
    renderPipeline(mcPipeline);
    renderHarnesses(mcHarnessList);
    renderTimeline(mcTimeline);
    renderConsistency(mcConsistencyList);
  });
  if (eventUnsub) state.cleanup.push(eventUnsub);

  void hydrateSession();

  async function hydrateSession(): Promise<void> {
    const currentToken = renderToken;
    try {
      const [sessionResp, eventsResp, workingSetResp] = await Promise.all([
        window.carbonAPI.invoke({ type: "session/get", id: sessionId }) as Promise<SessionGetResponse>,
        window.carbonAPI.invoke({ type: "session/events", id: sessionId }) as Promise<SessionEventsResponse>,
        window.carbonAPI.invoke({ type: "session/working-set", id: sessionId }) as Promise<SessionWorkingSetResponse>,
      ]);
      if (currentToken !== state.renderToken) return;

      if (sessionResp.type === "session/get.success") {
        state.session = sessionResp.data;
      }
      if (eventsResp.type === "session/events.success") {
        state.events = eventsResp.events ?? [];
      }
      if (workingSetResp.type === "session/working-set.success") {
        state.workingSet = workingSetResp.data;
      }

      mcGoal.textContent = state.session?.currentGoal || "No goal set";
      mcSessionId.textContent = sessionId;
      applyMissionStatus(mcStatus, state.session?.status || "idle");
      if (state.session) startElapsedTimer(state.session.createdAt);
      mcProvenanceWrap.innerHTML = renderProvenanceRadialSVG(state.workingSet?.provenanceScore ?? 0);
      renderPipeline(mcPipeline);
      renderHarnesses(mcHarnessList);
      renderTimeline(mcTimeline);
      renderEvidence(mcEvidenceGrid, mcEvidenceCount);
      renderGaps(mcGapsList);
      renderConsistency(mcConsistencyList);
    } catch (error: unknown) {
      Toast.show(`Failed to load mission: ${error instanceof Error ? error.message : String(error)}`, "error");
      mcTimeline.replaceChildren(createEmptyState("icon-session", "Mission unavailable", "The session snapshot could not be loaded."));
    }
  }
}

// ── Pipeline ────────────────────────────────────────────────────────────

function derivePipelineState(events: SessionEvent[]): { active: PipelineStage | null; completed: Set<PipelineStage>; driftDetected: boolean } {
  const completed = new Set<PipelineStage>();
  let active: PipelineStage | null = null;
  const { detected: driftDetected } = deriveDriftState(events);

  for (const event of events) {
    const k = event.kind;
    if (k === "goal_defined") { active = "planner"; }
    if (k === "plan_updated") { completed.add("planner"); active = "harness"; }
    if (k === "harness_action_started" || k === "browser_action_started") { active = "harness"; }
    if (k === "harness_action_completed" || k === "browser_action_completed") { completed.add("harness"); active = "validate"; }
    if (k === "validation_passed" || k === "validation_failed") { completed.add("validate"); active = "judge"; }
    if (k === "judgment_requested") { active = "judge"; }
    if (k === "judgment_returned") { completed.add("judge"); active = "specialist"; }
    if (k === "specialist_spawned") { active = "specialist"; }
    if (k === "specialist_completed" || k === "output_rejected") { completed.add("specialist"); active = null; }
  }

  // If session is running but no events yet, planner is active
  if (events.length === 0) active = "planner";
  return { active, completed, driftDetected };
}

function renderPipeline(container: HTMLElement): void {
  const { active, completed, driftDetected } = derivePipelineState(state.events);
  container.innerHTML = "";

  for (let i = 0; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i];
    const isActive = active === stage;
    const isCompleted = completed.has(stage);
    const isFailed = state.session?.status === "failed" && isActive;
    const isDrift = stage === "judge" && driftDetected && isCompleted;

    const node = document.createElement("div");
    node.className = "mc-pipeline-stage";
    if (isActive) node.classList.add("active");
    if (isCompleted) node.classList.add("completed");
    if (isFailed) node.classList.add("failed");
    if (isDrift) node.classList.add("drift");

    const circle = document.createElement("div");
    circle.className = "mc-pipeline-circle";
    if (isActive && !isFailed) {
      circle.innerHTML = `<div class="mc-pulse-ring"></div>`;
    }
    node.appendChild(circle);

    const label = document.createElement("div");
    label.className = "mc-pipeline-label";
    label.textContent = STAGE_LABELS[stage];
    node.appendChild(label);

    container.appendChild(node);

    if (i < STAGE_ORDER.length - 1) {
      const connector = document.createElement("div");
      connector.className = "mc-pipeline-connector";
      if (isCompleted || (isActive && stage !== "specialist")) connector.classList.add("lit");
      container.appendChild(connector);
    }
  }
}

// ── Harnesses ─────────────────────────────────────────────────────────

function deriveHarnesses(events: SessionEvent[]): Array<{ id: string; name: string; status: string; output: string; since: string }> {
  const harnesses = new Map<string, { id: string; name: string; status: string; output: string; since: string }>();
  for (const event of events) {
    if (event.role === "harness" || event.role === "browser") {
      const id = event.payload?.harnessId as string || event.role;
      const name = event.payload?.plan && typeof event.payload.plan === "object" && "source" in event.payload.plan
        ? String((event.payload.plan as Record<string, unknown>).source)
        : event.role === "browser" ? "Browser" : "Harness";
      if (event.kind.endsWith("_started")) {
        harnesses.set(id, { id, name, status: "running", output: event.summary, since: event.createdAt });
      } else if (event.kind.endsWith("_completed")) {
        harnesses.set(id, { id, name, status: "completed", output: event.summary, since: event.createdAt });
      }
    }
  }
  return Array.from(harnesses.values());
}

function renderHarnesses(container: HTMLElement): void {
  container.innerHTML = "";
  const harnesses = deriveHarnesses(state.events);
  if (harnesses.length === 0) {
    container.appendChild(createEmptyState("icon-session", "No active harness", "Harnesses will appear once the mission starts collecting evidence."));
    return;
  }
  for (const h of harnesses) {
    const card = document.createElement("div");
    card.className = "mc-harness-card";
    if (h.status === "running") card.classList.add("running");
    if (h.status === "completed") card.classList.add("completed");

    const statusLine = h.status === "running"
      ? `<span class="mc-harness-status-text running">COLLECTING<span class="mc-blink">_</span></span>`
      : `<span class="mc-harness-status-text">${h.status.toUpperCase()}</span>`;

    card.innerHTML = `
      <div class="mc-harness-card-header">
        <span class="mc-harness-name">${escapeHtml(h.name)}</span>
        ${statusLine}
      </div>
      <div class="mc-harness-output">${escapeHtml(h.output)}</div>
    `;
    container.appendChild(card);
  }
}

// ── Timeline ──────────────────────────────────────────────────────────

function renderTimeline(container: HTMLElement): void {
  container.replaceChildren();
  if (state.events.length === 0) {
    container.appendChild(createEmptyState("icon-session", "No events", "Mission events will stream here in real time."));
    return;
  }
  const recent = state.events.slice(-30);
  for (const event of recent) {
    container.appendChild(createTimelineRow(event));
  }
}

function createTimelineRow(event: SessionEvent): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "mc-timeline-row";
  const roleColor = getRoleColor(event.role);
  row.innerHTML = `
    <div class="mc-timeline-dot" style="background:${roleColor};box-shadow:0 0 6px ${roleColor}40"></div>
    <div class="mc-timeline-body">
      <div class="mc-timeline-title">${escapeHtml(event.summary)}</div>
      <div class="mc-timeline-meta">${event.role} · ${event.kind}</div>
    </div>
  `;
  return row;
}

function getRoleColor(role: string): string {
  const map: Record<string, string> = {
    goals: "#f5c542",
    planner: "#68b5f8",
    harness: "#68b5f8",
    browser: "#68b5f8",
    knowledge: "#f4f4f2",
    validator: "#f5c542",
    judge: "#f06060",
    "main-assistant": "#6ee7a0",
  };
  return map[role] || "#7f7f7f";
}

// ── Evidence ──────────────────────────────────────────────────────────

function renderEvidence(grid: HTMLElement, countLabel: HTMLElement): void {
  grid.replaceChildren();
  const ws = state.workingSet;
  if (!ws || ws.documents.length === 0) {
    grid.appendChild(createEmptyState("icon-output", "No evidence", "Documents will appear here as the mission collects them."));
    countLabel.textContent = "0 documents";
    return;
  }
  countLabel.textContent = `${ws.documents.length} document${ws.documents.length === 1 ? "" : "s"}`;
  for (const doc of ws.documents) {
    grid.appendChild(renderEvidenceCard(doc));
  }
}

function renderEvidenceCard(doc: WorkingSetDocument): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "mc-evidence-card";
  const confidence = Math.round((doc.confidence ?? 0) * 100);
  const heatColor = confidence >= 80 ? "#6ee7a0" : confidence >= 50 ? "#f5c542" : "#f06060";
  const source = doc.source || "unknown";

  card.innerHTML = `
    <div class="mc-evidence-heat" style="background:${heatColor}"></div>
    <div class="mc-evidence-top">
      <div class="mc-evidence-title">${escapeHtml(doc.title || "Untitled")}</div>
      <span class="mc-evidence-confidence">${confidence}%</span>
    </div>
    <div class="mc-evidence-bar" style="background:linear-gradient(90deg, ${heatColor} ${confidence}%, var(--border-color) ${confidence}%)"></div>
    <div class="mc-evidence-meta">
      <span class="mc-evidence-source">${escapeHtml(source)}</span>
      ${doc.mimeType ? `<span class="mc-evidence-mime">${escapeHtml(doc.mimeType)}</span>` : ""}
    </div>
    ${doc.filePath ? `<div class="mc-evidence-path">${escapeHtml(doc.filePath)}</div>` : ""}
    ${doc.sourceUrl ? `<div class="mc-evidence-path">${escapeHtml(doc.sourceUrl)}</div>` : ""}
  `;

  // Hover actions
  const actions = document.createElement("div");
  actions.className = "mc-evidence-actions";
  actions.innerHTML = `
    <button class="mc-evidence-btn">View</button>
    ${doc.filePath ? `<button class="mc-evidence-btn">Download</button>` : ""}
  `;
  card.appendChild(actions);

  return card;
}

// ── Gaps ──────────────────────────────────────────────────────────────

function renderGaps(container: HTMLElement): void {
  container.replaceChildren();
  const ws = state.workingSet;
  if (!ws || ws.gaps.length === 0) {
    container.appendChild(createEmptyState("icon-empty", "No gaps", "Outstanding evidence gaps will surface here."));
    return;
  }
  for (const gap of ws.gaps) {
    container.appendChild(renderGapItem(gap));
  }
}

function renderGapItem(gap: string): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "mc-gap-item";
  const severity = gap.toLowerCase().includes("error") || gap.toLowerCase().includes("fail") ? "critical"
    : gap.toLowerCase().includes("missing") ? "warning" : "info";
  item.dataset.severity = severity;
  item.innerHTML = `
    <span class="mc-gap-severity ${severity}"></span>
    <span class="mc-gap-text">${escapeHtml(gap)}</span>
  `;
  return item;
}

// ── Consistency (Drift) ────────────────────────────────────────────────

function renderConsistency(container: HTMLElement): void {
  container.replaceChildren();
  const { detected, gaps } = deriveDriftState(state.events);
  if (!detected) {
    container.appendChild(createEmptyState("icon-empty", "All consistent", "No cross-harness drift detected."));
    return;
  }
  for (const gap of gaps) {
    container.appendChild(renderDriftItem(gap));
  }
  if (gaps.length === 0) {
    container.appendChild(createEmptyState("icon-empty", "Drift suspected", "A consistency check flagged potential divergence, but no specific details were provided."));
  }
}

function renderDriftItem(gap: string): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "mc-drift-item";
  item.innerHTML = `
    <span class="mc-drift-severity"></span>
    <span class="mc-drift-text">${escapeHtml(gap)}</span>
  `;
  return item;
}

// ── Helpers ───────────────────────────────────────────────────────────

function applyMissionStatus(target: HTMLElement, status: string): void {
  target.className = "mc-badge";
  target.textContent = status;
  if (status === "running") target.classList.add("running");
  if (status === "completed") target.classList.add("completed");
  if (status === "failed" || status === "cancelled") target.classList.add("failed");
}

function renderProvenanceRadialSVG(score: number): string {
  const R = 36;
  const circumference = 2 * Math.PI * R;
  const offset = circumference * (1 - Math.min(1, score));
  const color = score >= 0.8 ? "#6ee7a0" : score >= 0.5 ? "#f5c542" : "#f06060";
  return `
    <svg class="mc-provenance-radial" viewBox="0 0 100 100">
      <circle class="mc-provenance-track" cx="50" cy="50" r="${R}"/>
      <circle class="mc-provenance-fill" cx="50" cy="50" r="${R}"
        stroke="${color}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
      <text x="50" y="47" class="mc-provenance-value">${Math.round(score * 100)}</text>
      <text x="50" y="61" class="mc-provenance-label">PROV</text>
    </svg>
  `;
}
