import {
  Toast,
  appState,
  createButton,
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
  const shell = document.createElement("div");
  shell.className = "view-stack watchers-shell";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Watchers</div>
    <div class="view-hero-title">Autonomous agents that execute on schedule.</div>
    <div class="view-hero-copy">Each watcher runs a prompt against a workspace using a configured browser profile. Status reflects the last execution outcome. Toggle, trigger, or inspect logs inline.</div>
  `;
  const heroMeta = document.createElement("div");
  heroMeta.className = "view-hero-meta";
  heroMeta.innerHTML = `<span>Cron scheduled</span><span>Browser profiles</span><span>Auto-retry</span><span>Run logs</span>`;
  hero.appendChild(heroMeta);
  shell.appendChild(hero);

  const listPanel = document.createElement("section");
  listPanel.className = "view-panel";
  const listHeader = document.createElement("div");
  listHeader.className = "view-panel-header";
  listHeader.innerHTML = `
    <div>
      <div class="view-panel-title">Active Watchers</div>
      <div class="view-panel-copy">Background tasks running on cron schedules.</div>
    </div>
  `;
  const listEl = document.createElement("div");
  listEl.id = "watcher-list";
  listPanel.append(listHeader, listEl);
  shell.appendChild(listPanel);

  const createPanel = document.createElement("section");
  createPanel.className = "view-panel";
  const createToggle = document.createElement("button");
  createToggle.className = "btn btn-ghost btn-sm w-100";
  createToggle.textContent = "+ Schedule New Watcher";

  const createForm = document.createElement("div");
  createForm.className = "toggle-group";
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
  saveBtn.className = "btn btn-primary w-100 mt-8";
  createForm.appendChild(saveBtn);
  createPanel.append(createToggle, createForm);
  shell.appendChild(createPanel);
  container.appendChild(shell);

  createToggle.addEventListener("click", () => createForm.classList.toggle("visible"));

  void Promise.all([loadWorkspaces(), loadProfiles()]).then(([workspaces, profiles]) => {
    populateSelect(workspaceSelect, workspaces, (workspace) => workspace.name, "Select workspace...");
    populateSelect(profileSelect, profiles, (profile) => profile.name, "Select profile (optional)...");
    if (appState.currentWorkspaceId) {
      workspaceSelect.value = appState.currentWorkspaceId;
    }
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
      });
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
    const resp = await window.carbonAPI.invoke({ type: "watcher/list" });
    if (resp.type !== "watcher/list.success") return;

    const watchers = ((resp.data as unknown[] | undefined) ?? []) as Array<Record<string, unknown>>;
    list.innerHTML = "";
    if (watchers.length === 0) {
      list.appendChild(createEmptyState("", "No watchers", "Create a watcher to run background tasks on schedule."));
      return;
    }

    for (const watcher of watchers) {
      const card = document.createElement("div");
      card.className = "watcher-card";
      const enabled = Boolean(watcher["enabled"] ?? Number(watcher["enabled"]) === 1);
      const statusLabel = watcher.lastRunStatus === "success" || watcher.last_run_status === "success"
        ? "Healthy"
        : watcher.lastRunStatus === "failed" || watcher.last_run_status === "failed"
          ? "Failed"
          : !enabled
            ? "Paused"
            : watcher.lastRunAt || watcher.last_run_at
              ? "Running"
              : "Never Run";
      const statusClass = watcher.lastRunStatus === "success" || watcher.last_run_status === "success"
        ? "active"
        : watcher.lastRunStatus === "failed" || watcher.last_run_status === "failed"
          ? "failed"
          : !enabled
            ? "expired"
            : "unknown";
      const watcherName = String(watcher.name ?? watcher.prompt ?? "Watcher");
      const cronExpression = String(watcher.cronExpression ?? watcher.cron_expression ?? "");
      const lastRunAt = watcher.lastRunAt ?? watcher.last_run_at;

      card.innerHTML = `
        <div class="watcher-card-header">
          <div class="watcher-card-name-row">
            <span class="watcher-card-name">${escapeHtml(watcherName)}</span>
            <span class="badge badge-${statusClass} badge-dot">${statusLabel}</span>
          </div>
          <input type="checkbox" class="watcher-toggle" ${enabled ? "checked" : ""}>
        </div>
        <div class="watcher-card-prompt">${escapeHtml(String(watcher.prompt))}</div>
        <div class="watcher-card-meta">
          <span>Schedule: ${escapeHtml(cronExpression)}</span>
          <span>${lastRunAt ? `Last: ${new Date(String(lastRunAt)).toLocaleString()}` : "Never run"}</span>
        </div>
        <div class="watcher-card-actions">
          <button class="btn btn-ghost btn-sm" data-action="run">Run Now</button>
          <button class="btn btn-ghost btn-sm" data-action="logs">View Logs</button>
        </div>
      `;

      const toggle = card.querySelector(".watcher-toggle") as HTMLInputElement;
      toggle.addEventListener("change", async () => {
        try {
          await window.carbonAPI.invoke({ type: "watcher/toggle", id: watcher.id });
          Toast.show(enabled ? "Watcher disabled" : "Watcher enabled", "info");
        } catch (error: unknown) {
          Toast.show(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      });

      card.querySelector('[data-action="run"]')?.addEventListener("click", async () => {
        Toast.show(`Triggering ${watcherName}...`, "info");
        try {
          await window.carbonAPI.invoke({ type: "watcher/run", id: watcher.id });
          Toast.show("Watcher triggered", "success");
        } catch (error: unknown) {
          Toast.show(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      });

      card.querySelector('[data-action="logs"]')?.addEventListener("click", () => {
        setInspectorContent(`
          <div class="inspector-section"><div class="inspector-section-title">Watcher: ${escapeHtml(watcherName)}</div>
            <div class="inspector-row"><span class="label">Status</span><span class="value">${statusLabel}</span></div>
            <div class="inspector-row"><span class="label">Schedule</span><span class="value">${escapeHtml(cronExpression)}</span></div>
            <div class="inspector-row"><span class="label">Last Run</span><span class="value">${lastRunAt ? new Date(String(lastRunAt)).toLocaleString() : "Never"}</span></div>
          </div>
        `);
      });

      list.appendChild(card);
    }
  } catch (error: unknown) {
    console.error("Failed to load watchers:", error);
  }
}
