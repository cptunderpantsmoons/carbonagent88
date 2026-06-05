import {
  Toast,
  createButton,
  createCard,
  createEmptyState,
  createFormGroup,
  createInput,
  createSelect,
  escapeHtml,
  loadProfiles,
  loadWorkspaces,
  populateSelect,
  setInspectorContent,
} from "../view-helpers.js";

export function renderWatchers(container: HTMLElement): void {
  container.innerHTML = "";

  const summaryCard = document.createElement("div");
  summaryCard.className = "watcher-summary";
  summaryCard.innerHTML = `
    <div class="watcher-summary-title">Background Watchers</div>
    <div class="watcher-summary-text">
      Autonomous agents that execute on schedule. Each watcher runs a prompt against a workspace
      using a configured browser profile. Status reflects the last execution outcome.
    </div>
  `;
  container.appendChild(summaryCard);

  const listCard = createCard("Active Watchers");
  const listEl = document.createElement("div");
  listEl.id = "watcher-list";
  listCard.appendChild(listEl);
  container.appendChild(listCard);

  const addCard = document.createElement("div");
  addCard.className = "card card-create";
  const createTitle = document.createElement("div");
  createTitle.className = "card-create-toggle";
  createTitle.textContent = "+ Schedule New Watcher";
  addCard.appendChild(createTitle);

  const createForm = document.createElement("div");
  createForm.className = "card-create-body invisible";
  const nameInput = createInput("e.g., Check Invoices");
  const promptInput = createInput("e.g., Check my SharePoint Pending folder and ingest new PDFs");
  const cronInput = createInput("*/60 * * * *");
  const workspaceSelect = createSelect([], "Select workspace...");
  const profileSelect = createSelect([], "Select profile (optional)...");

  createForm.append(
    createFormGroup("Name", nameInput),
    createFormGroup("Prompt", promptInput),
    createFormGroup("Schedule (cron)", cronInput, "*/N * * * * = every N minutes; @hourly = every hour"),
    createFormGroup("Workspace", workspaceSelect),
    createFormGroup("Profile", profileSelect),
  );

  const saveBtn = createButton("Create Watcher", "primary");
  saveBtn.className = "btn btn-primary w-100";
  createForm.appendChild(saveBtn);
  addCard.appendChild(createForm);
  container.appendChild(addCard);

  createTitle.addEventListener("click", () => createForm.classList.toggle("invisible"));

  void Promise.all([loadWorkspaces(), loadProfiles()]).then(([workspaces, profiles]) => {
    populateSelect(workspaceSelect, workspaces, (workspace) => workspace.name, "Select workspace...");
    populateSelect(profileSelect, profiles, (profile) => profile.name, "Select profile (optional)...");
  });

  saveBtn.addEventListener("click", async () => {
    if (!nameInput.value.trim() || !promptInput.value.trim() || !cronInput.value.trim() || !workspaceSelect.value) {
      Toast.show("Name, prompt, schedule, and workspace are required", "warning");
      return;
    }

    saveBtn.disabled = true;
    try {
      const resp = await window.carbonAPI.invoke({
        type: "watcher/create",
        data: {
          workspaceId: workspaceSelect.value,
          profileId: profileSelect.value || null,
          name: nameInput.value.trim(),
          prompt: promptInput.value.trim(),
          cronExpression: cronInput.value.trim(),
          enabled: true,
        },
      } as any) as any;
      if (resp.type === "watcher/create.success") {
        Toast.show("Watcher created", "success");
        await renderWatcherList();
      } else {
        Toast.show(String(resp.error), "error");
      }
    } catch (error: unknown) {
      Toast.show(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  void renderWatcherList();
}

async function renderWatcherList(): Promise<void> {
  const list = document.getElementById("watcher-list");
  if (!list) return;

  try {
    const resp = await window.carbonAPI.invoke({ type: "watcher/list" } as any) as any;
    if (resp.type !== "watcher/list.success") return;

    const watchers = resp.data ?? [];
    list.innerHTML = "";
    if (watchers.length === 0) {
      list.appendChild(createEmptyState("", "No watchers", "Create a watcher to run background tasks on schedule."));
      return;
    }

    for (const watcher of watchers as any[]) {
      const card = document.createElement("div");
      card.className = "watcher-card";
      const enabled = Boolean(watcher.enabled);
      const statusLabel = watcher.last_run_status === "success"
        ? "Healthy"
        : watcher.last_run_status === "failed"
          ? "Failed"
          : !enabled
            ? "Paused"
            : watcher.last_run_at
              ? "Running"
              : "Never Run";
      const statusClass = watcher.last_run_status === "success"
        ? "active"
        : watcher.last_run_status === "failed"
          ? "failed"
          : !enabled
            ? "expired"
            : "unknown";

      card.innerHTML = `
        <div class="watcher-card-header">
          <div class="watcher-card-name-row">
            <span class="watcher-card-name">${escapeHtml(String(watcher.name))}</span>
            <span class="badge badge-${statusClass} badge-dot">${statusLabel}</span>
          </div>
          <input type="checkbox" class="watcher-toggle" ${enabled ? "checked" : ""}>
        </div>
        <div class="watcher-card-prompt">${escapeHtml(String(watcher.prompt))}</div>
        <div class="watcher-card-meta">
          <span>Schedule: ${escapeHtml(String(watcher.cron_expression))}</span>
          <span>${watcher.last_run_at ? `Last: ${new Date(watcher.last_run_at).toLocaleString()}` : "Never run"}</span>
        </div>
        <div class="watcher-card-actions">
          <button class="btn btn-ghost btn-sm" data-action="run">Run Now</button>
          <button class="btn btn-ghost btn-sm" data-action="logs">View Logs</button>
        </div>
      `;

      const toggle = card.querySelector(".watcher-toggle") as HTMLInputElement;
      toggle.addEventListener("change", async () => {
        try {
          await window.carbonAPI.invoke({ type: "watcher/toggle", id: watcher.id } as any);
          Toast.show(enabled ? "Watcher disabled" : "Watcher enabled", "info");
        } catch (error: unknown) {
          Toast.show(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      });

      card.querySelector('[data-action="run"]')?.addEventListener("click", async () => {
        Toast.show(`Triggering ${watcher.name}...`, "info");
        try {
          await window.carbonAPI.invoke({ type: "watcher/run", id: watcher.id } as any);
          Toast.show("Watcher triggered", "success");
        } catch (error: unknown) {
          Toast.show(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      });

      card.querySelector('[data-action="logs"]')?.addEventListener("click", () => {
        setInspectorContent(`
          <div class="inspector-section"><div class="inspector-section-title">Watcher: ${escapeHtml(String(watcher.name))}</div>
            <div class="inspector-row"><span class="label">Status</span><span class="value">${statusLabel}</span></div>
            <div class="inspector-row"><span class="label">Schedule</span><span class="value">${escapeHtml(String(watcher.cron_expression))}</span></div>
            <div class="inspector-row"><span class="label">Last Run</span><span class="value">${watcher.last_run_at ? new Date(watcher.last_run_at).toLocaleString() : "Never"}</span></div>
          </div>
        `);
      });

      list.appendChild(card);
    }
  } catch (error: unknown) {
    console.error("Failed to load watchers:", error);
  }
}
