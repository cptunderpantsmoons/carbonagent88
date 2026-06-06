import {
  Toast,
  appState,
  createButton,
  createEmptyState,
  createFormGroup,
  createInput,
  createListItem,
  createStatusDot,
  escapeHtml,
  loadWorkspaces,
  setInspectorContent,
  setWorkspaceLabel,
} from "../view-helpers.js";

export function renderWorkspaces(container: HTMLElement): void {
  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "view-stack workspaces-shell";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Workspaces</div>
    <div class="view-hero-title">Isolate projects with their own vaults and conversations.</div>
    <div class="view-hero-copy">Each workspace carries an independent document vault, conversation history, and skill library. Select one to make it active across the app.</div>
  `;
  const heroMeta = document.createElement("div");
  heroMeta.className = "view-hero-meta";
  heroMeta.innerHTML = `<span>Isolated vaults</span><span>Conversations</span><span>Skills</span><span>Outputs</span>`;
  hero.appendChild(heroMeta);
  shell.appendChild(hero);

  const listPanel = document.createElement("section");
  listPanel.className = "view-panel";
  const listHeader = document.createElement("div");
  listHeader.className = "view-panel-header";
  listHeader.innerHTML = `
    <div>
      <div class="view-panel-title">Your Workspaces</div>
      <div class="view-panel-copy">Click a workspace to activate it and inspect its vault.</div>
    </div>
  `;
  const listEl = document.createElement("div");
  listEl.className = "list";
  listEl.id = "workspace-list";
  listPanel.append(listHeader, listEl);
  shell.appendChild(listPanel);

  const createPanel = document.createElement("section");
  createPanel.className = "view-panel";
  const createHeader = document.createElement("div");
  createHeader.className = "view-panel-header";
  createHeader.innerHTML = `
    <div>
      <div class="view-panel-title">New Workspace</div>
      <div class="view-panel-copy">Create a fresh project with its own isolated vault.</div>
    </div>
  `;
  const nameInput = createInput("My Project");
  const descInput = createInput("Optional");
  createPanel.append(
    createHeader,
    createFormGroup("Name", nameInput),
    createFormGroup("Description", descInput, "Helps organize your workspace purpose"),
  );
  const saveBtn = createButton("Create Workspace", "primary");
  saveBtn.className = "btn btn-primary w-100 mt-8";
  createPanel.appendChild(saveBtn);
  shell.appendChild(createPanel);
  container.appendChild(shell);

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      Toast.show("Name is required", "warning");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Creating...";
    try {
      const resp = await window.carbonAPI.invoke({
        type: "workspace/create",
        data: { name, description: descInput.value.trim() || undefined, vaultDir: `/workspace/${Date.now()}` },
      } as any) as any;
      if (resp.type === "error") Toast.show(String(resp.error), "error");
      else {
        Toast.show("Workspace created", "success");
        nameInput.value = "";
        descInput.value = "";
        await renderWorkspaceList();
      }
    } catch (error: unknown) {
      Toast.show(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Create Workspace";
    }
  });

  void renderWorkspaceList();
}

async function renderWorkspaceList(): Promise<void> {
  const list = document.getElementById("workspace-list");
  if (!list) return;

  const workspaces = await loadWorkspaces();
  list.innerHTML = "";
  if (workspaces.length === 0) {
    list.appendChild(createEmptyState("icon-workspace", "No workspaces", "Create a workspace to isolate documents and conversations."));
    return;
  }

  for (const workspace of workspaces) {
    const item = createListItem(workspace.name, workspace.description || workspace.vault_dir || workspace.vaultDir || "Vault ready");
    const isActive = workspace.id === appState.currentWorkspaceId;
    if (isActive) item.classList.add("selected");
    item.querySelector(".list-item-info")?.prepend(createStatusDot(isActive ? "active" : "unknown"));

    item.addEventListener("click", () => {
      appState.currentWorkspaceId = workspace.id;
      setWorkspaceLabel(workspace.name);
      list.querySelectorAll(".list-item").forEach((element) => element.classList.remove("selected"));
      item.classList.add("selected");
      setInspectorContent(`
        <div class="inspector-section"><div class="inspector-section-title">Workspace</div>
          <div class="inspector-row"><span class="label">Name</span><span class="value">${escapeHtml(workspace.name)}</span></div>
          <div class="inspector-row"><span class="label">Vault</span><span class="value font-11">${escapeHtml(workspace.vault_dir || workspace.vaultDir || "—")}</span></div>
          <div class="inspector-row"><span class="label">Description</span><span class="value">${escapeHtml(workspace.description || "—")}</span></div>
        </div>
        <div class="inspector-section"><div class="inspector-section-title">Quick Actions</div>
          <button class="btn btn-ghost btn-sm w-100" onclick="window.__setActiveView__('vault')">Open Vault</button>
          <button class="btn btn-ghost btn-sm w-100 mt-4" onclick="window.__setActiveView__('ingestion')">Ingest Files</button>
          <button class="btn btn-ghost btn-sm w-100 mt-4" onclick="window.__setActiveView__('outputs')">View Outputs</button>
        </div>
      `);
    });

    list.appendChild(item);
  }
}
