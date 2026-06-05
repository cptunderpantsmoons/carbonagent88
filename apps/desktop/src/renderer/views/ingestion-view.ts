import {
  Toast,
  createBadge,
  createButton,
  createCard,
  createEmptyState,
  createListItem,
  createStatusDot,
  loadWorkspaces,
  populateSelect,
} from "../view-helpers.js";

export function renderIngestion(container: HTMLElement): void {
  container.innerHTML = "";

  const pipelineCard = document.createElement("div");
  pipelineCard.className = "pipeline-card";
  pipelineCard.innerHTML = `
    <div class="pipeline-header">
      <span class="pipeline-title">Document Pipeline</span>
      <span class="pipeline-status">Ready</span>
    </div>
    <div class="pipeline-phases">
      <div class="pipeline-phase"><span class="pipeline-phase-dot"></span><span>Detect</span></div>
      <div class="pipeline-phase-line"></div>
      <div class="pipeline-phase"><span class="pipeline-phase-dot"></span><span>Parse</span></div>
      <div class="pipeline-phase-line"></div>
      <div class="pipeline-phase"><span class="pipeline-phase-dot"></span><span>Embed</span></div>
      <div class="pipeline-phase-line"></div>
      <div class="pipeline-phase"><span class="pipeline-phase-dot"></span><span>Graph Extract</span></div>
    </div>
    <div class="pipeline-info">Scans <code>~/Documents/carbon-agent/</code> for supported formats: PDF, DOCX, MD, TXT, HTML</div>
  `;
  container.appendChild(pipelineCard);

  const controlsCard = createCard("");
  const controls = document.createElement("div");
  controls.className = "flex gap-2 w-100";

  const workspaceWrap = document.createElement("div");
  workspaceWrap.className = "flex-1";
  const label = document.createElement("label");
  label.className = "form-label";
  label.textContent = "Target Workspace";
  const workspaceSelect = document.createElement("select");
  workspaceSelect.className = "form-select";
  workspaceWrap.append(label, workspaceSelect);
  controls.appendChild(workspaceWrap);
  controlsCard.appendChild(controls);

  const scanBtn = createButton("Scan Documents Folder", "primary");
  scanBtn.className = "btn btn-primary w-100 mt-8";
  controlsCard.appendChild(scanBtn);
  container.appendChild(controlsCard);

  const results = document.createElement("div");
  results.className = "mt-3";
  container.appendChild(results);

  void loadWorkspaces().then((workspaces) => {
    populateSelect(workspaceSelect, workspaces, (workspace) => workspace.name, "Select workspace...");
  });

  scanBtn.addEventListener("click", async () => {
    const workspaceId = workspaceSelect.value;
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning...";
    try {
      const resp = await window.carbonAPI.invoke({ type: "ingestion/scan", workspaceId } as any) as any;
      results.innerHTML = "";
      if (resp.type !== "ingestion/scan.success") {
        results.innerHTML = `<p class="text-danger font-12">Error: ${resp.error}</p>`;
        return;
      }

      const jobs = resp.jobs ?? [];
      if (jobs.length === 0) {
        results.appendChild(createEmptyState("icon-input", "No files found", "Downloaded files appear here for scanning."));
        return;
      }

      const list = document.createElement("div");
      list.className = "list";
      for (const job of jobs as any[]) {
        const fileName = job.file_name || job.original_name || `Document ${String(job.id).slice(0, 8)}`;
        const fileType = String(job.file_type || job.format || "unknown").toUpperCase();
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
