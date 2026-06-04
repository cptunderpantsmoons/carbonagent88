/**
 * Renderer Process - Vanilla JS UI
 *
 * Control Corridor:
 * - Owns: UI state and display
 * - Must NOT own: Raw filesystem/browser control, LLM calls
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentView = "playground";
let providers: any[] = [];
let profiles: any[] = [];
let workspaces: any[] = [];
let conversations: any[] = [];
let currentConversationId: string | null = null;
let currentWorkspaceId: string | null = null;
let currentRunId: string | null = null;
let isRunning = false;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

document.querySelectorAll(".nav-item").forEach((el) => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    el.classList.add("active");
    currentView = el.getAttribute("data-view") || "playground";
    const title = el.textContent?.trim() || "Carbon Agent";
    document.getElementById("page-title")!.textContent = title;
    renderView();
  });
});

// ---------------------------------------------------------------------------
// View Rendering
// ---------------------------------------------------------------------------

function renderView(): void {
  const content = document.getElementById("content")!;
  content.innerHTML = "";

  switch (currentView) {
    case "playground":
      renderPlayground(content);
      break;
    case "providers":
      renderProviders(content);
      break;
    case "profiles":
      renderProfiles(content);
      break;
    case "workspaces":
      renderWorkspaces(content);
      break;
    case "ingestion":
      renderIngestion(content);
      break;
  }
}

// ---------------------------------------------------------------------------
// Playground View (Phase 5.3 - Wired to Agent Runtime)
// ---------------------------------------------------------------------------

function renderPlayground(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;gap:12px;align-items:center;">
        <select id="workspace-select" class="form-control" style="flex:1;">
          <option value="">Select Workspace...</option>
        </select>
        <select id="provider-select" class="form-control" style="flex:1;">
          <option value="">Select AI Provider...</option>
        </select>
        <button class="btn btn-secondary" id="new-conv-btn">New Chat</button>
      </div>
    </div>
    <div class="chat-container">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input">
        <input type="text" id="chat-input" placeholder="Ask the agent..." ${isRunning ? "disabled" : ""} />
        <button class="btn btn-primary" id="chat-send" ${isRunning ? "disabled" : ""}>${isRunning ? "Running..." : "Send"}</button>
      </div>
    </div>
  `;

  // Load workspace and provider options
  loadWorkspaceOptions();
  loadProviderOptions();

  const input = document.getElementById("chat-input") as HTMLInputElement;
  const sendBtn = document.getElementById("chat-send")!;
  const messages = document.getElementById("chat-messages")!;

  function addMessage(role: "user" | "assistant" | "system", text: string, toolInfo?: string): void {
    const div = document.createElement("div");
    div.className = `chat-message ${role}`;
    if (toolInfo) {
      div.innerHTML = `<div style="font-size:11px;color:#888;margin-bottom:4px;">${toolInfo}</div><div>${escapeHtml(text)}</div>`;
    } else {
      div.textContent = text;
    }
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  async function send(): Promise<void> {
    const text = input.value.trim();
    if (!text) return;

    const workspaceSelect = document.getElementById("workspace-select") as HTMLSelectElement;
    const providerSelect = document.getElementById("provider-select") as HTMLSelectElement;

    if (!workspaceSelect.value) {
      alert("Please select a workspace first");
      return;
    }
    if (!providerSelect.value) {
      alert("Please select an AI provider first");
      return;
    }

    currentWorkspaceId = workspaceSelect.value;
    const providerId = providerSelect.value;

    addMessage("user", text);
    input.value = "";
    (input as HTMLInputElement).disabled = true;
    sendBtn.textContent = "Running...";
    (sendBtn as HTMLButtonElement).disabled = true;
    isRunning = true;

    try {
      // Ensure we have a conversation
      if (!currentConversationId) {
        const convResp = await window.carbonAPI.invoke({
          type: "conversation/create",
          workspaceId: currentWorkspaceId,
        });
        if (convResp.type === "conversation/create.success") {
          currentConversationId = convResp.data.id;
        } else {
          throw new Error(convResp.error || "Failed to create conversation");
        }
      }

      // Create a run
      const runResp = await window.carbonAPI.invoke({
        type: "run/create",
        conversationId: currentConversationId,
        providerId,
      });
      if (runResp.type !== "run/create.success") {
        throw new Error(runResp.error || "Failed to create run");
      }
      currentRunId = runResp.data.id;

      // Execute the run
      const streamResp = await window.carbonAPI.invoke({
        type: "run/stream",
        id: currentRunId,
        message: text,
      });

      if (streamResp.type === "run/stream.complete") {
        // Load the conversation to get the assistant's response
        const convResp = await window.carbonAPI.invoke({
          type: "conversation/get",
          id: currentConversationId,
        });
        if (convResp.type === "conversation/get.success") {
          const msgs = convResp.data.messages || [];
          const lastAssistant = msgs.filter((m: any) => m.role === "assistant").pop();
          if (lastAssistant) {
            addMessage("assistant", lastAssistant.content);
          } else {
            addMessage("assistant", "Run completed. Check the run logs for details.");
          }
        }
      } else if (streamResp.type === "error") {
        addMessage("system", `Error: ${streamResp.error}`, "system");
      }
    } catch (e: any) {
      addMessage("system", `Error: ${e.message}`, "system");
    } finally {
      (input as HTMLInputElement).disabled = false;
      sendBtn.textContent = "Send";
      (sendBtn as HTMLButtonElement).disabled = false;
      isRunning = false;
      currentRunId = null;
    }
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") send();
  });

  document.getElementById("new-conv-btn")!.addEventListener("click", () => {
    currentConversationId = null;
    messages.innerHTML = "";
    addMessage("system", "Started a new conversation.");
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function loadWorkspaceOptions(): Promise<void> {
  try {
    const resp = await window.carbonAPI.invoke({ type: "workspace/list" });
    if (resp.type === "workspace/list.success") {
      workspaces = resp.data;
      const select = document.getElementById("workspace-select") as HTMLSelectElement;
      if (select) {
        select.innerHTML = '<option value="">Select Workspace...</option>' +
          workspaces.map((w: any) => `<option value="${w.id}">${w.name}</option>`).join("");
      }
    }
  } catch (e) {
    console.error("Failed to load workspaces:", e);
  }
}

async function loadProviderOptions(): Promise<void> {
  try {
    const resp = await window.carbonAPI.invoke({ type: "provider/list" });
    if (resp.type === "provider/list.success") {
      providers = resp.data;
      const select = document.getElementById("provider-select") as HTMLSelectElement;
      if (select) {
        select.innerHTML = '<option value="">Select AI Provider...</option>' +
          providers.map((p: any) => `<option value="${p.id}">${p.name} (${p.type})</option>`).join("");
      }
    }
  } catch (e) {
    console.error("Failed to load providers:", e);
  }
}

// ---------------------------------------------------------------------------
// Providers View (Settings UI)
// ---------------------------------------------------------------------------

function renderProviders(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3>Add AI Provider</h3>
      <div class="form-group">
        <label>Type</label>
        <select id="provider-type">
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT)</option>
          <option value="custom-openai">Custom OpenAI-compatible</option>
        </select>
      </div>
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="provider-name" placeholder="My Claude Key" />
      </div>
      <div class="form-group">
        <label>API Key</label>
        <input type="password" id="provider-key" placeholder="sk-..." />
      </div>
      <div class="form-group" id="baseurl-group" style="display:none;">
        <label>Base URL</label>
        <input type="text" id="provider-baseurl" placeholder="http://localhost:1234/v1" />
      </div>
      <div class="form-group">
        <label>Model</label>
        <input type="text" id="provider-model" placeholder="claude-sonnet-4-20250514" />
      </div>
      <button class="btn btn-primary" id="provider-save">Save Provider</button>
    </div>
    <div class="card">
      <h3>Saved Providers</h3>
      <div id="provider-list"></div>
    </div>
  `;

  const typeSelect = document.getElementById("provider-type") as HTMLSelectElement;
  const baseUrlGroup = document.getElementById("baseurl-group")!;

  typeSelect.addEventListener("change", () => {
    baseUrlGroup.style.display = typeSelect.value === "custom-openai" ? "block" : "none";
  });

  document.getElementById("provider-save")!.addEventListener("click", async () => {
    const name = (document.getElementById("provider-name") as HTMLInputElement).value;
    const apiKey = (document.getElementById("provider-key") as HTMLInputElement).value;
    const baseUrl = (document.getElementById("provider-baseurl") as HTMLInputElement).value;
    const model = (document.getElementById("provider-model") as HTMLInputElement).value;

    if (!name || !apiKey || !model) {
      alert("Name, API Key, and Model are required");
      return;
    }

    try {
      const resp = await window.carbonAPI.invoke({
        type: "provider/create",
        data: { type: typeSelect.value, name, apiKey, baseUrl: baseUrl || undefined, model },
      });

      if (resp.type === "error") {
        alert(`Error: ${resp.error}`);
      } else {
        loadProviders();
        (document.getElementById("provider-name") as HTMLInputElement).value = "";
        (document.getElementById("provider-key") as HTMLInputElement).value = "";
        (document.getElementById("provider-model") as HTMLInputElement).value = "";
      }
    } catch (e: any) {
      alert(`IPC Error: ${e.message}`);
    }
  });

  loadProviders();
}

async function loadProviders(): Promise<void> {
  try {
    const resp = await window.carbonAPI.invoke({ type: "provider/list" });
    if (resp.type === "provider/list.success") {
      providers = resp.data;
      const list = document.getElementById("provider-list");
      if (list) {
        list.innerHTML = providers.length === 0
          ? '<p style="color:#666;font-size:12px;">No providers configured yet.</p>'
          : providers.map((p: any) => `
            <div class="list-item">
              <div class="list-item-info">
                <h4>${p.name}</h4>
                <p>${p.type} - ${p.model}</p>
              </div>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary btn-sm" data-test="${p.id}">Test</button>
                <button class="btn btn-danger btn-sm" data-delete="${p.id}">Delete</button>
              </div>
            </div>
          `).join("");

        // Wire test buttons
        list.querySelectorAll("[data-test]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = (btn as HTMLElement).getAttribute("data-test")!;
            (btn as HTMLButtonElement).textContent = "Testing...";
            try {
              const testResp = await window.carbonAPI.invoke({ type: "provider/test", id });
              alert(testResp.type === "provider/test.success" ? testResp.status : `Error: ${testResp.error}`);
            } catch (e: any) {
              alert(`Test failed: ${e.message}`);
            } finally {
              (btn as HTMLButtonElement).textContent = "Test";
            }
          });
        });

        // Wire delete buttons
        list.querySelectorAll("[data-delete]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = (btn as HTMLElement).getAttribute("data-delete")!;
            if (!confirm("Delete this provider?")) return;
            try {
              await window.carbonAPI.invoke({ type: "provider/delete", id });
              loadProviders();
            } catch (e: any) {
              alert(`Delete failed: ${e.message}`);
            }
          });
        });
      }
    }
  } catch (e: any) {
    console.error("Failed to load providers:", e);
  }
}

// ---------------------------------------------------------------------------
// Profiles View (Cloak Bridge - Phase 3.3)
// ---------------------------------------------------------------------------

function renderProfiles(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3>Browser Profiles</h3>
      <p style="color:#666;font-size:12px;margin-bottom:12px;">
        Create a profile, launch the login portal to authenticate, then the agent can use that session.
      </p>
      <div id="profile-list"></div>
    </div>
    <div class="card">
      <h3>Add Profile</h3>
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="profile-name" placeholder="My Enterprise Account" />
      </div>
      <div class="form-group">
        <label>Profile Directory</label>
        <input type="text" id="profile-dir" placeholder="/home/user/.carbon-agent/profiles/my-profile" />
      </div>
      <div class="form-group">
        <label>Target Domains (comma-separated URLs)</label>
        <input type="text" id="profile-domains" placeholder="https://example.com, https://app.example.com" />
      </div>
      <button class="btn btn-primary" id="profile-save">Create Profile</button>
    </div>
  `;

  loadProfiles();

  document.getElementById("profile-save")!.addEventListener("click", async () => {
    const name = (document.getElementById("profile-name") as HTMLInputElement).value;
    const dir = (document.getElementById("profile-dir") as HTMLInputElement).value;
    const domainsStr = (document.getElementById("profile-domains") as HTMLInputElement).value;

    if (!name || !dir) {
      alert("Name and Profile Directory are required");
      return;
    }

    const domains = domainsStr.split(",").map(d => d.trim()).filter(Boolean);

    try {
      const resp = await window.carbonAPI.invoke({
        type: "profile/create",
        data: { name, profileDir: dir, targetDomains: domains, description: "" },
      });
      if (resp.type === "error") alert(resp.error);
      else {
        loadProfiles();
        (document.getElementById("profile-name") as HTMLInputElement).value = "";
        (document.getElementById("profile-dir") as HTMLInputElement).value = "";
        (document.getElementById("profile-domains") as HTMLInputElement).value = "";
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  });
}

async function loadProfiles(): Promise<void> {
  try {
    const resp = await window.carbonAPI.invoke({ type: "profile/list" });
    if (resp.type === "profile/list.success") {
      profiles = resp.data;
      const list = document.getElementById("profile-list");
      if (list) {
        list.innerHTML = profiles.length === 0
          ? '<p style="color:#666;font-size:12px;">No profiles yet. Create one to start browsing.</p>'
          : profiles.map((p: any) => `
            <div class="list-item">
              <div class="list-item-info">
                <h4>${p.name}</h4>
                <p>${p.profile_dir}</p>
                <p style="font-size:10px;color:#555;">${(p.target_domains ? JSON.parse(p.target_domains) : []).join(", ")}</p>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <span class="status-badge status-${p.status}">${p.status}</span>
                <button class="btn btn-primary btn-sm" data-launch="${p.id}">Launch Login</button>
                <button class="btn btn-secondary btn-sm" data-health="${p.id}">Health</button>
                <button class="btn btn-danger btn-sm" data-delete="${p.id}">Delete</button>
              </div>
            </div>
          `).join("");

        // Wire launch buttons
        list.querySelectorAll("[data-launch]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = (btn as HTMLElement).getAttribute("data-launch")!;
            (btn as HTMLButtonElement).textContent = "Launching...";
            try {
              const launchResp = await window.carbonAPI.invoke({ type: "profile/launchLogin", id });
              if (launchResp.type === "error") {
                alert(`Launch failed: ${launchResp.error}`);
              } else {
                alert("Login portal launched! Log in manually, then close the browser window when done.");
                loadProfiles();
              }
            } catch (e: any) {
              alert(`Launch error: ${e.message}`);
            } finally {
              (btn as HTMLButtonElement).textContent = "Launch Login";
            }
          });
        });

        // Wire health buttons
        list.querySelectorAll("[data-health]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = (btn as HTMLElement).getAttribute("data-health")!;
            (btn as HTMLButtonElement).textContent = "Checking...";
            try {
              const healthResp = await window.carbonAPI.invoke({ type: "profile/health", id });
              if (healthResp.type === "profile/health.success") {
                alert(`Status: ${healthResp.status}\nLast checked: ${healthResp.lastCheckedAt || "Never"}`);
              } else {
                alert(`Health check failed: ${healthResp.error}`);
              }
              loadProfiles();
            } catch (e: any) {
              alert(`Health error: ${e.message}`);
            } finally {
              (btn as HTMLButtonElement).textContent = "Health";
            }
          });
        });

        // Wire delete buttons
        list.querySelectorAll("[data-delete]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = (btn as HTMLElement).getAttribute("data-delete")!;
            if (!confirm("Delete this profile?")) return;
            try {
              await window.carbonAPI.invoke({ type: "profile/delete", id });
              loadProfiles();
            } catch (e: any) {
              alert(`Delete failed: ${e.message}`);
            }
          });
        });
      }
    }
  } catch (e: any) {
    console.error("Failed to load profiles:", e);
  }
}

// ---------------------------------------------------------------------------
// Workspaces View
// ---------------------------------------------------------------------------

function renderWorkspaces(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3>Workspaces</h3>
      <div id="workspace-list"></div>
    </div>
    <div class="card">
      <h3>New Workspace</h3>
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="workspace-name" placeholder="My Project" />
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" id="workspace-desc" placeholder="Optional description" />
      </div>
      <button class="btn btn-primary" id="workspace-save">Create Workspace</button>
    </div>
  `;

  loadWorkspaces();

  document.getElementById("workspace-save")!.addEventListener("click", async () => {
    const name = (document.getElementById("workspace-name") as HTMLInputElement).value;
    const desc = (document.getElementById("workspace-desc") as HTMLInputElement).value;
    if (!name) { alert("Name is required"); return; }

    try {
      const resp = await window.carbonAPI.invoke({
        type: "workspace/create",
        data: { name, description: desc || undefined, vaultDir: `/home/user/.carbon-agent/vault/${Date.now()}` },
      });
      if (resp.type === "error") alert(resp.error);
      else {
        loadWorkspaces();
        (document.getElementById("workspace-name") as HTMLInputElement).value = "";
        (document.getElementById("workspace-desc") as HTMLInputElement).value = "";
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  });
}

async function loadWorkspaces(): Promise<void> {
  try {
    const resp = await window.carbonAPI.invoke({ type: "workspace/list" });
    if (resp.type === "workspace/list.success") {
      workspaces = resp.data;
      const list = document.getElementById("workspace-list");
      if (list) {
        list.innerHTML = workspaces.length === 0
          ? '<p style="color:#666;font-size:12px;">No workspaces yet.</p>'
          : workspaces.map((w: any) => `
            <div class="list-item">
              <div class="list-item-info">
                <h4>${w.name}</h4>
                <p>${w.vault_dir}</p>
              </div>
            </div>
          `).join("");
      }
    }
  } catch (e: any) {
    console.error("Failed to load workspaces:", e);
  }
}

// ---------------------------------------------------------------------------
// Ingestion View (Phase 4.2 - File scanner)
// ---------------------------------------------------------------------------

function renderIngestion(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3>Document Ingestion</h3>
      <p style="color:#666;font-size:12px;margin-bottom:12px;">
        Files downloaded via stealth_download appear here. Click Scan to detect and index them.
      </p>
      <button class="btn btn-primary" id="ingestion-scan">Scan Documents Folder</button>
      <div id="ingestion-results" style="margin-top:16px;"></div>
    </div>
  `;

  document.getElementById("ingestion-scan")!.addEventListener("click", async () => {
    const btn = document.getElementById("ingestion-scan") as HTMLButtonElement;
    const results = document.getElementById("ingestion-results")!;
    btn.textContent = "Scanning...";
    btn.disabled = true;

    try {
      const resp = await window.carbonAPI.invoke({ type: "ingestion/scan", workspaceId: currentWorkspaceId || "default" });
      if (resp.type === "ingestion/scan.success") {
        const jobs = resp.jobs;
        results.innerHTML = jobs.length === 0
          ? '<p style="color:#666;font-size:12px;">No files found in documents folder.</p>'
          : jobs.map((j: any) => `
            <div class="list-item">
              <div class="list-item-info">
                <h4>Document ${j.id.slice(0, 8)}</h4>
                <p>Status: ${j.status}</p>
              </div>
              <span class="status-badge status-${j.status}">${j.status}</span>
            </div>
          `).join("");
      } else {
        results.innerHTML = `<p style="color:#f87171;">Error: ${resp.error}</p>`;
      }
    } catch (e: any) {
      results.innerHTML = `<p style="color:#f87171;">Error: ${e.message}</p>`;
    } finally {
      btn.textContent = "Scan Documents Folder";
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

renderView();
