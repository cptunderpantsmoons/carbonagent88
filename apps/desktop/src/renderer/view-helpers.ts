import { createEmptyState } from "./components.js";
import { Toast, Modal } from "./ui-components.js";

export type WorkspaceRecord = { id: string; name: string; description?: string; vault_dir?: string; vaultDir?: string };
export type ProviderRecord = { id: string; name: string; type: string; model?: string; api_key?: string; base_url?: string; created_at?: string; updated_at?: string };
export type ProfileRecord = {
  id: string;
  name: string;
  status?: string;
  profile_dir?: string;
  cdp_url?: string;
  cdp_fingerprint?: string;
  target_domains?: string[] | string;
  last_checked_at?: string;
  last_run_at?: string;
};

export const appState = {
  currentConversationId: null as string | null,
  currentWorkspaceId: null as string | null,
  currentRunId: null as string | null,
  currentSessionId: null as string | null,
  currentProfileId: null as string | null,
  workspaces: [] as WorkspaceRecord[],
  providers: [] as ProviderRecord[],
  profileList: [] as ProfileRecord[],
  viewportCleanup: null as null | (() => void),
};

export { Toast, Modal, createEmptyState };

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function createCard(title: string, subtitle?: string): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "card";

  if (title) {
    const header = document.createElement("div");
    header.className = "card-header";
    const titleEl = document.createElement("div");
    titleEl.className = "card-title";
    titleEl.textContent = title;
    header.appendChild(titleEl);
    card.appendChild(header);
  }

  if (subtitle) {
    const sub = document.createElement("div");
    sub.className = "card-subtitle";
    sub.textContent = subtitle;
    card.appendChild(sub);
  }

  return card;
}

export function createButton(label: string, variant: "primary" | "secondary" | "danger" | "ghost" = "primary", size: "md" | "sm" = "md", disabled = false): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `btn btn-${variant} btn-${size}`;
  btn.textContent = label;
  btn.disabled = disabled;
  return btn;
}

export function createInput(placeholder?: string, type: "text" | "password" | "email" = "text"): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  input.className = "form-input";
  if (placeholder) input.placeholder = placeholder;
  return input;
}

export function createSelect(options: { value: string; label: string }[], placeholder?: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "form-select";
  if (placeholder) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    select.appendChild(option);
  }
  return select;
}

export function createFormGroup(label: string, control: HTMLElement, hint?: string): HTMLDivElement {
  const group = document.createElement("div");
  group.className = "form-group";
  const labelEl = document.createElement("label");
  labelEl.className = "form-label";
  labelEl.textContent = label;
  group.appendChild(labelEl);
  group.appendChild(control);
  if (hint) {
    const hintEl = document.createElement("div");
    hintEl.className = "form-hint";
    hintEl.textContent = hint;
    group.appendChild(hintEl);
  }
  return group;
}

export function createBadge(text: string, state: string): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = `badge badge-${state}`;
  if (["active", "expired", "completed", "failed", "pending", "unknown"].includes(state)) {
    badge.classList.add("badge-dot");
  }
  badge.textContent = text;
  return badge;
}

export function createListItem(title: string, subtitle?: string, meta?: string): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "list-item";

  const info = document.createElement("div");
  info.className = "list-item-info";

  const titleEl = document.createElement("div");
  titleEl.className = "list-item-title";
  titleEl.textContent = title;
  info.appendChild(titleEl);

  if (subtitle) {
    const sub = document.createElement("div");
    sub.className = "list-item-subtitle";
    sub.textContent = subtitle;
    info.appendChild(sub);
  }

  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "list-item-meta";
    metaEl.textContent = meta;
    info.appendChild(metaEl);
  }

  item.appendChild(info);
  return item;
}

export function createChatMessage(role: "user" | "assistant" | "system", text: string): HTMLDivElement {
  const msg = document.createElement("div");
  msg.className = `chat-message ${role}`;
  const content = document.createElement("div");
  content.textContent = text;
  msg.appendChild(content);
  return msg;
}

export function createStatusDot(state: string): HTMLSpanElement {
  const dot = document.createElement("span");
  const cls = state === "active" || state === "completed"
    ? "status-dot-success"
    : state === "expired" || state === "failed"
      ? "status-dot-danger"
      : state === "running" || state === "pending"
        ? "status-dot-warning"
        : "status-dot-muted";
  dot.className = `status-dot ${cls}`;
  return dot;
}

export function populateSelect<T extends { id: string }>(select: HTMLSelectElement, items: T[], labelFn: (item: T) => string, placeholder: string): void {
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
    items.map((item) => `<option value="${item.id}">${escapeHtml(labelFn(item))}</option>`).join("");
}

export function addSystemMessage(container: HTMLElement, text: string): void {
  container.appendChild(createChatMessage("system", text));
  container.scrollTop = container.scrollHeight;
}

export function clearChat(): void {
  document.querySelector(".chat-messages")?.replaceChildren();
}

export function openInspector(): void {
  document.getElementById("inspector")?.classList.add("open");
}

export function closeInspector(): void {
  document.getElementById("inspector")?.classList.remove("open");
}

export function setInspectorContent(html: string): void {
  const body = document.getElementById("inspector-body");
  if (!body) return;
  body.innerHTML = html;
  openInspector();
}

export function clearInspector(): void {
  const body = document.getElementById("inspector-body");
  if (body) body.innerHTML = "";
  closeInspector();
}

export function setWorkspaceLabel(label: string): void {
  const el = document.getElementById("top-bar-workspace-label");
  if (el) el.textContent = label;
}

export function setProviderLabel(label: string): void {
  const el = document.getElementById("top-bar-provider-label");
  if (el) el.textContent = label;
}

export async function loadWorkspaces(): Promise<WorkspaceRecord[]> {
  const resp = await window.carbonAPI.invoke({ type: "workspace/list" } as any) as any;
  if (resp.type === "workspace/list.success") {
    appState.workspaces = resp.data;
    if (!appState.currentWorkspaceId && appState.workspaces.length > 0) {
      appState.currentWorkspaceId = appState.workspaces[0]?.id ?? null;
      if (appState.currentWorkspaceId) {
        setWorkspaceLabel(appState.workspaces[0]?.name || "Workspace");
      }
    }
  }
  return appState.workspaces;
}

export async function loadProviders(): Promise<ProviderRecord[]> {
  const resp = await window.carbonAPI.invoke({ type: "provider/list" } as any) as any;
  if (resp.type === "provider/list.success") {
    appState.providers = resp.data;
  }
  return appState.providers;
}

export async function loadProfiles(): Promise<ProfileRecord[]> {
  const resp = await window.carbonAPI.invoke({ type: "profile/list" } as any) as any;
  if (resp.type === "profile/list.success") {
    appState.profileList = resp.data;
  }
  return appState.profileList;
}

export async function openRunInspector(runId: string): Promise<void> {
  const modal = document.getElementById("run-inspector-modal");
  const body = document.getElementById("run-inspector-body");
  if (!modal || !body) return;

  modal.classList.add("open");
  modal.classList.remove("invisible");
  body.innerHTML = '<div class="skeleton skeleton-block"></div>';

  try {
    const resp = await window.carbonAPI.invoke({ type: "run/events", id: runId } as any) as any;
    if (resp.type !== "run/events.success") {
      body.innerHTML = `<p class="text-danger">Error: ${escapeHtml(resp.error || "Failed to load run events")}</p>`;
      return;
    }

    const events = resp.events ?? [];
    if (events.length === 0) {
      body.innerHTML = '<p class="text-muted">No events recorded for this run.</p>';
      return;
    }

    const timeline = document.createElement("div");
    timeline.className = "run-timeline";
    events.forEach((evtRaw: unknown, idx: number) => {
      const evt = evtRaw as { type?: string; payload?: Record<string, unknown> };
      const step = document.createElement("div");
      step.className = "run-step";
      const payload = evt.payload ?? {};
      const output = payload.output as Record<string, unknown> | undefined;
      const screenshotBase64 = output?.base64 as string | undefined ?? payload.base64 as string | undefined;
      const screenshot = screenshotBase64 ? `<img class="run-step-screenshot" src="data:image/jpeg;base64,${screenshotBase64}" alt="screenshot">` : "";
      step.innerHTML = `
        <div class="run-step-header">
          <span class="run-step-number">#${idx + 1}</span>
          <span class="run-step-type">${escapeHtml(String(evt.type || "event"))}</span>
          ${payload.tool_name ? `<span class="run-step-tool">${escapeHtml(String(payload.tool_name))}</span>` : ""}
        </div>
        <div class="run-step-body">
          ${screenshot}
          <div class="run-step-payload">${escapeHtml(JSON.stringify(payload, null, 2).slice(0, 2000))}</div>
        </div>
      `;
      step.querySelector(".run-step-header")?.addEventListener("click", () => step.classList.toggle("open"));
      timeline.appendChild(step);
    });

    body.innerHTML = "";
    body.appendChild(timeline);
  } catch (error: unknown) {
    body.innerHTML = `<p class="text-danger">Error: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  }
}

export function openLiveViewport(profileId: string): void {
  const panel = document.getElementById("live-viewport");
  const body = document.getElementById("live-viewport-body");
  if (!panel || !body) return;

  appState.currentProfileId = profileId;

  if (appState.viewportCleanup) {
    appState.viewportCleanup();
    appState.viewportCleanup = null;
  }

  panel.classList.add("open");
  body.innerHTML = '<div class="live-viewport-placeholder">Connecting to viewport stream...</div>';

  window.carbonAPI.invoke({ type: "viewport/start", profileId }).then(() => {
    if (!window.carbonAPI.onViewportFrame) {
      body.innerHTML = '<div class="live-viewport-placeholder">Live viewport is not available in this build yet.</div>';
      return;
    }
    appState.viewportCleanup = window.carbonAPI.onViewportFrame((frame: unknown) => {
      const typed = frame as { profileId?: string; mimeType?: string; base64?: string };
      if (typed.profileId === profileId) {
        body.innerHTML = `<img src="data:${typed.mimeType};base64,${typed.base64}" alt="viewport" class="img-viewport">`;
      }
    });
  }).catch((error: unknown) => {
    body.innerHTML = `<div class="live-viewport-placeholder">Error: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  });
}

export function closeLiveViewport(): void {
  document.getElementById("live-viewport")?.classList.remove("open");
  if (appState.viewportCleanup) {
    appState.viewportCleanup();
    appState.viewportCleanup = null;
  }
  // Stop telemetry timers on the main process
  if (appState.currentProfileId) {
    void window.carbonAPI.invoke({ type: "viewport/stop", profileId: appState.currentProfileId } as any);
  }
}
