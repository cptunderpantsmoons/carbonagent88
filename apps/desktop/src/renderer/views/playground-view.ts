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

export function renderPlayground(container: HTMLElement): void {
  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "view-stack playground-shell";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Playground</div>
    <div class="view-hero-title">Launch a session with a clean, controlled setup.</div>
    <div class="view-hero-copy">Pick a workspace, choose a provider, and define the thread details before the session starts. The layout keeps the launch controls separate from the transcript so the flow stays readable.</div>
  `;
  const heroMeta = document.createElement("div");
  heroMeta.className = "view-hero-meta";
  heroMeta.innerHTML = `<span>Workspace</span><span>Provider</span><span>Supervision</span><span>Transcript</span>`;
  hero.appendChild(heroMeta);
  shell.appendChild(hero);

  const launchCard = document.createElement("section");
  launchCard.className = "view-panel";

  const header = document.createElement("div");
  header.className = "view-toolbar";

  const sessionInfo = document.createElement("div");
  sessionInfo.className = "view-toolbar-group";

  const wsSelect = document.createElement("select");
  wsSelect.className = "form-select session-select";
  wsSelect.id = "workspace-selector";
  wsSelect.innerHTML = '<option value="">Select Workspace...</option>';

  const provSelect = document.createElement("select");
  provSelect.className = "form-select session-select";
  provSelect.innerHTML = '<option value="">Select AI Provider...</option>';

  const supervisionSelect = document.createElement("select");
  supervisionSelect.className = "form-select session-select";
  supervisionSelect.innerHTML = `
    <option value="watch">Watch - observe and collect evidence</option>
    <option value="confirm">Confirm - require review before action</option>
  `;

  const resetBtn = createButton("New Session", "secondary", "sm");
  sessionInfo.append(wsSelect, provSelect, supervisionSelect, resetBtn);
  header.appendChild(sessionInfo);
  launchCard.appendChild(header);

  const launchGrid = document.createElement("div");
  launchGrid.className = "session-launch-grid";

  const goalInput = document.createElement("textarea");
  goalInput.className = "form-input session-goal";
  goalInput.rows = 4;
  goalInput.placeholder = "Describe the orchestration goal...";

  const threadSubjectInput = createInput("e.g., Month end close");
  const threadIdInput = createInput("e.g., AAMkAGI2-thread");
  const mailboxInput = createInput("e.g., finance@example.com");

  launchGrid.append(
    buildField("Goal", goalInput, "What should the session accomplish?"),
    buildField("Thread subject", threadSubjectInput, "The Outlook thread subject."),
    buildField("Thread ID / fragment", threadIdInput, "The thread identifier or URL fragment."),
    buildField("Mailbox", mailboxInput, "The source mailbox to inspect."),
  );
  const chips = document.createElement("div");
  chips.className = "task-chips";
  const suggestions = ["Collect reporting inputs", "Trace the latest invoice thread", "Validate supporting evidence"];
  launchCard.append(launchGrid, chips);
  shell.appendChild(launchCard);

  const transcriptCard = document.createElement("section");
  transcriptCard.className = "view-panel";
  const transcriptHeader = document.createElement("div");
  transcriptHeader.className = "view-panel-header";
  transcriptHeader.innerHTML = `
    <div>
      <div class="view-panel-title">Transcript</div>
      <div class="view-panel-copy">Session progress and responses appear here after launch.</div>
    </div>
  `;
  const chatContainer = document.createElement("div");
  chatContainer.className = "chat-container playground-chat";
  const messages = document.createElement("div");
  messages.className = "chat-messages";

  const inputBar = document.createElement("div");
  inputBar.className = "chat-input-bar";
  const startBtn = createButton("Start Session", "primary");
  inputBar.append(startBtn);
  chatContainer.append(messages, inputBar);
  transcriptCard.append(transcriptHeader, chatContainer);
  shell.appendChild(transcriptCard);
  container.appendChild(shell);

  for (const suggestion of suggestions) {
    const chip = document.createElement("button");
    chip.className = "task-chip";
    chip.textContent = suggestion;
    chip.addEventListener("click", () => {
      goalInput.value = suggestion;
      goalInput.focus();
    });
    chips.appendChild(chip);
  }

  wsSelect.addEventListener("change", () => {
    appState.currentWorkspaceId = wsSelect.value || null;
    appState.currentConversationId = null;
    appState.currentRunId = null;
    appState.currentSessionId = null;
    const selected = wsSelect.selectedOptions[0];
    setWorkspaceLabel(selected?.value ? (selected.textContent || "Workspace") : "No Workspace");
    addSystemMessage(messages, `Workspace set to ${selected?.textContent || "No Workspace"}.`);
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
    addSystemMessage(messages, "New session draft started.");
  });

  startBtn.addEventListener("click", () => void send());
  goalInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        void send();
      }
    }
  });

  void loadWorkspaces().then((workspaces) => {
    populateSelect(wsSelect, workspaces, (workspace) => workspace.name, "Select Workspace...");
    if (appState.currentWorkspaceId) {
      wsSelect.value = appState.currentWorkspaceId;
    }
  });
  void loadProviders().then((providers) => {
    populateSelect(provSelect, providers, (provider) => `${provider.name} (${provider.type})`, "Select AI Provider...");
    if (!provSelect.value && providers.length > 0) {
      provSelect.value = providers[0].id;
      const selected = provSelect.selectedOptions[0];
      setProviderLabel(selected?.textContent || "Provider");
    }
  });

  addSystemMessage(messages, "Select a workspace and provider, then define the thread goal and launch the session.");

  async function send(): Promise<void> {
    const goal = goalInput.value.trim();
    const threadSubject = threadSubjectInput.value.trim();
    const threadId = threadIdInput.value.trim();
    const mailbox = mailboxInput.value.trim();
    if (!goal) {
      Toast.show("Please enter a session goal", "warning");
      return;
    }
    if (!wsSelect.value) {
      Toast.show("Please select a workspace first", "warning");
      return;
    }
    if (!provSelect.value) {
      Toast.show("Please select an AI provider first", "warning");
      return;
    }
    if (!threadSubject || !threadId || !mailbox) {
      Toast.show("Please complete the thread details", "warning");
      return;
    }

    appState.currentWorkspaceId = wsSelect.value;
    messages.appendChild(createChatMessage("user", goal));
    goalInput.disabled = true;
    threadSubjectInput.disabled = true;
    threadIdInput.disabled = true;
    mailboxInput.disabled = true;
    supervisionSelect.disabled = true;
    startBtn.disabled = true;
    startBtn.textContent = "Launching...";

    const runStatusText = document.getElementById("run-status-text");
    if (runStatusText) runStatusText.textContent = "Launching session";

    try {
      if (!appState.currentConversationId) {
        const convResp = await window.carbonAPI.invoke({ type: "conversation/create", workspaceId: appState.currentWorkspaceId } as any) as any;
        if (convResp.type === "conversation/create.success") {
          appState.currentConversationId = convResp.data.id;
        } else {
          throw new Error(convResp.error || "Failed to create conversation");
        }
      }

      const runResp = await window.carbonAPI.invoke({
        type: "run/create",
        conversationId: appState.currentConversationId as string,
        providerId: provSelect.value || null,
      } as unknown as Record<string, unknown>) as unknown as Record<string, unknown>;
      if (runResp.type !== "run/create.success") throw new Error(String(runResp.error ?? "Failed to create run"));
      const sessionResp = await window.carbonAPI.invoke({
        type: "session/create",
        workspaceId: appState.currentWorkspaceId,
        conversationId: appState.currentConversationId,
        runId: (runResp.data as { id: string }).id,
        root: {
          kind: "outlook-thread",
          threadId,
          threadSubject,
          mailbox,
        },
        supervisionMode: supervisionSelect.value || "watch",
        goal,
      } as any) as any;
      if (sessionResp.type !== "session/create.success") {
        throw new Error(String(sessionResp.error ?? "Failed to create session"));
      }

      appState.currentRunId = sessionResp.data.runId;
      appState.currentSessionId = sessionResp.data.id;

      const sessionMessage = createChatMessage("system", `Session ${sessionResp.data.id} created for ${threadSubject}.`);
      const viewSessionBtn = document.createElement("button");
      viewSessionBtn.className = "btn btn-ghost btn-sm mt-6";
      viewSessionBtn.textContent = "View Session";
      viewSessionBtn.addEventListener("click", () => window.__setActiveView__?.("sessions"));
      sessionMessage.appendChild(viewSessionBtn);
      messages.appendChild(sessionMessage);

      const startResp = await window.carbonAPI.invoke({ type: "session/start", id: sessionResp.data.id } as any) as any;
      if (startResp.type === "session/start.success") {
        if (startResp.data.fullResponse) {
          messages.appendChild(createChatMessage("assistant", startResp.data.fullResponse));
        }
        if (startResp.data.runStatus !== "completed") {
          addSystemMessage(messages, startResp.data.runError || `Session ${startResp.data.runStatus}.`);
        } else {
          addSystemMessage(messages, "Session completed.");
        }
        if (runStatusText) runStatusText.textContent = `Session ${startResp.data.runStatus}`;
      } else {
        throw new Error(String(startResp.error ?? "Failed to start session"));
      }
    } catch (error: unknown) {
      messages.appendChild(createChatMessage("system", `Error: ${error instanceof Error ? error.message : String(error)}`));
      if (runStatusText) runStatusText.textContent = "Session error";
    } finally {
      goalInput.disabled = false;
      threadSubjectInput.disabled = false;
      threadIdInput.disabled = false;
      mailboxInput.disabled = false;
      supervisionSelect.disabled = false;
      startBtn.disabled = false;
      startBtn.textContent = "Start Session";
      if (runStatusText && runStatusText.textContent === "Launching session") runStatusText.textContent = "Idle";
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
