import {
  Toast,
  appState,
  createButton,
  createEmptyState,
  createSelect,
  escapeHtml,
  loadWorkspaces,
  populateSelect,
} from "../view-helpers.js";

export function renderOutputs(container: HTMLElement): void {
  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "view-stack outputs-shell";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Outputs</div>
    <div class="view-hero-title">Browse generated documents without leaving the workspace.</div>
    <div class="view-hero-copy">This view stays focused on the output shelf. Pick a workspace, narrow by format, and inspect the generated file directly from the list.</div>
  `;
  const outputsCount = document.createElement("div");
  outputsCount.className = "view-hero-meta";
  outputsCount.innerHTML = `<span id="outputs-count">0 outputs</span><span>Workspace scoped</span><span>Format filtered</span>`;
  hero.appendChild(outputsCount);
  shell.appendChild(hero);

  const topCard = document.createElement("section");
  topCard.className = "view-panel";
  const top = document.createElement("div");
  top.className = "view-toolbar";

  const workspaceSelect = createSelect([], "Select workspace...");
  workspaceSelect.className = "form-select outputs-workspace";
  top.appendChild(workspaceSelect);

  const filterGroup = document.createElement("div");
  filterGroup.className = "view-toolbar-group output-filters";
  const filterButtons = ["all", "md", "docx", "pdf"].map((value) => {
    const btn = createButton(value.toUpperCase() === "ALL" ? "All" : value.toUpperCase(), value === "all" ? "secondary" : "ghost", "sm");
    btn.className = `btn btn-${value === "all" ? "secondary" : "ghost"} btn-sm output-filter${value === "all" ? " active" : ""}`;
    filterGroup.appendChild(btn);
    return { value, btn };
  });
  top.appendChild(filterGroup);

  const refreshBtn = createButton("Refresh", "secondary", "sm");
  top.appendChild(refreshBtn);
  topCard.appendChild(top);
  shell.appendChild(topCard);

  const resultsPanel = document.createElement("section");
  resultsPanel.className = "view-panel outputs-results-panel";
  const grid = document.createElement("div");
  grid.id = "outputs-list";
  grid.className = "outputs-grid";
  resultsPanel.appendChild(grid);
  shell.appendChild(resultsPanel);
  container.appendChild(shell);

  let activeFilter = "all";
  const setActiveFilter = (value: string) => {
    activeFilter = value;
    for (const entry of filterButtons) {
      entry.btn.className = `btn btn-${entry.value === value ? "secondary" : "ghost"} btn-sm output-filter${entry.value === value ? " active" : ""}`;
    }
    void renderOutputsGrid(grid, workspaceSelect.value || undefined, activeFilter);
  };

  for (const entry of filterButtons) {
    entry.btn.addEventListener("click", () => setActiveFilter(entry.value));
  }

  void loadWorkspaces().then((workspaces) => {
    populateSelect(workspaceSelect, workspaces, (workspace) => workspace.name, "Select workspace...");
    if (appState.currentWorkspaceId) {
      workspaceSelect.value = appState.currentWorkspaceId;
    }
    void renderOutputsGrid(grid, workspaceSelect.value || undefined, activeFilter);
  });

  workspaceSelect.addEventListener("change", () => void renderOutputsGrid(grid, workspaceSelect.value || undefined, activeFilter));
  refreshBtn.addEventListener("click", () => void renderOutputsGrid(grid, workspaceSelect.value || undefined, activeFilter));

  void renderOutputsGrid(grid, workspaceSelect.value || undefined, activeFilter);
}

async function renderOutputsGrid(grid: HTMLElement, workspaceId?: string, format?: string): Promise<void> {
  grid.innerHTML = "";
  const countEl = document.getElementById("outputs-count");
  if (!workspaceId) {
    if (countEl) countEl.textContent = "0 outputs";
    grid.appendChild(createEmptyState("icon-output", "Select a workspace", "Choose a workspace to view generated documents."));
    return;
  }

  try {
    const resp = await window.carbonAPI.invoke({ type: "document/list", workspaceId });
    if (resp.type !== "document/list.success") return;

    const _rawDocs = ((resp.data as unknown[] | undefined) ?? []) as Array<Record<string, unknown>>;
    let docs = _rawDocs;
    if (format && format !== "all") {
      docs = docs.filter((doc) => String(doc["format"] || "").toLowerCase() === format);
    }
    if (countEl) countEl.textContent = `${docs.length} output${docs.length === 1 ? "" : "s"}`;

    if (docs.length === 0) {
      grid.appendChild(createEmptyState("icon-output", "No outputs", format && format !== "all" ? `No ${format.toUpperCase()} documents found.` : "Generated documents appear here."));
      return;
    }

    for (const doc of docs as Array<Record<string, unknown>>) {
      const fmt = String(doc.format || "unknown").toUpperCase();
      const fmtClass = fmt === "MD" ? "success" : fmt === "DOCX" ? "info" : fmt === "PDF" ? "warning" : "unknown";
      const card = document.createElement("div");
      card.className = "output-shelf-card";
      card.innerHTML = `
        <div class="output-shelf-header">
          <span class="output-shelf-title">${escapeHtml(String(doc.title || "Untitled"))}</span>
          <span class="badge badge-${fmtClass}">${fmt}</span>
        </div>
        <div class="output-shelf-meta">
          <span>${new Date(String(doc.createdAt ?? doc.created_at)).toLocaleDateString()}</span>
          <span>${escapeHtml(String(doc.filePath ?? doc.file_path ?? ""))}</span>
        </div>
        <div class="output-shelf-preview">${escapeHtml(String(((doc["preview"] ?? doc["content"] ?? "") as string).slice(0, 120)))}</div>
        <div class="output-shelf-actions">
          <button class="btn btn-ghost btn-sm" data-action="open">Open</button>
          <button class="btn btn-ghost btn-sm" data-action="reveal">Reveal</button>
          <button class="btn btn-ghost btn-sm" data-action="copy">Copy Path</button>
        </div>
      `;

      card.querySelector('[data-action="open"]')?.addEventListener("click", async () => {
        const result = await window.carbonAPI.invoke({ type: "document/open", filePath: String(doc.filePath ?? doc.file_path ?? "") });
        if (result.type === "error") {
          Toast.show(String(result.error), "error");
        }
      });
      card.querySelector('[data-action="reveal"]')?.addEventListener("click", async () => {
        const result = await window.carbonAPI.invoke({ type: "document/reveal", filePath: String(doc.filePath ?? doc.file_path ?? "") });
        if (result.type === "error") {
          Toast.show(String(result.error), "error");
        }
      });
      card.querySelector('[data-action="copy"]')?.addEventListener("click", () => {
        void navigator.clipboard.writeText(String(doc.filePath ?? doc.file_path ?? "")).then(() => Toast.show("Path copied", "success"));
      });
      grid.appendChild(card);
    }
  } catch (error: unknown) {
    console.error("Failed to load outputs:", error);
  }
}
