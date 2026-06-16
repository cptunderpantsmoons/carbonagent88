import {
  Modal,
  Toast,
  type ProfileRecord,
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
  loadProfiles,
  openLiveViewport,
  setInspectorContent,
} from "../view-helpers.js";

export function renderProfiles(container: HTMLElement): void {
  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "view-stack profiles-shell";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Cloak Bridge</div>
    <div class="view-hero-title">Manage browser profiles for authenticated sessions.</div>
    <div class="view-hero-copy">Each profile represents an isolated browser context. Use Login to authenticate manually, Health to check session validity, and Watch to stream the live viewport.</div>
  `;
  const heroMeta = document.createElement("div");
  heroMeta.className = "view-hero-meta";
  heroMeta.innerHTML = `<span>Local / Cloud</span><span>Login portal</span><span>Health checks</span><span>Live viewport</span>`;
  hero.appendChild(heroMeta);
  shell.appendChild(hero);

  const listPanel = document.createElement("section");
  listPanel.className = "view-panel";
  const listHeader = document.createElement("div");
  listHeader.className = "view-panel-header";
  listHeader.innerHTML = `
    <div>
      <div class="view-panel-title">Browser Profiles</div>
      <div class="view-panel-copy">Authenticated browser contexts for the orchestration runtime.</div>
    </div>
  `;
  const listEl = document.createElement("div");
  listEl.className = "list";
  listEl.id = "profile-list";
  listPanel.append(listHeader, listEl);
  shell.appendChild(listPanel);

  const createPanel = document.createElement("section");
  createPanel.className = "view-panel";
  const createToggle = document.createElement("button");
  createToggle.className = "btn btn-ghost btn-sm w-100";
  createToggle.textContent = "+ Create New Profile";

  const form = document.createElement("div");
  form.className = "toggle-group";
  const nameInput = createInput("e.g., My Enterprise Account");
  const modeSelect = createSelect([
    { value: "local", label: "Local Browser (launch Chromium)" },
    { value: "cloud", label: "Cloud Browser (connect via CDP)" },
  ], "Mode...");
  const localDirInput = createInput("/home/user/.carbon-agent/profiles/my-profile");
  const cdpUrlInput = createInput("http://localhost:9222");
  const tokenInput = createInput("auth token");
  const domainsInput = createInput("https://github.com, https://app.example.com");

  const localFields = document.createElement("div");
  localFields.className = "toggle-group visible";
  localFields.appendChild(createFormGroup("Profile Directory", localDirInput, "Persistent Chrome profile directory"));

  const cloudFields = document.createElement("div");
  cloudFields.className = "toggle-group";
  cloudFields.appendChild(createFormGroup("CDP URL", cdpUrlInput));
  cloudFields.appendChild(createFormGroup("Auth Token", tokenInput));

  form.append(
    createFormGroup("Name", nameInput),
    createFormGroup("Mode", modeSelect),
    localFields,
    cloudFields,
    createFormGroup("Target Domains", domainsInput, "Comma-separated URLs this profile can authenticate against"),
  );

  const saveBtn = createButton("Create Profile", "primary");
  saveBtn.className = "btn btn-primary w-100 mt-8";
  form.appendChild(saveBtn);
  createPanel.append(createToggle, form);
  shell.appendChild(createPanel);
  container.appendChild(shell);

  createToggle.addEventListener("click", () => form.classList.toggle("visible"));
  modeSelect.addEventListener("change", () => {
    localFields.classList.toggle("visible", modeSelect.value === "local");
    cloudFields.classList.toggle("visible", modeSelect.value === "cloud");
  });

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      Toast.show("Name is required", "warning");
      return;
    }

    const domains = domainsInput.value.split(",").map((domain) => domain.trim()).filter(Boolean);
    const payload: Record<string, unknown> = {
      name,
      targetDomains: domains,
      description: "",
      profileDir: "",
    };

    if (modeSelect.value === "cloud") {
      payload.cdpUrl = cdpUrlInput.value.trim();
      payload.cdpFingerprint = tokenInput.value.trim() || undefined;
    } else {
      payload.profileDir = localDirInput.value.trim();
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Creating...";
    try {
      const resp = await window.carbonAPI.invoke({ type: "profile/create", data: payload });
      if (resp.type === "error") Toast.show(String(resp.error), "error");
      else {
        Toast.show("Profile created", "success");
        void renderProfileList();
      }
    } catch (error: unknown) {
      Toast.show(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Create Profile";
    }
  });

  void renderProfileList();
}

async function renderProfileList(): Promise<void> {
  const list = document.getElementById("profile-list");
  if (!list) return;

  const profiles = await loadProfiles();
  list.innerHTML = "";
  if (profiles.length === 0) {
    list.appendChild(createEmptyState("profiles", "No browser profiles", "Create a profile to authenticate browser sessions."));
    return;
  }

  for (const profile of profiles) {
    const domains = normalizeDomains(profile.target_domains);
    const subtitle = profile.cdp_url ? `Cloud CDP — ${profile.cdp_url}` : `Local — ${profile.profile_dir || "(no dir)"}`;
    const item = createListItem(profile.name, subtitle, domains.join(", "));
    item.querySelector(".list-item-info")?.prepend(createStatusDot(profile.status || "unknown"));
    item.querySelector(".list-item-info")?.appendChild(createBadge(profile.status || "unknown", profile.status === "active" ? "active" : profile.status === "expired" ? "expired" : "unknown"));

    const actions = document.createElement("div");
    actions.className = "list-item-actions";
    const loginBtn = createButton("Login", "ghost", "sm");
    const healthBtn = createButton("Health", "ghost", "sm");
    const watchBtn = createButton("Watch", "ghost", "sm");
    const deleteBtn = createButton("Delete", "ghost", "sm");
    actions.append(loginBtn, healthBtn, watchBtn, deleteBtn);
    item.appendChild(actions);

    item.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".list-item-actions")) return;
      openProfileInspector(profile);
    });

    loginBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        const resp = await window.carbonAPI.invoke({ type: "profile/launchLogin", id: profile.id });
        Toast.show(resp.type === "error" ? `Launch failed: ${resp.error}` : "Login portal launched", resp.type === "error" ? "error" : "info");
        void renderProfileList();
      } catch (error: unknown) {
        Toast.show(`Launch error: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    });

    healthBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        const resp = await window.carbonAPI.invoke({ type: "profile/health", id: profile.id });
        Toast.show(resp.type === "profile/health.success" ? `Status: ${resp.status}` : `Health check failed: ${resp.error}`, resp.type === "profile/health.success" ? "info" : "error");
        void renderProfileList();
      } catch (error: unknown) {
        Toast.show(`Health error: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    });

    watchBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await window.carbonAPI.invoke({ type: "profile/lock", id: profile.id });
        openLiveViewport(profile.id);
        Toast.show("Viewport streaming started", "info");
      } catch (error: unknown) {
        Toast.show(`Watch error: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    });

    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const ok = await Modal.confirm("Delete profile?", `Remove \"${profile.name}\"?`);
      if (!ok) return;
      try {
        await window.carbonAPI.invoke({ type: "profile/delete", id: profile.id });
        Toast.show("Profile deleted", "success");
        void renderProfileList();
      } catch (error: unknown) {
        Toast.show(`Delete failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    });

    list.appendChild(item);
  }

  appState.profileList = profiles;
}

function openProfileInspector(profile: ProfileRecord): void {
  const domains = normalizeDomains(profile.target_domains);
  const isCloud = Boolean(profile.cdp_url);
  setInspectorContent(`
    <div class="inspector-section"><div class="inspector-section-title">Profile</div>
      <div class="inspector-row"><span class="label">Name</span><span class="value">${escapeHtml(profile.name)}</span></div>
      <div class="inspector-row"><span class="label">Mode</span><span class="value">${isCloud ? "Cloud CDP" : "Local"}</span></div>
      <div class="inspector-row"><span class="label">Status</span><span class="value">${escapeHtml(profile.status || "unknown")}</span></div>
    </div>
    <div class="inspector-section"><div class="inspector-section-title">Connection</div>
      <div class="inspector-row"><span class="label">Profile Dir</span><span class="value font-10">${escapeHtml(profile.profile_dir || "—")}</span></div>
      ${isCloud ? `<div class="inspector-row"><span class="label">CDP URL</span><span class="value font-10">${escapeHtml(profile.cdp_url || "—")}</span></div>` : ""}
      ${profile.cdp_fingerprint ? `<div class="inspector-row"><span class="label">Fingerprint</span><span class="value font-10">${escapeHtml(profile.cdp_fingerprint)}</span></div>` : ""}
    </div>
    <div class="inspector-section"><div class="inspector-section-title">Target Domains</div>
      ${domains.length ? domains.map((domain) => `<div class="inspector-row"><span class="value font-11">${escapeHtml(domain)}</span></div>`).join("") : `<div class="inspector-row"><span class="value font-11">No domains configured</span></div>`}
    </div>
    <div class="inspector-section"><div class="inspector-section-title">Last Activity</div>
      <div class="inspector-row"><span class="label">Checked</span><span class="value">${profile.last_checked_at ? new Date(profile.last_checked_at).toLocaleString() : "Never"}</span></div>
    </div>
  `);
}

function normalizeDomains(value: string[] | string | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value) as string[];
  } catch {
    return value.split(",").map((domain) => domain.trim()).filter(Boolean);
  }
}
