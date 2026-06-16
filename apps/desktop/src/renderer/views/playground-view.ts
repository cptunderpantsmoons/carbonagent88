import {
  Toast,
  addSystemMessage,
  appState,
  createButton,
  createChatMessage,
  createInput,
  loadProviders,
  loadWorkspaces,
  populateSelect,
  setProviderLabel,
  setWorkspaceLabel,
} from "../view-helpers.js";
import { icon } from "../icons.js";

const HARNESS_DEFS = [
  { id: "browser", label: "Browser", iconName: "browser" },
  { id: "claude-code", label: "Claude Code", iconName: "claude-code" },
  { id: "codex", label: "Codex", iconName: "codex" },
  { id: "local", label: "Local Agent", iconName: "local" },
];

type HarnessConfigFromIPC = {
  id: string;
  workspaceId: string;
  harnessId: string;
  enabled: boolean;
  taskTemplate: string | null;
  qualityGates: string[];
  extraJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function getEnabledHarnesses(configs: HarnessConfigFromIPC[]): string[] {
  return configs.filter((c) => c.enabled).map((c) => c.harnessId);
}

async function loadHarnessConfigs(workspaceId: string): Promise<HarnessConfigFromIPC[]> {
  const resp = await window.carbonAPI.invoke({ type: "harness-configs/list", workspaceId });
  if (resp && resp.type === "harness-configs/list.success") {
    return (resp.data as unknown as HarnessConfigFromIPC[]) ?? [];
  }
  return [];
}

function getMissionSuggestions(enabled: string[]): string[] {
  const s: string[] = [];
  if (enabled.includes("browser")) {
    s.push("Collect evidence from authenticated systems");
  }
  if (enabled.includes("claude-code")) {
    s.push("Refactor the codebase based on this thread");
  }
  if (enabled.includes("codex")) {
    s.push("Generate a new module from requirements");
  }
  if (enabled.includes("browser") && (enabled.includes("claude-code") || enabled.includes("codex"))) {
    s.push("Collect evidence and generate a financial report");
  }
  if (s.length === 0) s.push("Run a general research task");
  return s;
}

export function renderPlayground(container: HTMLElement): void {
  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "view-stack playground-shell";

  // ── Launcher ────────────────────────────────────────────────────────
  const launcher = document.createElement("section");
  launcher.className = "view-panel mission-launcher";

  const launchHeader = document.createElement("div");
  launchHeader.className = "mission-launcher-header";
  launchHeader.innerHTML = `
    <div class="mission-launcher-kicker">Mission Control</div>
    <div class="mission-launcher-title">Launch an orchestration mission</div>
  `;

  // Top controls: workspace, provider, supervision
  const controls = document.createElement("div");
  controls.className = "mission-controls";

  const wsSelect = document.createElement("select");
  wsSelect.className = "form-select mission-control";
  wsSelect.id = "workspace-selector";
  wsSelect.innerHTML = '<option value="">Workspace...</option>';

  const provSelect = document.createElement("select");
  provSelect.className = "form-select mission-control";
  provSelect.innerHTML = '<option value="">Provider...</option>';

  const supervisionSelect = document.createElement("select");
  supervisionSelect.className = "form-select mission-control";
  supervisionSelect.innerHTML = `
    <option value="watch">Watch mode</option>
    <option value="confirm">Confirm mode</option>
  `;

  const resetBtn = createButton("New", "secondary", "sm");
  controls.append(wsSelect, provSelect, supervisionSelect, resetBtn);

  // Goal input
  const goalWrap = document.createElement("div");
  goalWrap.className = "mission-input-wrap";

  const goalLabel = document.createElement("label");
  goalLabel.className = "mission-input-label";
  goalLabel.textContent = "Mission Objective";

  const goalInput = document.createElement("textarea");
  goalInput.className = "form-input mission-input";
  goalInput.rows = 3;
  goalInput.placeholder = "Describe what the mission should accomplish in natural language...";

  goalWrap.append(goalLabel, goalInput);

  // Harness chips
  const harnessWrap = document.createElement("div");
  harnessWrap.className = "mission-harness-wrap";

  const harnessLabel = document.createElement("div");
  harnessLabel.className = "mission-harness-label";
  harnessLabel.textContent = "Active Harnesses";

  const harnessRow = document.createElement("div");
  harnessRow.className = "mission-harness-row";
  let harnessConfigs: HarnessConfigFromIPC[] = [];
  let harnessConfigMap = new Map<string, HarnessConfigFromIPC>();

  function renderHarnessChips() {
    harnessRow.innerHTML = "";
    const enabledIds = getEnabledHarnesses(harnessConfigs);
    for (const def of HARNESS_DEFS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "harness-chip";
      if (enabledIds.includes(def.id)) chip.classList.add("active");
      chip.innerHTML = `${icon(def.iconName, "harness-chip-icon")}<span>${def.label}</span>`;
      chip.addEventListener("click", async () => {
        const config = harnessConfigMap.get(def.id);
        if (!config) {
          Toast.show("Select a workspace first", "warning");
          return;
        }
        const newEnabled = !config.enabled;
        try {
          await window.carbonAPI.invoke({
            type: "harness-configs/update",
            id: config.id,
            workspaceId: config.workspaceId,
            harnessId: config.harnessId,
            data: { enabled: newEnabled },
          });
          const reloaded = await loadHarnessConfigs(config.workspaceId);
          harnessConfigs = reloaded;
          harnessConfigMap = new Map(reloaded.map((c) => [c.harnessId, c]));
          renderHarnessChips();
          refreshSuggestions();
        } catch {
          Toast.show(`Failed to update ${def.label} harness`, "error");
        }
      });
      harnessRow.appendChild(chip);
    }
  }
  renderHarnessChips();

  harnessWrap.append(harnessLabel, harnessRow);

  // Suggestion chips
  const suggestionWrap = document.createElement("div");
  suggestionWrap.className = "mission-suggestion-wrap";

  const suggestionRow = document.createElement("div");
  suggestionRow.className = "mission-suggestion-row";

  function refreshSuggestions() {
    suggestionRow.innerHTML = "";
    const suggestions = getMissionSuggestions(getEnabledHarnesses(harnessConfigs));
    for (const text of suggestions) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "mission-suggestion-chip";
      chip.textContent = text;
      chip.addEventListener("click", () => {
        goalInput.value = text;
        goalInput.focus();
      });
      suggestionRow.appendChild(chip);
    }
  }
  refreshSuggestions();

  suggestionWrap.appendChild(suggestionRow);

  // Thread details (collapsible)
  const detailsToggle = document.createElement("button");
  detailsToggle.type = "button";
  detailsToggle.className = "mission-details-toggle";
  detailsToggle.textContent = "Thread Details";

  const detailsPanel = document.createElement("div");
  detailsPanel.className = "mission-details-panel";
  detailsPanel.style.display = "none";

  const threadSubjectInput = createInput("e.g., Month end close");
  const threadIdInput = createInput("e.g., AAMkAGI2-thread");
  const mailboxInput = createInput("e.g., finance@example.com");

  detailsPanel.append(
    buildField("Thread subject", threadSubjectInput, "The Outlook thread subject."),
    buildField("Thread ID / fragment", threadIdInput, "The thread identifier or URL fragment."),
    buildField("Mailbox", mailboxInput, "The source mailbox to inspect."),
  );

  detailsToggle.addEventListener("click", () => {
    const showing = detailsPanel.style.display !== "none";
    detailsPanel.style.display = showing ? "none" : "grid";
    detailsToggle.classList.toggle("open", !showing);
  });

  // Launch button
  const launchBtn = document.createElement("button");
  launchBtn.className = "btn btn-primary mission-launch-btn";
  launchBtn.textContent = "LAUNCH MISSION";

  launcher.append(
    launchHeader,
    controls,
    goalWrap,
    harnessWrap,
    suggestionWrap,
    detailsToggle,
    detailsPanel,
    launchBtn,
  );
  shell.appendChild(launcher);

  // ── Transcript ──────────────────────────────────────────────────────
  const transcriptCard = document.createElement("section");
  transcriptCard.className = "view-panel";
  const transcriptHeader = document.createElement("div");
  transcriptHeader.className = "view-panel-header";
  transcriptHeader.innerHTML = `
    <div>
      <div class="view-panel-title">Transcript</div>
      <div class="view-panel-copy">Mission progress and agent responses.</div>
    </div>
  `;
  const chatContainer = document.createElement("div");
  chatContainer.className = "chat-container playground-chat";
  const messages = document.createElement("div");
  messages.className = "chat-messages";

  const inputBar = document.createElement("div");
  inputBar.className = "chat-input-bar";
  const chatSendBtn = createButton("Send", "primary");
  inputBar.appendChild(chatSendBtn);
  chatContainer.append(messages, inputBar);
  transcriptCard.append(transcriptHeader, chatContainer);
  shell.appendChild(transcriptCard);
  container.appendChild(shell);

  // Event wiring
  wsSelect.addEventListener("change", async () => {
    appState.currentWorkspaceId = wsSelect.value || null;
    appState.currentConversationId = null;
    appState.currentRunId = null;
    appState.currentSessionId = null;
    const selected = wsSelect.selectedOptions[0];
    setWorkspaceLabel(selected?.value ? (selected.textContent || "Workspace") : "No Workspace");
    addSystemMessage(messages, `Workspace set to ${selected?.textContent || "No Workspace"}.`);

    if (appState.currentWorkspaceId) {
      try {
        const configs = await loadHarnessConfigs(appState.currentWorkspaceId);
        harnessConfigs = configs;
        harnessConfigMap = new Map(configs.map((c) => [c.harnessId, c]));
        renderHarnessChips();
        refreshSuggestions();
      } catch { /* ignore */ }
    } else {
      harnessConfigs = [];
      harnessConfigMap = new Map();
      renderHarnessChips();
      refreshSuggestions();
    }
  });

  provSelect.addEventListener("change", () => {
    appState.currentConversationId = null;
    appState.currentRunId = null;
    appState.currentSessionId = null;
    messages.innerHTML = "";
    const selected = provSelect.selectedOptions[0];
    setProviderLabel(selected?.value ? (selected.textContent || "Provider") : "No Provider");
    addSystemMessage(messages, "Provider changed — new conversation started.");
  });

  resetBtn.addEventListener("click", () => {
    appState.currentConversationId = null;
    appState.currentRunId = null;
    appState.currentSessionId = null;
    messages.innerHTML = "";
    goalInput.value = "";
    threadSubjectInput.value = "";
    threadIdInput.value = "";
    mailboxInput.value = "";
    addSystemMessage(messages, "New mission draft started.");
  });

  launchBtn.addEventListener("click", () => void launchMission());
  goalInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void launchMission();
    }
  });

  chatSendBtn.addEventListener("click", () => {
    const msg = (chatSendBtn.previousElementSibling as HTMLInputElement | null)?.value?.trim();
    if (msg) {
      messages.appendChild(createChatMessage("user", msg));
    }
  });

  void loadWorkspaces().then((workspaces) => {
    populateSelect(wsSelect, workspaces, (workspace) => workspace.name, "Workspace...");
    if (appState.currentWorkspaceId) wsSelect.value = appState.currentWorkspaceId;
  });
  void loadProviders().then((providers) => {
    populateSelect(provSelect, providers, (provider) => `${provider.name} (${provider.type})`, "Provider...");
    if (!provSelect.value && providers.length > 0) {
      provSelect.value = providers[0].id;
      setProviderLabel(providers[0].name);
    }
  });

  addSystemMessage(messages, "Select a workspace and provider, define the mission objective, then launch.");

  async function launchMission(): Promise<void> {
    const goal = goalInput.value.trim();
    const threadSubject = threadSubjectInput.value.trim();
    const threadId = threadIdInput.value.trim();
    const mailbox = mailboxInput.value.trim();

    if (!goal) { Toast.show("Please enter a mission objective", "warning"); return; }
    if (!wsSelect.value) { Toast.show("Please select a workspace", "warning"); return; }
    if (!provSelect.value) { Toast.show("Please select a provider", "warning"); return; }
    if (!threadSubject || !threadId || !mailbox) {
      Toast.show("Please complete the thread details", "warning");
      detailsPanel.style.display = "grid";
      detailsToggle.classList.add("open");
      return;
    }

    appState.currentWorkspaceId = wsSelect.value;
    messages.appendChild(createChatMessage("user", goal));
    goalInput.disabled = true;
    threadSubjectInput.disabled = true;
    threadIdInput.disabled = true;
    mailboxInput.disabled = true;
    supervisionSelect.disabled = true;
    launchBtn.disabled = true;
    launchBtn.textContent = "LAUNCHING...";

    const runStatusText = document.getElementById("run-status-text");
    if (runStatusText) runStatusText.textContent = "Launching mission";

    try {
      if (!appState.currentConversationId) {
        const convResp = await window.carbonAPI.invoke({ type: "conversation/create", workspaceId: appState.currentWorkspaceId });
        if (convResp.type === "conversation/create.success") {
          appState.currentConversationId = (convResp.data as Record<string, unknown>).id as string;
        } else {
          throw new Error(convResp.error || "Failed to create conversation");
        }
      }

      const runResp = await window.carbonAPI.invoke({
        type: "run/create",
        conversationId: appState.currentConversationId as string,
        providerId: provSelect.value || null,
      });
      if (runResp.type !== "run/create.success") throw new Error(String(runResp.error ?? "Failed to create run"));

      const sessionResp = await window.carbonAPI.invoke({
        type: "session/create",
        workspaceId: appState.currentWorkspaceId,
        conversationId: appState.currentConversationId,
        runId: (runResp.data as Record<string, unknown>).id as string,
        root: { kind: "outlook-thread", threadId, threadSubject, mailbox },
        supervisionMode: supervisionSelect.value || "watch",
        goal,
      });
      if (sessionResp.type !== "session/create.success") {
        throw new Error(String(sessionResp.error ?? "Failed to create session"));
      }

      appState.currentRunId = (sessionResp.data as Record<string, unknown>).runId as string;
      appState.currentSessionId = (sessionResp.data as Record<string, unknown>).id as string;

      const sessionMessage = createChatMessage("system", `Mission ${(sessionResp.data as Record<string, unknown>).id as string} created for ${threadSubject}.`);
      const viewSessionBtn = document.createElement("button");
      viewSessionBtn.className = "btn btn-ghost btn-sm mt-6";
      viewSessionBtn.textContent = "View Mission";
      viewSessionBtn.addEventListener("click", () => window.__setActiveView__?.("sessions"));
      sessionMessage.appendChild(viewSessionBtn);
      messages.appendChild(sessionMessage);

      const startResp = await window.carbonAPI.invoke({ type: "session/start", id: (sessionResp.data as Record<string, unknown>).id as string });
      if (startResp.type === "session/start.success") {
        if ((startResp.data as Record<string, unknown>).fullResponse as string) {
          messages.appendChild(createChatMessage("assistant", (startResp.data as Record<string, unknown>).fullResponse as string));
        }
        if ((startResp.data as Record<string, unknown>).runStatus as string !== "completed") {
          addSystemMessage(messages, (startResp.data as Record<string, unknown>).runError as string | undefined || `Mission ${(startResp.data as Record<string, unknown>).runStatus as string}.`);
        } else {
          addSystemMessage(messages, "Mission completed.");
        }
        if (runStatusText) runStatusText.textContent = `Mission ${(startResp.data as Record<string, unknown>).runStatus as string}`;
      } else {
        throw new Error(String(startResp.error ?? "Failed to start session"));
      }
    } catch (error: unknown) {
      messages.appendChild(createChatMessage("system", `Error: ${error instanceof Error ? error.message : String(error)}`));
      if (runStatusText) runStatusText.textContent = "Mission error";
    } finally {
      goalInput.disabled = false;
      threadSubjectInput.disabled = false;
      threadIdInput.disabled = false;
      mailboxInput.disabled = false;
      supervisionSelect.disabled = false;
      launchBtn.disabled = false;
      launchBtn.textContent = "LAUNCH MISSION";
      if (runStatusText && runStatusText.textContent === "Launching mission") runStatusText.textContent = "Idle";
      goalInput.focus();
    }
  }
}

function buildField(label: string, control: HTMLElement, hint: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "session-field";
  const labelEl = document.createElement("label");
  labelEl.className = "form-label";
  labelEl.textContent = label;
  wrapper.append(labelEl, control);
  const hintEl = document.createElement("div");
  hintEl.className = "form-hint";
  hintEl.textContent = hint;
  wrapper.appendChild(hintEl);
  return wrapper;
}
