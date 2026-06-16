/**
 * Obsidian-style Markdown Vault
 *
 * Features:
 * - Split-pane editor / preview with draggable resizer
 * - Breadcrumb navigation
 * - Basic syntax highlighting in editor
 * - [[wikilink]] parsing and backlink resolution
 * - File tree sidebar
 */

import { Toast, appState, createEmptyState, loadWorkspaces } from "./view-helpers.js";

let currentFilePath = "";
let vaultFiles: string[] = [];

/* ── Syntax Highlighting ─────────────────────────────────────────────────── */

function applySyntaxHighlighting(text: string): string {
  let html = escapeHtml(text);

  // Headers
  html = html.replace(/^(#{1,6}\s+)(.*)$/gm, '<span class="sh-heading">$1</span><span class="sh-heading-text">$2</span>');

  // Bold / Italic
  html = html.replace(/(\*\*\*)(.*?)(\*\*\*)/g, '<span class="sh-bold"><span class="sh-italic">$2</span></span>');
  html = html.replace(/(\*\*)(.*?)(\*\*)/g, '<span class="sh-bold">$2</span>');
  html = html.replace(/\b(\*|_)(.*?)\1\b/g, '<span class="sh-italic">$2</span>');

  // Code inline
  html = html.replace(/`([^`]+)`/g, '<span class="sh-code-delim">`</span><span class="sh-code">$1</span><span class="sh-code-delim">`</span>');

  // Code blocks
  html = html.replace(/(```[\w]*)([\s\S]*?)(```)/g, '<span class="sh-codeblock-delim">$1</span><span class="sh-codeblock">$2</span><span class="sh-codeblock-delim">$3</span>');

  // Wikilinks
  html = html.replace(/(\[\[)([^\]]+)(\]\])/g, '<span class="sh-wikilink-delim">$1</span><span class="sh-wikilink">$2</span><span class="sh-wikilink-delim">$3</span>');

  // URLs
  html = html.replace(/(https?:\/\/[^\s]+)/g, '<span class="sh-url">$1</span>');

  return html;
}

async function listVaultFiles(): Promise<string[]> {
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) return [];
  const resp = await window.carbonAPI.invoke({ type: "vault/list", workspaceId } as unknown as Record<string, unknown>);
  return (resp as { files?: string[] }).files ?? [];
}

async function readVaultFile(filePath: string): Promise<string> {
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) return "";
  const resp = await window.carbonAPI.invoke({ type: "vault/read", workspaceId, filePath } as unknown as Record<string, unknown>);
  return (resp as { content?: string }).content ?? "";
}

async function writeVaultFile(filePath: string, content: string): Promise<void> {
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) return;
  await window.carbonAPI.invoke({ type: "vault/write", workspaceId, filePath, content } as unknown as Record<string, unknown>);
}

async function resolveWorkspaceId(): Promise<string | null> {
  if (appState.currentWorkspaceId) return appState.currentWorkspaceId;
  const workspaces = await loadWorkspaces();
  if (appState.currentWorkspaceId) return appState.currentWorkspaceId;
  return workspaces[0]?.id ?? null;
}

function parseWikilinks(content: string): string[] {
  const matches: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    matches.push(m[1]!);
  }
  return matches;
}

function resolveBacklinks(filePath: string, allFiles: string[], contents: Map<string, string>): string[] {
  const base = filePath.replace(/\.md$/, "");
  const backlinks: string[] = [];
  for (const f of allFiles) {
    const c = contents.get(f) ?? "";
    const links = parseWikilinks(c);
    if (links.some(l => l === base || l === filePath)) {
      backlinks.push(f);
    }
  }
  return backlinks;
}

function markdownToHtml(content: string, allFiles: string[]): string {
  let html = escapeHtml(content)
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.*)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*)\*/gim, "<em>$1</em>")
    .replace(/```([\s\S]*?)```/gim, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/gim, "<code>$1</code>")
    .replace(/\n/gim, "<br>");

  // Resolve wikilinks
  html = html.replace(/\[\[([^\]]+)\]\]/gim, (_match, p1) => {
    const target = allFiles.find(f => f.replace(/\.md$/, "") === p1 || f === p1);
    if (target) {
      return `<a href="#" class="wikilink" data-target="${target}">[[${p1}]]</a>`;
    }
    return `<span class="wikilink-unresolved">[[${p1}]]</span>`;
  });

  return html;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function buildBreadcrumbHTML(filePath: string): string {
  if (!filePath) return '';
  const segments = filePath.split('/');
  const crumbs = segments.map((segment, i) => {
    const pathSoFar = segments.slice(0, i + 1).join('/');
    const isLast = i === segments.length - 1;
    const clz = isLast ? 'vault-breadcrumb-item vault-breadcrumb-active' : 'vault-breadcrumb-item';
    return `<span class="${clz}" data-path="${pathSoFar}">${segment}</span>`;
  });
  const sep = '<span class="vault-breadcrumb-sep">/</span>';
  return crumbs.join(sep);
}

export function renderVault(container: HTMLElement): void {
  container.innerHTML = `
    <div class="vault-layout">
      <div class="vault-sidebar" id="vault-sidebar">
        <input type="text" class="form-input vault-search" id="vault-search" placeholder="Search files...">
        <div class="vault-file-tree" id="vault-file-tree"></div>
      </div>
      <div class="vault-editor-pane">
        <div class="vault-toolbar">
          <button class="btn btn-sm btn-secondary" id="vault-new-file">+ New Note</button>
          <div class="vault-breadcrumb" id="vault-breadcrumb"></div>
          <span id="vault-current-file" class="vault-file-label"></span>
        </div>
        <div class="vault-split" id="vault-split">
          <div class="vault-editor-wrap" id="vault-editor-wrap">
            <pre class="vault-highlighter" id="vault-highlighter" aria-hidden="true"></pre>
            <textarea class="vault-editor" id="vault-editor" placeholder="Write markdown..." spellcheck="false"></textarea>
          </div>
          <div class="vault-split-resizer" id="vault-split-resizer"></div>
          <div class="vault-preview" id="vault-preview"></div>
        </div>
      </div>
      <div class="vault-right-panel">
        <div class="vault-outgoing" id="vault-outgoing"></div>
        <div class="vault-backlinks" id="vault-backlinks"></div>
      </div>
    </div>
  `;

  const searchInput = container.querySelector("#vault-search") as HTMLInputElement;
  const fileTree = container.querySelector("#vault-file-tree") as HTMLElement;
  const editor = container.querySelector("#vault-editor") as HTMLTextAreaElement;
  const highlighter = container.querySelector("#vault-highlighter") as HTMLElement;
  const editorWrap = container.querySelector("#vault-editor-wrap") as HTMLElement;
  const resizer = container.querySelector("#vault-split-resizer") as HTMLElement;
  const preview = container.querySelector("#vault-preview") as HTMLElement;
  const backlinksEl = container.querySelector("#vault-backlinks") as HTMLElement;
  const outgoingEl = container.querySelector("#vault-outgoing") as HTMLElement;
  const currentFileLabel = container.querySelector("#vault-current-file") as HTMLElement;
  const breadcrumbEl = container.querySelector("#vault-breadcrumb") as HTMLElement;
  const splitContainer = container.querySelector("#vault-split") as HTMLElement;

  async function refreshFiles(filter?: string) {
    vaultFiles = await listVaultFiles();
    if (vaultFiles.length === 0 && !await resolveWorkspaceId()) {
      fileTree.innerHTML = "";
      fileTree.appendChild(createEmptyState("workspaces", "Select a workspace", "Choose a workspace to open the vault."));
      return;
    }
    const filtered = filter ? vaultFiles.filter(f => f.toLowerCase().includes(filter.toLowerCase())) : vaultFiles;
    if (filtered.length === 0) {
      fileTree.innerHTML = "";
      fileTree.appendChild(createEmptyState("vault", filter ? "No matches" : "Empty Vault", filter ? "No files match your search." : "Create a new note to start building your knowledge base."));
      return;
    }
    fileTree.innerHTML = filtered.map(f => `
      <div class="vault-file-item ${f === currentFilePath ? "active" : ""}" data-path="${f}">
        ${f.replace(/\.md$/, "")}
      </div>
    `).join("");
    fileTree.querySelectorAll(".vault-file-item").forEach(el => {
      el.addEventListener("click", async () => {
        currentFilePath = el.getAttribute("data-path")!;
        await loadFile(currentFilePath);
      });
    });
  }

  // Search filtering
  searchInput.addEventListener("input", () => {
    refreshFiles(searchInput.value);
  });

  /* ── Split-Pane Resizer Drag Logic ─────────────────────────────────────── */
  let isDragging = false;

  function updateEditorSize(leftPercent: number) {
    editorWrap.style.flex = `0 0 ${leftPercent}%`;
    preview.style.flex = `0 0 ${99 - leftPercent}%`;
  }

  resizer.addEventListener("mousedown", () => {
    isDragging = true;
    resizer.classList.add("dragging");
    document.body.classList.add("is-resizing");
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const rect = splitContainer.getBoundingClientRect();
    const leftPercent = Math.max(20, Math.min(80, ((e.clientX - rect.left) / rect.width) * 100));
    updateEditorSize(leftPercent);
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    resizer.classList.remove("dragging");
    document.body.classList.remove("is-resizing");
  });

  resizer.addEventListener("dblclick", () => {
    updateEditorSize(50);
  });

  /* ── Syntax Highlighting Sync ──────────────────────────────────────────── */
  function syncHighlighter() {
    highlighter.innerHTML = applySyntaxHighlighting(editor.value + "\n");
  }

  editor.addEventListener("scroll", () => {
    highlighter.scrollTop = editor.scrollTop;
    highlighter.scrollLeft = editor.scrollLeft;
  });

  function syncEditorSize() {
    highlighter.style.height = editor.clientHeight + "px";
    highlighter.style.width = editor.clientWidth + "px";
  }

  async function loadFile(filePath: string) {
    currentFilePath = filePath;
    const content = await readVaultFile(filePath);
    editor.value = content;
    currentFileLabel.textContent = filePath;
    breadcrumbEl.innerHTML = buildBreadcrumbHTML(filePath);
    breadcrumbEl.querySelectorAll(".vault-breadcrumb-item").forEach(el => {
      el.addEventListener("click", async () => {
        const target = el.getAttribute("data-path")!;
        if (target !== currentFilePath) {
          await loadFile(target);
        }
      });
    });
    updatePreview(content);
    syncHighlighter();
    syncEditorSize();
    await updateOutgoingLinks();
    await updateBacklinks();
    await refreshFiles();
  }

  function updatePreview(content: string) {
    preview.innerHTML = markdownToHtml(content, vaultFiles);
    preview.querySelectorAll(".wikilink").forEach(el => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const target = (el as HTMLElement).getAttribute("data-target")!;
        loadFile(target);
      });
    });
  }

  async function updateOutgoingLinks() {
    if (!currentFilePath) { outgoingEl.innerHTML = ""; return; }
    const content = editor.value;
    const links = parseWikilinks(content);
    outgoingEl.innerHTML = `<div class="vault-panel-section-title">Outgoing Links</div>` +
      (links.length === 0 ? "<div class='vault-backlinks-empty'>No outgoing links</div>":
        links.map(l => {
          const target = vaultFiles.find(f => f.replace(/\.md$/, "") === l || f === l);
          if (target) {
            return `<div class="vault-backlink-item vault-wikilink-resolved" data-path="${target}">${l}</div>`;
          }
          return `<div class="vault-backlink-item vault-wikilink-unresolved">${l}</div>`;
        }).join(""));
    outgoingEl.querySelectorAll(".vault-wikilink-resolved").forEach(el => {
      el.addEventListener("click", async () => {
        await loadFile(el.getAttribute("data-path")!);
      });
    });
  }

  async function updateBacklinks() {
    if (!currentFilePath) { backlinksEl.innerHTML = ""; return; }
    const contents = new Map<string, string>();
    for (const f of vaultFiles) {
      contents.set(f, await readVaultFile(f));
    }
    const bl = resolveBacklinks(currentFilePath, vaultFiles, contents);
    backlinksEl.innerHTML = `<div class="vault-panel-section-title">Backlinks</div>` +
      (bl.length === 0 ? "<div class='vault-backlinks-empty'>No backlinks</div>":
        bl.map(f => `<div class="vault-backlink-item" data-path="${f}">${f.replace(/\.md$/, "")}</div>`).join(""));
    backlinksEl.querySelectorAll(".vault-backlink-item").forEach(el => {
      el.addEventListener("click", async () => {
        await loadFile(el.getAttribute("data-path")!);
      });
    });
  }

  editor.addEventListener("input", async () => {
    const content = editor.value;
    if (currentFilePath) {
      await writeVaultFile(currentFilePath, content);
    }
    updatePreview(content);
    syncHighlighter();
    await updateBacklinks();
    await updateOutgoingLinks();
  });

  window.addEventListener("resize", syncEditorSize);

  container.querySelector("#vault-new-file")!.addEventListener("click", async () => {
    const workspaceId = await resolveWorkspaceId();
    if (!workspaceId) {
      Toast.show("Select a workspace first", "warning");
      return;
    }
    const name = prompt("Note name?");
    if (!name) return;
    const filePath = name.endsWith(".md") ? name : `${name}.md`;
    await writeVaultFile(filePath, `# ${name}\n\n`);
    await refreshFiles();
    await loadFile(filePath);
  });

  // Phase 11.1: Listen for vault filesystem changes from main process
  if (window.carbonAPI.onVaultChange) {
    window.carbonAPI.onVaultChange((data: unknown) => {
      const typed = data as { workspaceId?: string; filePath?: string; content?: string };
      if (!typed.workspaceId || !typed.filePath || typed.content === undefined) return;
      if (typed.workspaceId === appState.currentWorkspaceId) {
        void refreshFiles().then(() => {
          if (currentFilePath && typed.filePath === currentFilePath) {
            editor.value = typed.content ?? "";
            updatePreview(typed.content ?? "");
            syncHighlighter();
          }
        });
      }
    });
  }

  // Initial load
  refreshFiles().then(() => {
    if (vaultFiles.length > 0) loadFile(vaultFiles[0]!);
  });
}
