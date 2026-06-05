import {
  Toast,
  addSystemMessage,
  appState,
  createButton,
  createChatMessage,
  createInput,
  loadProviders,
  loadWorkspaces,
  openRunInspector,
  populateSelect,
  setProviderLabel,
  setWorkspaceLabel,
} from "../view-helpers.js";

export function renderPlayground(container: HTMLElement): void {
  const sessionHeader = document.createElement("div");
  sessionHeader.className = "session-header";

  const sessionInfo = document.createElement("div");
  sessionInfo.className = "session-info";

  const wsSelect = document.createElement("select");
  wsSelect.className = "form-select session-select";
  wsSelect.id = "workspace-selector";
  wsSelect.innerHTML = '<option value="">Select Workspace...</option>';

  const provSelect = document.createElement("select");
  provSelect.className = "form-select session-select";
  provSelect.innerHTML = '<option value="">Select AI Provider...</option>';

  const newConvBtn = createButton("New Chat", "secondary", "sm");
  sessionInfo.append(wsSelect, provSelect, newConvBtn);
  sessionHeader.appendChild(sessionInfo);

  const chips = document.createElement("div");
  chips.className = "task-chips";
  const suggestions = ["Inspect a portal", "Ingest a file", "Draft a document"];
  sessionHeader.appendChild(chips);
  container.appendChild(sessionHeader);

  const chatContainer = document.createElement("div");
  chatContainer.className = "chat-container playground-chat";
  const messages = document.createElement("div");
  messages.className = "chat-messages";

  const inputBar = document.createElement("div");
  inputBar.className = "chat-input-bar";
  const chatInput = createInput("Ask the agent...");
  const sendBtn = createButton("Send", "primary");
  inputBar.append(chatInput, sendBtn);
  chatContainer.append(messages, inputBar);
  container.appendChild(chatContainer);

  for (const suggestion of suggestions) {
    const chip = document.createElement("button");
    chip.className = "task-chip";
    chip.textContent = suggestion;
    chip.addEventListener("click", () => {
      chatInput.value = suggestion;
      chatInput.focus();
    });
    chips.appendChild(chip);
  }

  wsSelect.addEventListener("change", () => {
    appState.currentWorkspaceId = wsSelect.value || null;
    const selected = wsSelect.selectedOptions[0];
    setWorkspaceLabel(selected?.value ? (selected.textContent || "Workspace") : "No Workspace");
  });

  provSelect.addEventListener("change", () => {
    appState.currentConversationId = null;
    messages.innerHTML = "";
    const selected = provSelect.selectedOptions[0];
    setProviderLabel(selected?.value ? (selected.textContent || "Provider") : "No Provider");
    addSystemMessage(messages, "Provider changed — new conversation started.");
  });

  newConvBtn.addEventListener("click", () => {
    appState.currentConversationId = null;
    messages.innerHTML = "";
    addSystemMessage(messages, "New conversation started.");
  });

  sendBtn.addEventListener("click", () => void send());
  chatInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  });

  void loadWorkspaces().then((workspaces) => {
    populateSelect(wsSelect, workspaces, (workspace) => workspace.name, "Select Workspace...");
  });
  void loadProviders().then((providers) => {
    populateSelect(provSelect, providers, (provider) => `${provider.name} (${provider.type})`, "Select AI Provider...");
  });

  addSystemMessage(messages, "Select a workspace and provider to begin a session. Use the suggestions above or type your own prompt.");

  async function send(): Promise<void> {
    const text = chatInput.value.trim();
    if (!text) return;
    if (!wsSelect.value) {
      Toast.show("Please select a workspace first", "warning");
      return;
    }
    if (!provSelect.value) {
      Toast.show("Please select an AI provider first", "warning");
      return;
    }

    appState.currentWorkspaceId = wsSelect.value;
    messages.appendChild(createChatMessage("user", text));
    chatInput.value = "";
    chatInput.disabled = true;
    sendBtn.disabled = true;
    sendBtn.textContent = "Running...";

    const runStatusText = document.getElementById("run-status-text");
    if (runStatusText) runStatusText.textContent = "Running";

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
      appState.currentRunId = (runResp.data as { id: string }).id;
      const completedRunId = appState.currentRunId;

      await window.carbonAPI.invoke({ type: "run/stream", id: appState.currentRunId, message: text } as any);

      const convResp = await window.carbonAPI.invoke({ type: "conversation/get", id: appState.currentConversationId } as any) as any;
      if (convResp.type === "conversation/get.success") {
        const allMessages = convResp.data.messages || [];
        const lastAssistant = allMessages.filter((message: { role: string }) => message.role === "assistant").pop();
        if (lastAssistant) {
          const msgEl = createChatMessage("assistant", lastAssistant.content);
          const viewRunBtn = document.createElement("button");
          viewRunBtn.className = "btn btn-ghost btn-sm mt-6";
          viewRunBtn.textContent = "View Run Log";
          viewRunBtn.addEventListener("click", () => void openRunInspector(completedRunId));
          msgEl.appendChild(viewRunBtn);
          messages.appendChild(msgEl);
        } else {
          addSystemMessage(messages, "Run completed. Check the run logs for details.");
        }
      }
    } catch (error: unknown) {
      messages.appendChild(createChatMessage("system", `Error: ${error instanceof Error ? error.message : String(error)}`));
    } finally {
      chatInput.disabled = false;
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
      appState.currentRunId = null;
      if (runStatusText) runStatusText.textContent = "Idle";
      chatInput.focus();
    }
  }
}
