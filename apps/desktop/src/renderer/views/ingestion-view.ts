import {
  Toast,
  createBadge,
  createButton,
  createEmptyState,
  createFormGroup,
  createListItem,
  createSelect,
  createStatusDot,
  loadWorkspaces,
  populateSelect,
} from "../view-helpers.js";

export function renderIngestion(container: HTMLElement): void {
  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "view-stack ingestion-shell";

  const hero = document.createElement("section");
  hero.className = "view-hero";
  hero.innerHTML = `
    <div class="view-hero-kicker">Ingestion</div>
    <div class="view-hero-title">Scan, parse, embed, and graph-extract in one pass.</div>
    <div class="view-hero-copy">The pipeline detects supported formats (PDF, DOCX, MD, TXT, HTML), parses content, generates embeddings, and extracts knowledge-graph entities — all scoped to the selected workspace.</div>
  `;
  const heroMeta = document.createElement("div");
  heroMeta.className = "view-hero-meta";
  heroMeta.innerHTML = `<span>Detect</span><span>Parse</span><span>Embed</span><span>Graph Extract</span>`;
  hero.appendChild(heroMeta);
  shell.appendChild(hero);

  const pipelinePanel = document.createElement("section");
  pipelinePanel.className = "view-panel";
  const pipelineHeader = document.createElement("div");
  pipelineHeader.className = "view-panel-header";
  pipelineHeader.innerHTML = `
    <div>
      <div class="view-panel-title">Document Pipeline</div>
      <div class="view-panel-copy">Scans <code>~/Documents/carbon-agent/</code> for supported formats.</div>
    </div>
  `;
  const pipelinePhases = document.createElement("div");
  pipelinePhases.className = "pipeline-phases";
  pipelinePhases.innerHTML = `
    <div class="pipeline-phase"><span class="pipeline-phase-dot"></span><span>Detect</span></div>
    <div class="pipeline-phase-line"></div>
    <div class="pipeline-phase"><span class="pipeline-phase-dot"></span><span>Parse</span></div>
    <div class="pipeline-phase-line"></div>
    <div class="pipeline-phase"><span class="pipeline-phase-dot"></span><span>Embed</span></div>
    <div class="pipeline-phase-line"></div>
    <div class="pipeline-phase"><span class="pipeline-phase-dot"></span><span>Graph Extract</span></div>
  `;
  pipelinePanel.append(pipelineHeader, pipelinePhases);
  shell.appendChild(pipelinePanel);

  const controlPanel = document.createElement("section");
  controlPanel.className = "view-panel";
  const workspaceSelect = createSelect([], "Select workspace...");
  controlPanel.append(
    createFormGroup("Target Workspace", workspaceSelect),
  );

  const scanBtn = createButton("Scan Documents Folder", "primary");
  scanBtn.className = "btn btn-primary w-100 mt-8";
  controlPanel.appendChild(scanBtn);
  shell.appendChild(controlPanel);

  const resultsPanel = document.createElement("section");
  resultsPanel.className = "view-panel";
  const resultsHeader = document.createElement("div");
  resultsHeader.className = "view-panel-header";
  resultsHeader.innerHTML = `
    <div>
      <div class="view-panel-title">Results</div>
      <div class="view-panel-copy">Discovered documents appear here after scanning.</div>
    </div>
  `;
  const results = document.createElement("div");
  results.id = "ingestion-results";
  resultsPanel.append(resultsHeader, results);
  shell.appendChild(resultsPanel);

  container.appendChild(shell);

  void loadWorkspaces().then((workspaces) => {
    populateSelect(workspaceSelect, workspaces, (workspace) => workspace.name, "Select workspace...");
  });

  scanBtn.addEventListener("click", async () => {
    const workspaceId = workspaceSelect.value;
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning...";
    try {
      const resp = await window.carbonAPI.invoke({ type: "ingestion/scan", workspaceId });
      results.innerHTML = "";
      if (resp.type !== "ingestion/scan.success") {
        results.innerHTML = `<p class="text-danger font-12">Error: ${resp.error}</p>`;
        return;
      }

      const jobs = resp.jobs ?? [];
      if (jobs.length === 0) {
        results.appendChild(createEmptyState("input", "No files found", "Downloaded files appear here for scanning."));
        return;
      }

      const list = document.createElement("div");
      list.className = "list";
      for (const job of jobs as Array<{ id: string; originalName?: string; fileType?: string; size?: number; status: string }>) {
        const fileName = job.originalName || `Document ${String(job.id).slice(0, 8)}`;
        const fileType = String(job.fileType || "unknown").toUpperCase();
        const fileSizeKb = Math.round((Number(job.size || 0) / 1024) * 10) / 10;
        const item = createListItem(fileName, `${fileType} · ${fileSizeKb} KB`);
        item.querySelector(".list-item-info")?.prepend(createStatusDot(job.status || "pending"));
        item.querySelector(".list-item-info")?.appendChild(createBadge(String(job.status || "pending"), job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "pending"));
        list.appendChild(item);
      }

      results.appendChild(list);
      Toast.show(`Found ${jobs.length} document(s)`, "success");
    } catch (error: unknown) {
      results.innerHTML = `<p class="text-danger font-12">Error: ${error instanceof Error ? error.message : String(error)}</p>`;
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = "Scan Documents Folder";
    }
  });
}
