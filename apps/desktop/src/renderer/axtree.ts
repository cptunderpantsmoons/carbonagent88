/**
 * AXTree Inspector Panel — Render semantic accessibility tree
 */

import { Toast, createEmptyState } from "./components.js";

interface AXTreeNode {
  role: string;
  name?: string;
  value?: string;
  axNodeId?: string;
  children?: AXTreeNode[];
}

let currentTree: AXTreeNode = { role: "document", axNodeId: "ax_0" };
let activeNodeId = "";
let hasReceivedAXTreeData = false;

function renderTreeNode(node: AXTreeNode, container: HTMLElement, depth = 0) {
  const el = document.createElement("div");
  el.className = "axtree-node" + (node.axNodeId === activeNodeId ? " axtree-active" : "");
  el.classList.add(`axtree-depth-${depth}`);

  const roleBadge = document.createElement("span");
  roleBadge.className = "axtree-role";
  roleBadge.textContent = node.role;

  const nameSpan = document.createElement("span");
  nameSpan.className = "axtree-name";
  nameSpan.textContent = node.name ?? "";

  const idSpan = document.createElement("span");
  idSpan.className = "axtree-id";
  idSpan.textContent = node.axNodeId ?? "";

  const copyBtn = document.createElement("button");
  copyBtn.className = "axtree-selector-btn";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Copy Playwright selector to clipboard";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const role = node.role;
    const name = node.name ?? "";
    const selector = name ? `role=${role}[name="${name}"]` : `role=${role}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(selector).then(() => Toast.show("Copied selector: " + selector, "success", 2000)).catch(() => Toast.show("Copy failed", "error", 2000));
    } else {
      Toast.show(`Selector: ${selector}`, "info", 4000);
    }
  });

  el.appendChild(roleBadge);
  el.appendChild(nameSpan);
  el.appendChild(idSpan);
  el.appendChild(copyBtn);

  if (node.children && node.children.length > 0) {
    const toggle = document.createElement("span");
    toggle.className = "axtree-toggle collapsed";
    el.prepend(toggle);

    const childrenContainer = document.createElement("div");
    childrenContainer.className = "axtree-children";
    for (const child of node.children) {
      renderTreeNode(child, childrenContainer, depth + 1);
    }

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      childrenContainer.classList.toggle("collapsed");
      toggle.classList.toggle("collapsed");
    });

    container.appendChild(el);
    container.appendChild(childrenContainer);
  } else {
    container.appendChild(el);
  }
}

export function renderAXTree(container: HTMLElement): void {
  container.innerHTML = `
    <div class="axtree-header">
      <h2>AXTree Inspector</h2>
      <span class="axtree-status" id="axtree-status">No data</span>
    </div>
    <div id="axtree-empty" class="axtree-empty"></div>
    <div class="axtree-body" id="axtree-body"></div>
  `;

  const body = container.querySelector("#axtree-body") as HTMLElement;
  const empty = container.querySelector("#axtree-empty") as HTMLElement;

  function updateEmptyState() {
    if (!hasReceivedAXTreeData) {
      empty.innerHTML = "";
      empty.appendChild(createEmptyState("icon-axtree", "No AXTree Data", "Lock a browser profile to inspect the semantic accessibility tree."));
      empty.classList.remove('invisible');
      body.classList.add('invisible');
    } else {
      empty.classList.add('invisible');
      body.classList.remove('invisible');
    }
  }

  function refresh() {
    body.innerHTML = "";
    renderTreeNode(currentTree, body);
  }

  updateEmptyState();

  if (!window.carbonAPI.onAXTree) {
    const statusEl = container.querySelector("#axtree-status") as HTMLElement | null;
    if (statusEl) statusEl.textContent = "Live AXTree unavailable";
    return;
  }

  window.carbonAPI.onAXTree((data: unknown) => {
    const typed = data as { tree: AXTreeNode; activeNodeId?: string };
    hasReceivedAXTreeData = true;
    currentTree = typed.tree;
    activeNodeId = typed.activeNodeId ?? "";
    const status = container.querySelector("#axtree-status") as HTMLElement;
    status.textContent = activeNodeId ? `Active: ${activeNodeId}` : "No active node";
    updateEmptyState();
    refresh();
  });
}
