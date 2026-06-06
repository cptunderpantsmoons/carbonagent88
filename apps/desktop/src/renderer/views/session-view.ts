import { appState, createButton, createEmptyState, escapeHtml, Toast } from "../view-helpers.js";

type OrchestrationSession = {
  id: string;
  workspaceId: string;
  conversationId: string;
  runId: string;
  root: {
    kind: string;
    threadId: string;
    threadSubject: string;
    mailbox: string;
  };
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

export function cleanupSessionView(): void {
  for (const dispose of state.cleanup.splice(0)) {
    try {
      dispose();
    } catch {
      // noop
    }
  }
  state.renderToken += 1;
}

export function renderSessionView(container: HTMLElement): void {
  cleanupSessionView();
  container.innerHTML = "";

  const sessionId = appState.currentSessionId;
  if (!sessionId) {
    container.appendChild(createEmptyState("icon-session", "No active session", "Launch a browser orchestration session from Playground to inspect its timeline, working set, and gaps."));
    return;
  }

  const renderToken = state.renderToken;
  state.session = null;
  state.events = [];
  state.workingSet = null;

  const shell = document.createElement("div");
  shell.className = "session-shell";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Session Inspector</div>
    <div class="view-hero-title">Track the live orchestration session.</div>
    <div class="view-hero-copy">The timeline, working set, and gap analysis update in real time as the session collects evidence and progresses toward its goal.</div>
  `;
  const heroMeta = document.createElement("div");
  heroMeta.className = "view-hero-meta";
  heroMeta.innerHTML = `<span>Timeline</span><span>Working set</span><span>Gaps</span><span>Provenance</span>`;
  hero.appendChild(heroMeta);

  const header = document.createElement("div");
  header.className = "session-summary";
  const headerTop = document.createElement("div");
  headerTop.className = "session-summary-top";
  const titleWrap = document.createElement("div");
  titleWrap.innerHTML = `
    <div class="session-summary-kicker">Session</div>
    <div class="session-summary-title">${escapeHtml(sessionId)}</div>
  `;
  const headerActions = document.createElement("div");
  headerActions.className = "session-summary-actions";
  const refreshBtn = createButton("Refresh", "secondary", "sm");
  const launchBtn = createButton("Open Playground", "ghost", "sm");
  headerActions.append(refreshBtn, launchBtn);
  headerTop.append(titleWrap, headerActions);
  header.appendChild(headerTop);

  const meta = document.createElement("div");
  meta.className = "session-meta";
  meta.innerHTML = `
    <div class="session-meta-item"><span class="session-meta-label">Status</span><span id="session-status-pill" class="badge badge-muted badge-dot">Loading</span></div>
    <div class="session-meta-item"><span class="session-meta-label">Goal</span><span id="session-goal-text" class="session-meta-value">Loading session...</span></div>
    <div class="session-meta-item"><span class="session-meta-label">Supervision</span><span id="session-supervision-text" class="session-meta-value">—</span></div>
    <div class="session-meta-item"><span class="session-meta-label">Root</span><span id="session-root-text" class="session-meta-value">—</span></div>
    <div class="session-meta-item"><span class="session-meta-label">Completion</span><span id="session-summary-text" class="session-meta-value">—</span></div>
  `;
  header.appendChild(meta);

  const grid = document.createElement("div");
  grid.className = "session-grid";

  const timelinePanel = document.createElement("section");
  timelinePanel.className = "session-panel";
  timelinePanel.innerHTML = `
    <div class="session-panel-header">
      <div>
        <div class="section-title">Timeline</div>
        <div class="section-desc">Structured session events and milestones.</div>
      </div>
    </div>
  `;
  const timeline = document.createElement("div");
  timeline.className = "session-timeline";
  timelinePanel.appendChild(timeline);

  const rightColumn = document.createElement("div");
  rightColumn.className = "session-column";

  const documentsPanel = document.createElement("section");
  documentsPanel.className = "session-panel";
  documentsPanel.innerHTML = `
    <div class="session-panel-header">
      <div>
        <div class="section-title">Working Set</div>
        <div class="section-desc">Documents collected while the session runs.</div>
      </div>
      <div class="session-score" id="session-provenance-score">0%</div>
    </div>
  `;
  const documents = document.createElement("div");
  documents.className = "session-documents";
  documentsPanel.appendChild(documents);

  const gapsPanel = document.createElement("section");
  gapsPanel.className = "session-panel";
  gapsPanel.innerHTML = `
    <div class="session-panel-header">
      <div>
        <div class="section-title">Gaps</div>
        <div class="section-desc">Signals the session still needs to resolve.</div>
      </div>
    </div>
  `;
  const gaps = document.createElement("div");
  gaps.className = "session-gaps";
  gapsPanel.appendChild(gaps);

  rightColumn.append(documentsPanel, gapsPanel);
  grid.append(timelinePanel, rightColumn);
  shell.append(hero, header, grid);
  container.appendChild(shell);

  const sessionStatusPill = meta.querySelector("#session-status-pill") as HTMLElement | null;
  const sessionGoalText = meta.querySelector("#session-goal-text") as HTMLElement | null;
  const sessionSupervisionText = meta.querySelector("#session-supervision-text") as HTMLElement | null;
  const sessionRootText = meta.querySelector("#session-root-text") as HTMLElement | null;
  const sessionSummaryText = meta.querySelector("#session-summary-text") as HTMLElement | null;
  const provenanceScore = documentsPanel.querySelector("#session-provenance-score") as HTMLElement | null;
  const carbonAPI = window.carbonAPI as typeof window.carbonAPI & {
    onSessionUpdate?: (callback: (data: { sessionId: string; status: string; currentGoal: string }) => void) => (() => void);
    onSessionWorkingSet?: (callback: (data: { sessionId: string; documents: unknown[]; gaps: string[]; provenanceScore: number }) => void) => (() => void);
    onSessionEvent?: (callback: (data: { sessionId: string; event: SessionEvent }) => void) => (() => void);
  };

  refreshBtn.addEventListener("click", () => void hydrateSession());
  launchBtn.addEventListener("click", () => window.__setActiveView__?.("playground"));

  const updateUnsub = carbonAPI.onSessionUpdate?.((payload: { sessionId: string; status: string; currentGoal: string }) => {
    if (payload.sessionId !== sessionId) return;
    if (state.session) {
      state.session = {
        ...state.session,
        status: payload.status,
        currentGoal: payload.currentGoal,
        updatedAt: new Date().toISOString(),
      };
    }
    if (sessionStatusPill) {
      applyStatus(sessionStatusPill, payload.status);
    }
    if (sessionGoalText) {
      sessionGoalText.textContent = payload.currentGoal;
    }
  });
  if (updateUnsub) state.cleanup.push(updateUnsub);

  const workingSetUnsub = carbonAPI.onSessionWorkingSet?.((payload: { sessionId: string; documents: unknown[]; gaps: string[]; provenanceScore: number }) => {
    if (payload.sessionId !== sessionId) return;
    state.workingSet = {
      sessionId,
      entities: state.workingSet?.entities ?? [],
      documents: Array.isArray(payload.documents) ? (payload.documents as WorkingSetDocument[]) : [],
      metrics: state.workingSet?.metrics ?? [],
      gaps: Array.isArray(payload.gaps) ? payload.gaps : [],
      provenanceScore: payload.provenanceScore,
      updatedAt: new Date().toISOString(),
    };
    renderWorkingSet(documents, gaps, provenanceScore);
  });
  if (workingSetUnsub) state.cleanup.push(workingSetUnsub);

  const eventUnsub = carbonAPI.onSessionEvent?.((payload: { sessionId: string; event: SessionEvent }) => {
    if (payload.sessionId !== sessionId) return;
    if (state.events.some((event) => event.id === payload.event.id)) return;
    state.events = [...state.events, payload.event];
    renderTimeline(timeline);
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
      } else {
        throw new Error(String(sessionResp.error ?? "Failed to load session"));
      }

      if (eventsResp.type === "session/events.success") {
        state.events = eventsResp.events ?? [];
      } else {
        state.events = [];
      }

      if (workingSetResp.type === "session/working-set.success") {
        state.workingSet = workingSetResp.data;
      } else {
        state.workingSet = null;
      }

      renderHeader(sessionStatusPill, sessionGoalText, sessionSupervisionText, sessionRootText, sessionSummaryText);
      renderTimeline(timeline);
      renderWorkingSet(documents, gaps, provenanceScore);
    } catch (error: unknown) {
      Toast.show(`Failed to load session: ${error instanceof Error ? error.message : String(error)}`, "error");
      timeline.replaceChildren(createEmptyState("icon-session", "Session unavailable", "The session snapshot could not be loaded."));
      documents.replaceChildren(createEmptyState("icon-output", "No working set", "The working set snapshot could not be loaded."));
      gaps.replaceChildren(createEmptyState("icon-empty", "No gaps", "The session gap list could not be loaded."));
    }
  }
}

function renderHeader(
  sessionStatusPill: HTMLElement | null,
  sessionGoalText: HTMLElement | null,
  sessionSupervisionText: HTMLElement | null,
  sessionRootText: HTMLElement | null,
  sessionSummaryText: HTMLElement | null,
): void {
  if (!state.session) return;
  if (sessionStatusPill) applyStatus(sessionStatusPill, state.session.status);
  if (sessionGoalText) sessionGoalText.textContent = state.session.currentGoal;
  if (sessionSupervisionText) sessionSupervisionText.textContent = state.session.supervisionMode;
  if (sessionRootText) {
    sessionRootText.textContent = `${state.session.root.threadSubject} · ${state.session.root.threadId} · ${state.session.root.mailbox}`;
  }
  if (sessionSummaryText) {
    sessionSummaryText.textContent = state.session.completionSummary || "Pending";
  }
}

function renderTimeline(container: HTMLElement): void {
  container.replaceChildren();
  if (state.events.length === 0) {
    container.appendChild(createEmptyState("icon-session", "No timeline events", "This session has not recorded any events yet."));
    return;
  }

  for (const event of state.events) {
    container.appendChild(createTimelineRow(event.kind, `${event.summary} · ${event.role}`));
  }
}

function renderWorkingSet(documentsContainer: HTMLElement, gapsContainer: HTMLElement, provenanceScore: HTMLElement | null): void {
  documentsContainer.replaceChildren();
  gapsContainer.replaceChildren();

  const workingSet = state.workingSet;
  if (provenanceScore) {
    provenanceScore.textContent = `${Math.round((workingSet?.provenanceScore ?? 0) * 100)}%`;
  }

  if (!workingSet) {
    documentsContainer.appendChild(createEmptyState("icon-output", "No working set", "The working set will appear here once the session discovers evidence."));
    gapsContainer.appendChild(createEmptyState("icon-empty", "No gaps", "Gap analysis is waiting for a working set."));
    return;
  }

  if (workingSet.documents.length === 0) {
    documentsContainer.appendChild(createEmptyState("icon-output", "No documents", "The session has not collected any documents yet."));
  } else {
    for (const document of workingSet.documents) {
      documentsContainer.appendChild(renderDocumentCard(document));
    }
  }

  if (workingSet.gaps.length === 0) {
    gapsContainer.appendChild(createEmptyState("icon-empty", "No gaps", "The session has not identified any missing evidence."));
    return;
  }

  for (const gap of workingSet.gaps) {
    gapsContainer.appendChild(renderGap(gap));
  }
}

function applyStatus(target: HTMLElement, status: string): void {
  target.className = "badge badge-muted badge-dot";
  if (status === "running") target.className = "badge badge-warning badge-dot";
  if (status === "completed") target.className = "badge badge-success badge-dot";
  if (status === "failed" || status === "cancelled") target.className = "badge badge-danger badge-dot";
  target.textContent = status;
}

function createTimelineRow(status: string, text: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "session-timeline-row";
  row.appendChild(statusDot(status));

  const body = document.createElement("div");
  body.className = "session-timeline-body";

  const title = document.createElement("div");
  title.className = "session-timeline-title";
  title.textContent = text;

  const meta = document.createElement("div");
  meta.className = "session-timeline-meta";
  meta.textContent = status;

  body.append(title, meta);
  row.appendChild(body);
  return row;
}

function renderGap(gap: string): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "session-gap-item";
  item.textContent = gap;
  return item;
}

function renderDocumentCard(rawDocument: WorkingSetDocument): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "session-document-card";
  const confidence = Math.round((rawDocument.confidence ?? 0) * 100);
  const confidenceState = confidence >= 80 ? "success" : confidence >= 50 ? "warning" : "danger";
  card.innerHTML = `
    <div class="session-document-card-top">
      <div class="session-document-title">${escapeHtml(rawDocument.title || "Untitled")}</div>
      <span class="badge badge-${confidenceState}">${confidence}%</span>
    </div>
    <div class="session-document-source">${escapeHtml(rawDocument.source)}</div>
    ${rawDocument.mimeType ? `<div class="session-document-meta">${escapeHtml(rawDocument.mimeType)}</div>` : ""}
    ${rawDocument.filePath ? `<div class="session-document-path">${escapeHtml(rawDocument.filePath)}</div>` : ""}
    ${rawDocument.sourceUrl ? `<div class="session-document-path">${escapeHtml(rawDocument.sourceUrl)}</div>` : ""}
  `;

  if (rawDocument.provenance.length > 0) {
    const provenance = document.createElement("div");
    provenance.className = "session-document-provenance";
    for (const entry of rawDocument.provenance) {
      const chip = document.createElement("span");
      chip.className = "session-provenance-chip";
      chip.textContent = entry;
      provenance.appendChild(chip);
    }
    card.appendChild(provenance);
  }

  return card;
}

function statusDot(status: string): HTMLSpanElement {
  const dot = document.createElement("span");
  dot.className = "status-dot session-status-dot";
  if (status === "completed") {
    dot.classList.add("status-dot-success");
  } else if (status === "failed" || status === "cancelled") {
    dot.classList.add("status-dot-danger");
  } else if (status === "running") {
    dot.classList.add("status-dot-warning");
  } else {
    dot.classList.add("status-dot-muted");
  }
  return dot;
}
