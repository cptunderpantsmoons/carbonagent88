import { Toast, appState } from "../view-helpers.js";

interface HarnessDef {
  id: string;
  name: string;
  type: "browser" | "code" | "local";
  description: string;
  capabilities: string[];
}

interface HarnessConfig {
  id: string;
  workspaceId: string;
  harnessId: string;
  enabled: boolean;
  taskTemplate: string | null;
  qualityGates: string[];
  extraJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const HARNESS_REGISTRY: HarnessDef[] = [
  {
    id: "browser",
    name: "Browser Harness",
    type: "browser",
    description: "CDP-based browser orchestration for authenticated enterprise portals.",
    capabilities: ["stealth_open", "stealth_scrape", "stealth_download", "ingest_file", "rag_retrieve"],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    type: "code",
    description: "Claude Code CLI sub-agent. Full coding agent with file editing and terminal access.",
    capabilities: ["code_edit", "terminal", "refactor", "debug"],
  },
  {
    id: "codex",
    name: "Codex",
    type: "code",
    description: "OpenAI Codex CLI sub-agent. Autonomous coding sandboxed to the workspace.",
    capabilities: ["code_generate", "analyze", "multi_file"],
  },
  {
    id: "local",
    name: "Local Sub-Agent",
    type: "local",
    description: "In-process agent runtime for researcher, extractor, and drafter roles.",
    capabilities: ["research", "extract", "draft", "reason"],
  },
];

const TYPE_COLORS: Record<string, string> = {
  browser: "#68b5f8",
  code: "#6ee7a0",
  local: "#f5c542",
};

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function loadHarnessConfigs(workspaceId: string): Promise<HarnessConfig[]> {
  const resp = await window.carbonAPI.invoke({ type: "harness-configs/list", workspaceId });
  if (resp && resp.type === "harness-configs/list.success") {
    return (resp.data as unknown as HarnessConfig[]) ?? [];
  }
  return [];
}

async function saveHarnessConfig(config: HarnessConfig): Promise<void> {
  await window.carbonAPI.invoke({
    type: "harness-configs/update",
    id: config.id,
    workspaceId: config.workspaceId,
    harnessId: config.harnessId,
    data: {
      enabled: config.enabled,
      taskTemplate: config.taskTemplate ?? undefined,
      qualityGates: config.qualityGates,
      extraJson: config.extraJson,
    },
  });
}

export async function renderHarnesses(container: HTMLElement): Promise<void> {
  const workspaceId = appState.currentWorkspaceId ?? undefined;
  container.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "view-stack";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Harnesses</div>
    <div class="view-hero-title">Manage agent harnesses.</div>
    <div class="view-hero-copy">Enable, disable, and configure harnesses for the orchestration pipeline. Task templates guide the planner; quality gates define acceptance criteria.</div>
  `;
  shell.appendChild(hero);

  if (!workspaceId) {
    const notice = document.createElement("div");
    notice.className = "empty-state";
    notice.innerHTML = `<div class="empty-state-text">Select a workspace to manage harnesses.</div>`;
    shell.appendChild(notice);
    container.appendChild(shell);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "harness-grid";

  let configs: HarnessConfig[];
  try {
    configs = await loadHarnessConfigs(workspaceId);
  } catch {
    configs = [];
  }

  const byHarnessId = new Map<string, HarnessConfig>();
  for (const c of configs) byHarnessId.set(c.harnessId, c);

  for (const def of HARNESS_REGISTRY) {
    const config = byHarnessId.get(def.id) ?? {
      id: crypto.randomUUID(),
      workspaceId,
      harnessId: def.id,
      enabled: true,
      taskTemplate: null,
      qualityGates: [],
      extraJson: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const card = document.createElement("div");
    const typeColor = TYPE_COLORS[def.type] || "#7f7f7f";
    card.className = `harness-card ${config.enabled ? "harness-card-active" : ""}`;
    card.dataset.harnessId = def.id;

    const capTags = def.capabilities.map((c) => `<span class="harness-capability-tag">${c}</span>`).join("");

    card.innerHTML = `
      <div class="harness-card-header">
        <div class="harness-card-main">
          <div class="harness-card-name">${escapeHtml(def.name)}</div>
          <span class="harness-type-badge" style="background:${typeColor}20;color:${typeColor};border-color:${typeColor}40">${def.type}</span>
        </div>
        <div class="harness-status-dot ${config.enabled ? "enabled" : "disabled"}"></div>
      </div>
      <div class="harness-card-desc">${escapeHtml(def.description)}</div>
      <div class="harness-capabilities">${capTags}</div>

      <div class="harness-editor-section">
        <div class="harness-editor-label">Task Template</div>
        <textarea class="harness-task-template" rows="3" placeholder="Prompt template used when planner assigns to this harness...">${escapeHtml(config.taskTemplate ?? "")}</textarea>
      </div>

      <div class="harness-editor-section">
        <div class="harness-editor-label">Quality Gates</div>
        <div class="harness-quality-gates"></div>
        <button class="btn btn-ghost btn-sm harness-add-gate-btn" type="button">+ Add Gate</button>
      </div>

      <div class="harness-card-actions">
        <button class="btn btn-sm harness-toggle-btn" data-id="${def.id}">${config.enabled ? "Disable" : "Enable"}</button>
        <button class="btn btn-sm btn-secondary harness-test-btn" data-id="${def.id}">Test</button>
        <button class="btn btn-sm btn-primary harness-save-btn" data-id="${def.id}">Save</button>
      </div>
    `;

    // Quality gates editor
    const gatesContainer = card.querySelector(".harness-quality-gates") as HTMLDivElement;
    function renderGates() {
      gatesContainer.innerHTML = "";
      for (let i = 0; i < config.qualityGates.length; i += 1) {
        const gateWrap = document.createElement("div");
        gateWrap.className = "harness-gate-row";
        gateWrap.innerHTML = `
          <input type="text" class="form-input harness-gate-input" value="${escapeHtml(config.qualityGates[i])}" placeholder="e.g., Numeric totals must match across documents" />
          <button class="btn btn-ghost btn-xs harness-remove-gate-btn" type="button" data-index="${i}">&times;</button>
        `;
        const removeBtn = gateWrap.querySelector(".harness-remove-gate-btn");
        removeBtn?.addEventListener("click", () => {
          config.qualityGates.splice(i, 1);
          renderGates();
        });
        gatesContainer.appendChild(gateWrap);
      }
    }
    renderGates();

    const addGateBtn = card.querySelector(".harness-add-gate-btn") as HTMLButtonElement;
    addGateBtn.addEventListener("click", () => {
      config.qualityGates.push("");
      renderGates();
    });

    // Toggle
    const toggleBtn = card.querySelector(".harness-toggle-btn") as HTMLButtonElement;
    toggleBtn.addEventListener("click", () => {
      config.enabled = !config.enabled;
      card.classList.toggle("harness-card-active", config.enabled);
      toggleBtn.textContent = config.enabled ? "Disable" : "Enable";
      card.querySelector(".harness-status-dot")?.classList.replace(config.enabled ? "disabled" : "enabled", config.enabled ? "enabled" : "disabled");
      void save();
    });

    // Test
    const testBtn = card.querySelector(".harness-test-btn") as HTMLButtonElement;
    testBtn.addEventListener("click", async () => {
      const wsId = appState.currentWorkspaceId;
      if (!wsId) {
        Toast.show("Select a workspace first", "warning");
        return;
      }
      testBtn.textContent = "Testing...";
      testBtn.disabled = true;
      try {
        const resp = (await window.carbonAPI.invoke({
          type: "harness-configs/test",
          workspaceId: wsId,
          harnessId: def.id,
        })) as { type: "harness-configs/test.success"; passed: boolean; message: string } | { type: "error"; error: string };
        if (resp.type === "harness-configs/test.success") {
          Toast.show(resp.message, resp.passed ? "success" : "error");
        } else {
          Toast.show(`Test failed: ${resp.error}`, "error");
        }
      } catch {
        Toast.show(`Failed to test ${def.name} harness`, "error");
      } finally {
        testBtn.textContent = "Test";
        testBtn.disabled = false;
      }
    });

    // Save
    const taskTemplateInput = card.querySelector(".harness-task-template") as HTMLTextAreaElement;
    const saveBtn = card.querySelector(".harness-save-btn") as HTMLButtonElement;
    saveBtn.addEventListener("click", () => {
      // Collect gate values from inputs
      const gateInputs = card.querySelectorAll<HTMLInputElement>(".harness-gate-input");
      config.qualityGates = Array.from(gateInputs).map((input) => input.value.trim()).filter(Boolean);
      config.taskTemplate = taskTemplateInput.value.trim() || null;
      void save();
    });

    async function save() {
      saveBtn.textContent = "Saving...";
      saveBtn.disabled = true;
      try {
        await saveHarnessConfig(config);
        Toast.show(`${def.name} configuration saved.`, "success");
      } catch {
        Toast.show(`Failed to save ${def.name} configuration.`, "error");
      } finally {
        saveBtn.textContent = "Save";
        saveBtn.disabled = false;
      }
    }

    grid.appendChild(card);
  }

  shell.appendChild(grid);
  container.appendChild(shell);
}
