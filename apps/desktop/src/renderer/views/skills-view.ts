import {
  Modal,
  Toast,
  appState,
  createButton,
  createEmptyState,
  createSelect,
  escapeHtml,
  loadWorkspaces,
  populateSelect,
} from "../view-helpers.js";

export function renderSkills(container: HTMLElement): void {
  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "view-stack skills-shell";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Learned Skills</div>
    <div class="view-hero-title">Inspect the agent’s learned playbooks with less noise.</div>
    <div class="view-hero-copy">This surface is built to scan quickly. The header is compact, the cards are denser, and the most useful metrics are visible first.</div>
  `;
  const heroMeta = document.createElement("div");
  heroMeta.className = "view-hero-meta";
  heroMeta.innerHTML = `<span>Workspace scoped</span><span>Success rate</span><span>Pinned state</span><span>Imports / exports</span>`;
  hero.appendChild(heroMeta);
  shell.appendChild(hero);

  const topCard = document.createElement("section");
  topCard.className = "view-panel skills-toolbar-card";
  const top = document.createElement("div");
  top.className = "view-toolbar";
  const workspaceSelect = createSelect([], "Select workspace...");
  workspaceSelect.className = "form-select flex-1 skills-workspace";
  const refreshBtn = createButton("Refresh", "secondary", "sm");
  const exportBtn = createButton("Export", "secondary", "sm");
  const importBtn = createButton("Import", "secondary", "sm");
  const actionGroup = document.createElement("div");
  actionGroup.className = "view-toolbar-group";
  actionGroup.append(refreshBtn, exportBtn, importBtn);
  top.append(workspaceSelect, actionGroup);
  topCard.appendChild(top);
  shell.appendChild(topCard);

  const listCard = document.createElement("section");
  listCard.className = "view-panel skills-list-card";
  const list = document.createElement("div");
  list.id = "skills-list";
  list.className = "skills-grid";
  listCard.appendChild(list);
  shell.appendChild(listCard);

  // Hidden file input for import
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json";
  fileInput.style.display = "none";
  shell.appendChild(fileInput);
  container.appendChild(shell);

  void loadWorkspaces().then((workspaces) => {
    populateSelect(workspaceSelect, workspaces, (workspace) => workspace.name, "Select workspace...");
    if (appState.currentWorkspaceId) {
      workspaceSelect.value = appState.currentWorkspaceId;
    }
    void renderSkillCards(list, workspaceSelect.value || undefined);
  });

  workspaceSelect.addEventListener("change", () => void renderSkillCards(list, workspaceSelect.value || undefined));
  refreshBtn.addEventListener("click", () => void renderSkillCards(list, workspaceSelect.value || undefined));

  exportBtn.addEventListener("click", async () => {
    const wsId = workspaceSelect.value;
    if (!wsId) { Toast.show("Select a workspace first", "error"); return; }
    const resp = await window.carbonAPI.invoke({ type: "skills/export", workspaceId: wsId }) as
      | { type: "skills/export.success"; data: unknown }
      | { type: "error"; error: string };
    if (resp.type === "skills/export.success") {
      const json = JSON.stringify(resp.data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `carbon-skills-${wsId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      Toast.show("Skills exported", "success");
    }
  });

  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown[];
      if (!Array.isArray(data)) throw new Error("Invalid format");
      const resp = await window.carbonAPI.invoke({ type: "skills/import", data }) as
        | { type: "skills/import.success"; data: { imported: number; skipped: number } }
        | { type: "error"; error: string };
      if (resp.type === "skills/import.success") {
        Toast.show(`Imported ${resp.data.imported} skills (${resp.data.skipped} skipped)`, "success");
        void renderSkillCards(list, workspaceSelect.value || undefined);
      }
    } catch (error: unknown) {
      Toast.show(`Import failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
    fileInput.value = "";
  });
}

async function renderSkillCards(list: HTMLElement, workspaceId?: string): Promise<void> {
  list.innerHTML = "";
  if (!workspaceId) {
    list.appendChild(createEmptyState("icon-skill", "Select a workspace", "Choose a workspace to view learned skills."));
    return;
  }

  try {
    const resp = await window.carbonAPI.invoke({ type: "skills/list", workspaceId }) as
      | { type: "skills/list.success"; data: unknown[] }
      | { type: "error"; error: string };
    if (resp.type !== "skills/list.success") return;

    const skills = resp.data ?? [];
    if (skills.length === 0) {
      list.appendChild(createEmptyState("icon-skill", "No skills yet", "Skills are automatically learned from successful agent runs."));
      return;
    }

    for (const skill of skills as Array<Record<string, unknown>>) {
      const totalRuns = Number(skill.successCount || 0) + Number(skill.failureCount || 0);
      const successRate = totalRuns > 0 ? Math.round((Number(skill.successCount || 0) / totalRuns) * 100) : 0;
      const rateClass = successRate >= 80 ? "success" : successRate >= 50 ? "warning" : "danger";

      const card = document.createElement("div");
      card.className = "skill-playbook-card";
      card.innerHTML = `
        <div class="skill-playbook-header">
          <span class="skill-playbook-name">${escapeHtml(String(skill.name))}</span>
          ${skill.pinned ? '<span class="badge badge-warning">Pinned</span>' : ""}
        </div>
        <div class="skill-playbook-trigger">${escapeHtml(String(skill.trigger || "No trigger summary"))}</div>
        <div class="skill-playbook-metrics">
          <span class="badge badge-${rateClass}">${successRate}% success</span>
          <span class="skill-playbook-runs">${totalRuns} runs</span>
          <button class="btn btn-ghost btn-sm" data-action="toggle">${skill.pinned ? "Unpin" : "Pin"}</button>
          <button class="btn btn-ghost btn-sm" data-action="delete">Delete</button>
        </div>
      `;

      card.querySelector('[data-action="toggle"]')?.addEventListener("click", async () => {
        const result = await window.carbonAPI.invoke({ type: "skills/pin", id: skill.id, pinned: !skill.pinned }) as
          | { type: "skills/pin.success" }
          | { type: "error"; error: string };
        if (result.type === "skills/pin.success") {
          Toast.show(skill.pinned ? "Skill unpinned" : "Skill pinned", "success");
          await renderSkillCards(list, workspaceId);
        }
      });

      card.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
        const confirmed = await Modal.confirm("Delete Skill", `Delete \"${skill.name}\"? This cannot be undone.`);
        if (!confirmed) return;
        const result = await window.carbonAPI.invoke({ type: "skills/delete", id: skill.id }) as
          | { type: "skills/delete.success" }
          | { type: "error"; error: string };
        if (result.type === "skills/delete.success") {
          Toast.show("Skill deleted", "success");
          await renderSkillCards(list, workspaceId);
        }
      });

      list.appendChild(card);
    }
  } catch (error: unknown) {
    console.error("Failed to load skills:", error);
  }
}
