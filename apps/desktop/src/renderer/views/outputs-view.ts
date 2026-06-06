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

  const top = document.createElement("div");
  top.className = "flex gap-2 mb-12";

  const workspaceSelect = createSelect([], "Select workspace...");
  workspaceSelect.className = "form-select flex-1";
  top.appendChild(workspaceSelect);

  const filterGroup = document.createElement("div");
  filterGroup.className = "flex gap-2";
  const filterButtons = ["all", "md", "docx", "pdf"].map((value) => {
    const btn = createButton(value.toUpperCase() === "ALL" ? "All" : value.toUpperCase(), value === "all" ? "secondary" : "ghost", "sm");
    btn.className = `btn btn-${value === "all" ? "secondary" : "ghost"} btn-sm output-filter${value === "all" ? " active" : ""}`;
    filterGroup.appendChild(btn);
    return { value, btn };
  });
  top.appendChild(filterGroup);

  const refreshBtn = createButton("Refresh", "secondary", "sm");
  top.appendChild(refreshBtn);
  container.appendChild(top);

  const grid = document.createElement("div");
  grid.id = "outputs-list";
  grid.className = "outputs-grid";
  container.appendChild(grid);

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
}

async function renderOutputsGrid(grid: HTMLElement, workspaceId?: string, format?: string): Promise<void> {
  grid.innerHTML = "";
  if (!workspaceId) {
    grid.appendChild(createEmptyState("icon-output", "Select a workspace", "Choose a workspace to view generated documents."));
    return;
  }

  try {
    const resp = await window.carbonAPI.invoke({ type: "document/list", workspaceId } as any) as any;
    if (resp.type !== "document/list.success") return;

    let docs = resp.data ?? [];
    if (format && format !== "all") {
      docs = docs.filter((doc: { format?: string }) => String(doc.format || "").toLowerCase() === format);
    }

    if (docs.length === 0) {
      grid.appendChild(createEmptyState("icon-output", "No outputs", format && format !== "all" ? `No ${format.toUpperCase()} documents found.` : "Generated documents appear here."));
      return;
    }

    for (const doc of docs as any[]) {
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
        <div class="output-shelf-preview">${escapeHtml(String((doc.preview || doc.content || "").slice(0, 120)))}</div>
        <div class="output-shelf-actions">
          <button class="btn btn-ghost btn-sm" data-action="open">Open</button>
          <button class="btn btn-ghost btn-sm" data-action="reveal">Reveal</button>
          <button class="btn btn-ghost btn-sm" data-action="copy">Copy Path</button>
        </div>
      `;

      card.querySelector('[data-action="open"]')?.addEventListener("click", async () => {
        const result = await window.carbonAPI.invoke({ type: "document/open", filePath: String(doc.filePath ?? doc.file_path ?? "") } as any) as any;
        if (result.type === "error") {
          Toast.show(String(result.error), "error");
        }
      });
      card.querySelector('[data-action="reveal"]')?.addEventListener("click", async () => {
        const result = await window.carbonAPI.invoke({ type: "document/reveal", filePath: String(doc.filePath ?? doc.file_path ?? "") } as any) as any;
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
