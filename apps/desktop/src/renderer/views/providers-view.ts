import {
  Modal,
  Toast,
  type ProviderRecord,
  appState,
  createBadge,
  createButton,
  createEmptyState,
  createFormGroup,
  createInput,
  createListItem,
  createSelect,
  createStatusDot,
  escapeHtml,
  loadProviders,
} from "../view-helpers.js";

export function renderProviders(container: HTMLElement): void {
  container.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "two-col-layout";

  const leftPanel = document.createElement("div");
  leftPanel.className = "two-col-left";
  const header = document.createElement("div");
  header.className = "flex gap-2 mb-12";
  header.innerHTML = '<span class="two-col-title">AI Providers</span>';
  const addBtn = createButton("+ Add", "secondary", "sm");
  header.appendChild(addBtn);
  leftPanel.appendChild(header);

  const listEl = document.createElement("div");
  listEl.className = "list";
  listEl.id = "provider-list";
  leftPanel.appendChild(listEl);

  const rightPanel = document.createElement("div");
  rightPanel.className = "two-col-right";
  rightPanel.id = "provider-detail";

  layout.append(leftPanel, rightPanel);
  container.appendChild(layout);

  // Model Roles Section
  const rolesSection = document.createElement("div");
  rolesSection.className = "model-roles-section mt-24";
  rolesSection.innerHTML = '<h3 class="section-title">Model Roles</h3><p class="section-desc">Assign specialized providers to agent roles for optimized performance.</p>';
  const rolesGrid = document.createElement("div");
  rolesGrid.className = "model-roles-grid";
  rolesGrid.id = "model-roles-grid";
  rolesSection.appendChild(rolesGrid);
  container.appendChild(rolesSection);

  addBtn.addEventListener("click", () => showProviderCreateForm(rightPanel));
  showProviderDetail(rightPanel, null);
  void renderProviderList();
  void renderModelRoles(rolesGrid);
}

const ROLE_DEFINITIONS = [
  { role: "assistant" as const, label: "Assistant", desc: "General conversations and task coordination" },
  { role: "coder" as const, label: "Coder", desc: "Code generation, editing, and debugging" },
  { role: "knowledge-graph" as const, label: "Knowledge Graph", desc: "Knowledge extraction and entity linking" },
  { role: "meeting-notes" as const, label: "Meeting Notes", desc: "Summarization and note generation" },
  { role: "track-block" as const, label: "Track Block", desc: "Task tracking and project management" },
];

async function renderModelRoles(grid: HTMLElement): Promise<void> {
  grid.innerHTML = "";

  const providers = await loadProviders();
  let currentRoles: { role: string; providerId: string }[] = [];
  const wsId = appState.currentWorkspaceId;

  if (wsId) {
    try {
      const resp = await window.carbonAPI.invoke({ type: "model-roles/list", workspaceId: wsId } as any) as any;
      if (resp.type === "model-roles/list.success") {
        currentRoles = (resp.data as any[]) ?? [];
      }
    } catch { /* ignore */ }
  }

  for (const def of ROLE_DEFINITIONS) {
    const assigned = currentRoles.find((r) => r.role === def.role);
    const assignedProvider = assigned ? providers.find((p) => p.id === assigned.providerId) : null;

    const card = document.createElement("div");
    card.className = "model-role-card";

    const options = [{ value: "", label: "Default (no override)" }];
    for (const p of providers) {
      options.push({ value: p.id, label: `${p.name} (${p.model})` });
    }

    const select = createSelect(options, "Select provider...");
    if (assignedProvider) select.value = assignedProvider.id;

    card.innerHTML = `
      <div class="role-card-header">
        <span class="role-card-label">${escapeHtml(def.label)}</span>
        ${assignedProvider ? '<span class="badge badge-active">Assigned</span>' : '<span class="badge">Unassigned</span>'}
      </div>
      <div class="role-card-desc">${escapeHtml(def.desc)}</div>
    `;
    card.appendChild(select);

    select.addEventListener("change", async () => {
      if (!wsId) { Toast.show("Select a workspace first", "error"); return; }
      if (select.value) {
        const resp = await window.carbonAPI.invoke({
          type: "model-roles/set",
          data: { role: def.role, providerId: select.value, workspaceId: wsId },
        } as any) as any;
        if (resp.type === "model-roles/set.success") {
          Toast.show(`${def.label} role updated`, "success");
        }
      } else if (assigned) {
        await window.carbonAPI.invoke({
          type: "model-roles/delete",
          role: def.role,
          workspaceId: wsId,
        } as any);
        Toast.show(`${def.label} role cleared`, "success");
      }
      void renderModelRoles(grid);
    });

    grid.appendChild(card);
  }
}

function showProviderDetail(panel: HTMLElement, provider: ProviderRecord | null): void {
  panel.innerHTML = "";
  if (!provider) {
    panel.appendChild(createEmptyState("", "Select a provider", "Choose a provider from the list to view details, or add a new one."));
    return;
  }

  const maskedKey = provider.api_key ? `${provider.api_key.slice(0, 6)}...${provider.api_key.slice(-4)}` : "—";
  panel.innerHTML = `
    <div class="provider-detail-card">
      <div class="provider-detail-header">
        <div class="provider-detail-name">${escapeHtml(provider.name)}</div>
        <span class="badge badge-active badge-dot">Connected</span>
      </div>
      <div class="inspector-section">
        <div class="inspector-section-title">Configuration</div>
        <div class="inspector-row"><span class="label">Type</span><span class="value">${escapeHtml(provider.type)}</span></div>
        <div class="inspector-row"><span class="label">Model</span><span class="value">${escapeHtml(provider.model || "—")}</span></div>
        <div class="inspector-row"><span class="label">API Key</span><span class="value font-11">${escapeHtml(maskedKey)}</span></div>
        ${provider.base_url ? `<div class="inspector-row"><span class="label">Base URL</span><span class="value font-11">${escapeHtml(provider.base_url)}</span></div>` : ""}
      </div>
      <div class="inspector-section">
        <div class="inspector-section-title">Metadata</div>
        <div class="inspector-row"><span class="label">Created</span><span class="value">${provider.created_at ? new Date(provider.created_at).toLocaleDateString() : "—"}</span></div>
        <div class="inspector-row"><span class="label">Updated</span><span class="value">${provider.updated_at ? new Date(provider.updated_at).toLocaleDateString() : "—"}</span></div>
      </div>
      <div class="provider-detail-actions">
        <button class="btn btn-secondary btn-sm" data-action="test">Test Connection</button>
        <button class="btn btn-danger btn-sm" data-action="delete">Delete</button>
      </div>
    </div>
  `;

  panel.querySelector('[data-action="test"]')?.addEventListener("click", async () => {
    const testResp = await window.carbonAPI.invoke({ type: "provider/test", id: provider.id } as any) as any;
    Toast.show(testResp.type === "provider/test.success" ? String(testResp.status) : String(testResp.error), testResp.type === "provider/test.success" ? "success" : "error");
  });

  panel.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
    const confirmed = await Modal.confirm("Delete provider?", `Remove \"${provider.name}\"?`);
    if (!confirmed) return;
    try {
      await window.carbonAPI.invoke({ type: "provider/delete", id: provider.id } as any);
      Toast.show("Provider deleted", "success");
      void renderProviderList();
      showProviderDetail(panel, null);
    } catch (error: unknown) {
      Toast.show(`Delete failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });
}

function showProviderCreateForm(panel: HTMLElement): void {
  panel.innerHTML = "";

  const typeSelect = createSelect([
    { value: "anthropic", label: "Anthropic (Claude) — best for reasoning" },
    { value: "openai", label: "OpenAI (GPT) — best for general tasks" },
    { value: "custom-openai", label: "Custom OpenAI-compatible" },
  ], "Select type...");
  const nameInput = createInput("e.g., My Claude Key");
  const keyInput = createInput("sk-...", "password");
  const modelInput = createInput("e.g., claude-sonnet-4-20250514");
  const baseUrlInput = createInput("http://localhost:1234/v1");

  const baseUrlGroup = document.createElement("div");
  baseUrlGroup.className = "toggle-group";
  baseUrlGroup.appendChild(createFormGroup("Base URL", baseUrlInput));

  panel.append(
    createFormGroup("Type", typeSelect),
    createFormGroup("Name", nameInput),
    createFormGroup("API Key", keyInput),
    createFormGroup("Model", modelInput),
    baseUrlGroup,
  );

  const saveBtn = createButton("Save Provider", "primary");
  saveBtn.className = "btn btn-primary w-100 mt-8";
  panel.appendChild(saveBtn);

  typeSelect.addEventListener("change", () => {
    baseUrlGroup.classList.toggle("visible", typeSelect.value === "custom-openai");
  });

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
      const resp = await window.carbonAPI.invoke({
        type: "provider/create",
        data: {
          type: typeSelect.value,
          name: nameInput.value.trim(),
          apiKey: keyInput.value.trim(),
          baseUrl: typeSelect.value === "custom-openai" ? baseUrlInput.value.trim() || undefined : undefined,
          model: modelInput.value.trim(),
        },
      } as any) as any;
      if (resp.type === "error") {
        Toast.show(String(resp.error), "error");
      } else {
        Toast.show("Provider saved", "success");
        void renderProviderList();
        showProviderDetail(panel, resp.provider || null);
      }
    } catch (error: unknown) {
      Toast.show(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Provider";
    }
  });
}

async function renderProviderList(): Promise<void> {
  const list = document.getElementById("provider-list");
  const detail = document.getElementById("provider-detail");
  if (!list || !detail) return;

  const providers = await loadProviders();
  list.innerHTML = "";
  if (providers.length === 0) {
    list.appendChild(createEmptyState("", "No providers configured", "Add an AI provider to get started."));
    return;
  }

  for (const provider of providers) {
    const item = createListItem(provider.name, `${provider.type} — ${provider.model || "Default model"}`);
    item.querySelector(".list-item-info")?.prepend(createStatusDot("active"));
    const health = createBadge("Connected", "active");
    item.querySelector(".list-item-info")?.appendChild(health);
    item.addEventListener("click", () => {
      list.querySelectorAll(".list-item").forEach((element) => element.classList.remove("selected"));
      item.classList.add("selected");
      showProviderDetail(detail, provider);
    });
    list.appendChild(item);
  }

  appState.providers = providers;
}
