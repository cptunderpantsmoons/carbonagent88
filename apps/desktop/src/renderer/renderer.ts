import { renderAXTree } from "./axtree.js";
import { clearInspector, clearChat, closeLiveViewport, loadProviders, loadWorkspaces, setProviderLabel, setWorkspaceLabel, Toast, openRunInspector } from "./view-helpers.js";
import { icon } from "./icons.js";
import { renderTopology } from "./topology.js";
import { renderVault } from "./vault.js";
import { renderWatcherAnalytics } from "./watcher-analytics.js";
import { renderHarnesses } from "./views/harnesses-view.js";
import { renderIngestion } from "./views/ingestion-view.js";
import { renderOutputs } from "./views/outputs-view.js";
import { renderPlayground } from "./views/playground-view.js";
import { renderProfiles } from "./views/profiles-view.js";
import { renderProviders } from "./views/providers-view.js";
import { cleanupSessionView, renderSessionView } from "./views/session-view.js";
import { renderSkills } from "./views/skills-view.js";
import { renderWatchers } from "./views/watchers-view.js";
import { renderWorkspaces } from "./views/workspaces-view.js";
import { renderLogin } from "./views/login-view.js";

type ViewModule = {
  render(container: HTMLElement): void;
  onShow?: () => void;
  onHide?: () => void;
};

type CommandPaletteItem = {
  group: string;
  iconName: string;
  label: string;
  action: () => void;
  shortcut: string;
};

const views = new Map<string, ViewModule>();
let cmdkSelectedIndex = -1;
let cmdkFilteredItems: CommandPaletteItem[] = [];

function registerView(name: string, mod: ViewModule): void {
  views.set(name, mod);
}

function getActiveView(): string {
  const active = document.querySelector(".nav-item.active");
  return active?.getAttribute("data-view") || "playground";
}

function setActiveView(name: string): void {
  document.querySelectorAll(".nav-item").forEach((element) => {
    element.classList.toggle("active", element.getAttribute("data-view") === name);
  });

  clearInspector();
  const pageTitle = document.getElementById("page-title");
  if (pageTitle) pageTitle.textContent = titleMap[name] || name;

  const content = document.getElementById("content");
  if (!content) return;
  content.innerHTML = "";

  const view = views.get(name);
  view?.render(content);
  view?.onShow?.();
}

const titleMap: Record<string, string> = {
  playground: "Playground",
  sessions: "Sessions",
  harnesses: "Harnesses",
  providers: "AI Providers",
  profiles: "Cloak Bridge",
  workspaces: "Workspaces",
  ingestion: "Ingestion",
  vault: "Knowledge Vault",
  skills: "Learned Skills",
  watchers: "Watchers",
  outputs: "Outputs",
  topology: "Agent Topology",
  axtree: "AXTree Inspector",
  "watcher-analytics": "Watcher Analytics",
};

function initNavigation(): void {
  document.querySelectorAll(".nav-item").forEach((element) => {
    element.addEventListener("click", () => {
      const viewName = element.getAttribute("data-view");
      if (!viewName) return;
      const current = getActiveView();
      if (current !== viewName) views.get(current)?.onHide?.();
      setActiveView(viewName);
    });
  });
}

function getCommandPaletteItems(): CommandPaletteItem[] {
  return [
    { group: "Navigation", iconName: "playground", label: "Go to Playground", action: () => setActiveView("playground"), shortcut: "G P" },
    { group: "Navigation", iconName: "sessions", label: "Go to Sessions", action: () => setActiveView("sessions"), shortcut: "G E" },
    { group: "Navigation", iconName: "harnesses", label: "Go to Harnesses", action: () => setActiveView("harnesses"), shortcut: "G H" },
    { group: "Navigation", iconName: "providers", label: "Go to AI Providers", action: () => setActiveView("providers"), shortcut: "G A" },
    { group: "Navigation", iconName: "profiles", label: "Go to Cloak Bridge", action: () => setActiveView("profiles"), shortcut: "G C" },
    { group: "Navigation", iconName: "workspaces", label: "Go to Workspaces", action: () => setActiveView("workspaces"), shortcut: "G W" },
    { group: "Navigation", iconName: "ingestion", label: "Go to Ingestion", action: () => setActiveView("ingestion"), shortcut: "G I" },
    { group: "Navigation", iconName: "vault", label: "Go to Knowledge Vault", action: () => setActiveView("vault"), shortcut: "G V" },
    { group: "Navigation", iconName: "skills", label: "Go to Learned Skills", action: () => setActiveView("skills"), shortcut: "G S" },
    { group: "Navigation", iconName: "watchers", label: "Go to Watchers", action: () => setActiveView("watchers"), shortcut: "G T" },
    { group: "Navigation", iconName: "outputs", label: "Go to Outputs", action: () => setActiveView("outputs"), shortcut: "G O" },
    { group: "Navigation", iconName: "topology", label: "Go to Agent Topology", action: () => setActiveView("topology"), shortcut: "G Y" },
    { group: "Navigation", iconName: "axtree", label: "Go to AXTree Inspector", action: () => setActiveView("axtree"), shortcut: "G X" },
    { group: "Navigation", iconName: "analytics", label: "Go to Watcher Analytics", action: () => setActiveView("watcher-analytics"), shortcut: "G U" },
    { group: "Actions", iconName: "plus", label: "Create Vault Note", action: () => { setActiveView("vault"); Toast.show("Open a workspace to create a note", "info"); }, shortcut: "N N" },
    { group: "Actions", iconName: "switch", label: "Switch Workspace", action: () => document.getElementById("workspace-selector")?.focus(), shortcut: "W W" },
    { group: "Actions", iconName: "launch", label: "Launch Browser Profile", action: () => { setActiveView("profiles"); Toast.show("Choose a profile to launch", "info"); }, shortcut: "L L" },
    { group: "Actions", iconName: "clear", label: "Clear Chat", action: () => { clearChat(); Toast.show("Chat cleared", "info"); }, shortcut: "K K" },
    { group: "Actions", iconName: "settings", label: "Open Settings", action: () => { setActiveView("providers"); Toast.show("Settings opened in AI Providers tab", "info"); }, shortcut: "S S" },
  ];
}

function openCommandPalette(): void {
  const backdrop = document.getElementById("cmdk-backdrop");
  const input = document.getElementById("cmdk-input") as HTMLInputElement | null;
  const results = document.getElementById("cmdk-results");
  if (!backdrop || !input || !results) return;
  backdrop.classList.add("open");
  input.value = "";
  input.focus();
  renderCmdkResults(results, "");
}

function closeCommandPalette(): void {
  document.getElementById("cmdk-backdrop")?.classList.remove("open");
}

function updateCmdkSelection(results: HTMLElement): void {
  const items = results.querySelectorAll<HTMLElement>(".cmdk-item");
  items.forEach((element, idx) => {
    element.classList.toggle("selected", idx === cmdkSelectedIndex);
  });
  items[cmdkSelectedIndex]?.scrollIntoView({ block: "nearest" });
}

function renderCmdkResults(container: HTMLElement, query: string): void {
  const q = query.toLowerCase();
  const allItems = getCommandPaletteItems();
  cmdkFilteredItems = allItems.filter((item) => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q));
  const groups = cmdkFilteredItems.reduce<Record<string, CommandPaletteItem[]>>((acc, item) => {
    acc[item.group] ||= [];
    acc[item.group].push(item);
    return acc;
  }, {});

  container.innerHTML = "";
  let flatIndex = 0;
  Object.entries(groups).forEach(([groupName, items]) => {
    const groupEl = document.createElement("div");
    groupEl.className = "cmdk-group";
    groupEl.innerHTML = `<div class="cmdk-group-label">${groupName}</div>`;
    items.forEach((item) => {
      const element = document.createElement("div");
      element.className = "cmdk-item";
      element.dataset.index = String(flatIndex);
      element.innerHTML = `${icon(item.iconName, "cmdk-item-icon")}<span>${item.label}</span><span class="cmdk-item-meta">${item.shortcut}</span>`;
      element.addEventListener("click", () => {
        closeCommandPalette();
        item.action();
      });
      element.addEventListener("mouseenter", () => {
        cmdkSelectedIndex = Number(element.dataset.index);
        updateCmdkSelection(container);
      });
      groupEl.appendChild(element);
      flatIndex += 1;
    });
    container.appendChild(groupEl);
  });

  cmdkSelectedIndex = cmdkFilteredItems.length > 0 ? 0 : -1;
  updateCmdkSelection(container);
}

function initCommandPalette(): void {
  const trigger = document.getElementById("cmdk-trigger");
  const backdrop = document.getElementById("cmdk-backdrop");
  const input = document.getElementById("cmdk-input") as HTMLInputElement | null;
  const results = document.getElementById("cmdk-results");
  if (!trigger || !backdrop || !input || !results) return;

  trigger.addEventListener("click", openCommandPalette);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeCommandPalette();
  });
  input.addEventListener("input", (event) => {
    renderCmdkResults(results, (event.target as HTMLInputElement).value);
  });
  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      cmdkSelectedIndex = Math.min(cmdkSelectedIndex + 1, cmdkFilteredItems.length - 1);
      updateCmdkSelection(results);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      cmdkSelectedIndex = Math.max(cmdkSelectedIndex - 1, 0);
      updateCmdkSelection(results);
    }
    if (event.key === "Enter" && cmdkSelectedIndex >= 0 && cmdkFilteredItems[cmdkSelectedIndex]) {
      event.preventDefault();
      closeCommandPalette();
      cmdkFilteredItems[cmdkSelectedIndex]?.action();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommandPalette();
    }
  });
}

function initOverlayChrome(): void {
  document.getElementById("inspector-close")?.addEventListener("click", clearInspector);
  document.getElementById("live-viewport-close")?.addEventListener("click", closeLiveViewport);
  document.getElementById("run-inspector-close")?.addEventListener("click", () => {
    const modal = document.getElementById("run-inspector-modal");
    modal?.classList.remove("open");
    modal?.classList.add("invisible");
  });
  document.getElementById("run-inspector-modal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      const modal = event.currentTarget as HTMLElement;
      modal.classList.remove("open");
      modal.classList.add("invisible");
    }
  });
}

async function hydrateTopBar(): Promise<void> {
  try {
    const providers = await loadProviders();
    if (providers.length > 0) setProviderLabel(providers[0]?.name || "Connected");
  } catch {
    // noop
  }

  try {
    const workspaces = await loadWorkspaces();
    if (workspaces.length > 0) setWorkspaceLabel(workspaces[0]?.name || "Workspace");
  } catch {
    // noop
  }
}

function initStatsPolling(): void {
  setInterval(() => {
    void window.carbonAPI.invoke({ type: "stats/list" }).then((response: unknown) => {
      const r = response as { type: string; activeRuns?: number };
      if (r.type === "stats/list.success") {
        const activeRuns = document.getElementById("active-runs-count");
        if (activeRuns) activeRuns.textContent = String(r.activeRuns ?? 0);
      }
    }).catch(() => undefined);
  }, 5000);
}

function initNavIcons(): void {
  const viewIconMap: Record<string, string> = {
    playground: "playground",
    sessions: "sessions",
    vault: "vault",
    watchers: "watchers",
    workspaces: "workspaces",
    ingestion: "ingestion",
    outputs: "outputs",
    harnesses: "harnesses",
    providers: "providers",
    profiles: "profiles",
    skills: "skills",
    topology: "topology",
    axtree: "axtree",
    "watcher-analytics": "analytics",
  };
  document.querySelectorAll(".nav-item").forEach((element) => {
    const viewName = element.getAttribute("data-view");
    const target = element.querySelector(".nav-icon");
    if (!target || !viewName) return;
    const iconName = viewIconMap[viewName] || "empty";
    target.innerHTML = icon(iconName, "nav-icon");
  });
}

export async function refreshSession(): Promise<void> {
  const token = sessionStorage.getItem("carbonAuthToken");
  const content = document.getElementById("content");
  if (!token) {
    if (content) {
      renderLogin(content, () => void refreshSession());
    }
    return;
  }

  try {
    const resp = await window.carbonAPI.invoke({ type: "auth/me", authToken: token }) as { type: string; data?: { email?: string }; error?: string };
    if (resp.type !== "auth/session.success") {
      sessionStorage.removeItem("carbonAuthToken");
      if (content) renderLogin(content, () => void refreshSession());
      return;
    }
  } catch {
    sessionStorage.removeItem("carbonAuthToken");
    if (content) renderLogin(content, () => void refreshSession());
    return;
  }

  await hydrateTopBar();
}

async function init(): Promise<void> {
  initNavigation();
  initNavIcons();
  initOverlayChrome();
  initCommandPalette();

  registerView("playground", { render: renderPlayground });
  registerView("sessions", { render: renderSessionView, onHide: cleanupSessionView });
  registerView("harnesses", { render: renderHarnesses });
  registerView("providers", { render: renderProviders });
  registerView("profiles", { render: renderProfiles });
  registerView("workspaces", { render: renderWorkspaces });
  registerView("ingestion", { render: renderIngestion });
  registerView("vault", { render: renderVault });
  registerView("skills", { render: renderSkills });
  registerView("watchers", { render: renderWatchers });
  registerView("outputs", { render: renderOutputs });
  registerView("topology", { render: renderTopology });
  registerView("axtree", { render: renderAXTree });
  registerView("watcher-analytics", { render: renderWatcherAnalytics });

  initStatsPolling();

  const token = sessionStorage.getItem("carbonAuthToken");
  if (!token) {
    const content = document.getElementById("content");
    if (content) renderLogin(content, () => void refreshSession());
    return;
  }

  setActiveView("playground");
  await hydrateTopBar();

  (window as unknown as Record<string, unknown>).__rendererReady = true;
  (window as unknown as Record<string, unknown>).__setActiveView__ = setActiveView;
  (window as unknown as Record<string, unknown>).__openRunInspector__ = (runId: string) => void openRunInspector(runId);
}

void init();
