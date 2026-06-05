import {
  Modal,
  Toast,
  createButton,
  createEmptyState,
  createSelect,
  escapeHtml,
  loadWorkspaces,
  populateSelect,
} from "../view-helpers.js";

export function renderSkills(container: HTMLElement): void {
  container.innerHTML = "";

  const top = document.createElement("div");
  top.className = "flex gap-2 mb-12";
  const workspaceSelect = createSelect([], "Select workspace...");
  workspaceSelect.className = "form-select flex-1";
  const refreshBtn = createButton("Refresh", "secondary", "sm");
  top.append(workspaceSelect, refreshBtn);
  container.appendChild(top);

  const list = document.createElement("div");
  list.id = "skills-list";
  list.className = "skills-grid";
  container.appendChild(list);

  void loadWorkspaces().then((workspaces) => {
    populateSelect(workspaceSelect, workspaces, (workspace) => workspace.name, "Select workspace...");
    void renderSkillCards(list, workspaceSelect.value || undefined);
  });

  workspaceSelect.addEventListener("change", () => void renderSkillCards(list, workspaceSelect.value || undefined));
  refreshBtn.addEventListener("click", () => void renderSkillCards(list, workspaceSelect.value || undefined));
}

async function renderSkillCards(list: HTMLElement, workspaceId?: string): Promise<void> {
  list.innerHTML = "";
  if (!workspaceId) {
    list.appendChild(createEmptyState("icon-skill", "Select a workspace", "Choose a workspace to view learned skills."));
    return;
  }

  try {
    const resp = await window.carbonAPI.invoke({ type: "skills/list", workspaceId } as any) as any;
    if (resp.type !== "skills/list.success") return;

    const skills = resp.skills ?? [];
    if (skills.length === 0) {
      list.appendChild(createEmptyState("icon-skill", "No skills yet", "Skills are automatically learned from successful agent runs."));
      return;
    }

    for (const skill of skills as any[]) {
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
        const result = await window.carbonAPI.invoke({ type: "skills/pin", id: skill.id, pinned: !skill.pinned } as any) as any;
        if (result.type === "skills/pin.success") {
          Toast.show(skill.pinned ? "Skill unpinned" : "Skill pinned", "success");
          await renderSkillCards(list, workspaceId);
        }
      });

      card.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
        const confirmed = await Modal.confirm("Delete Skill", `Delete \"${skill.name}\"? This cannot be undone.`);
        if (!confirmed) return;
        const result = await window.carbonAPI.invoke({ type: "skills/delete", id: skill.id } as any) as any;
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
