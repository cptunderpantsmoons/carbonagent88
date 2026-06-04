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
// Playground View
// ---------------------------------------------------------------------------

function renderPlayground(container: HTMLElement): void {
  container.innerHTML = `
    <div class="chat-container">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input">
        <input type="text" id="chat-input" placeholder="Ask the agent..." />
        <button class="btn btn-primary" id="chat-send">Send</button>
      </div>
    </div>
  `;

  const input = document.getElementById("chat-input") as HTMLInputElement;
  const sendBtn = document.getElementById("chat-send")!;
  const messages = document.getElementById("chat-messages")!;

  function addMessage(role: "user" | "assistant", text: string): void {
    const div = document.createElement("div");
    div.className = `chat-message ${role}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  async function send(): Promise<void> {
    const text = input.value.trim();
    if (!text) return;
    addMessage("user", text);
    input.value = "";
    addMessage("assistant", "Agent response will appear here once the runtime is wired up.");
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") send();
  });
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
      <button class="btn btn-secondary" id="provider-test">Test Connection</button>
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

  document.getElementById("provider-test")!.addEventListener("click", async () => {
    alert("Test connection via IPC will be implemented in the next cycle. Save the provider first.");
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
              <span class="status-badge status-unknown">${p.type}</span>
            </div>
          `).join("");
      }
    }
  } catch (e: any) {
    console.error("Failed to load providers:", e);
  }
}

// ---------------------------------------------------------------------------
// Profiles View (Cloak Bridge)
// ---------------------------------------------------------------------------

function renderProfiles(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3>Browser Profiles</h3>
      <div id="profile-list"></div>
      <button class="btn btn-primary" id="profile-add" style="margin-top:12px;">Add Profile</button>
    </div>
  `;

  loadProfiles();

  document.getElementById("profile-add")!.addEventListener("click", () => {
    const name = prompt("Profile name:");
    if (!name) return;
    const dir = prompt("Profile directory path:");
    if (!dir) return;

    window.carbonAPI.invoke({
      type: "profile/create",
      data: { name, profileDir: dir, targetDomains: [] },
    }).then((resp: any) => {
      if (resp.type === "error") alert(resp.error);
      else loadProfiles();
    });
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
              </div>
              <span class="status-badge status-${p.status}">${p.status}</span>
            </div>
          `).join("");
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
      <button class="btn btn-primary" id="workspace-add" style="margin-top:12px;">New Workspace</button>
    </div>
  `;

  loadWorkspaces();

  document.getElementById("workspace-add")!.addEventListener("click", () => {
    const name = prompt("Workspace name:");
    if (!name) return;

    window.carbonAPI.invoke({
      type: "workspace/create",
      data: { name, vaultDir: `/home/user/.carbon-agent/vault/${Date.now()}` },
    }).then((resp: any) => {
      if (resp.type === "error") alert(resp.error);
      else loadWorkspaces();
    });
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
// Ingestion View (placeholder)
// ---------------------------------------------------------------------------

function renderIngestion(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card">
      <h3>Document Ingestion</h3>
      <p style="color:#666;font-size:13px;">Ingestion pipeline will be available in Phase 4.</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

renderView();
