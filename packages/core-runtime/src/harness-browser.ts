// BrowserHarness — CDP-based browser orchestration harness

import type { Harness, HarnessExecutionInput, HarnessExecutionResult, HarnessArtifact } from "./harness.js";

export interface BrowserHarnessDeps {
  stealth_open(input: { profileId: string; url: string }): Promise<unknown>;
  stealth_scrape(input: { profileId: string; url?: string }): Promise<unknown>;
  stealth_download(input: { profileId: string; url: string; filename?: string }): Promise<unknown>;
  ingest_file(input: { filePath: string; workspaceId: string; sourceUrl?: string; profileId?: string }): Promise<unknown>;
  rag_retrieve(input: { query: string; workspaceId: string; limit?: number }): Promise<unknown>;
}

export class BrowserHarness implements Harness {
  readonly id = "browser";
  readonly name = "Browser Harness";
  readonly type = "browser" as const;
  readonly capabilities = [
    { name: "stealth_open", description: "Open authenticated portals via CDP stealth" },
    { name: "stealth_scrape", description: "Scrape page text after authentication" },
    { name: "stealth_download", description: "Download files from authenticated portals" },
    { name: "ingest_file", description: "Ingest downloaded documents into RAG" },
    { name: "rag_retrieve", description: "Semantic search over working set" },
  ];

  status: "idle" | "running" | "completed" | "failed" = "idle";

  constructor(private deps: BrowserHarnessDeps) {}

  async spawn(input: HarnessExecutionInput): Promise<HarnessExecutionResult> {
    this.status = "running";
    try {
      const profileId = input.profileId ?? input.workspaceId;
      const urlMatch = input.context.match(/"url"\s*:\s*"([^"]+)"/);
      const queryMatch = input.context.match(/"query"\s*:\s*"([^"]+)"/);
      const url = urlMatch?.[1] ?? "about:blank";
      const query = queryMatch?.[1] ?? input.task;

      await this.deps.stealth_open({ profileId, url });
      const scrapeResult = await this.deps.stealth_scrape({ profileId, url });
      const retrieval = await this.deps.rag_retrieve({ query, workspaceId: input.workspaceId, limit: 5 });

      const observations: string[] = [];
      const artifacts: HarnessArtifact[] = [];
      const metrics: Record<string, unknown> = {};

      if (scrapeResult && typeof scrapeResult === "object" && "text" in scrapeResult && typeof (scrapeResult as { text?: unknown }).text === "string") {
        const text = String((scrapeResult as { text?: string }).text ?? "").trim();
        if (text) observations.push(text);
      }

      if (retrieval && typeof retrieval === "object") {
        metrics.retrieval = retrieval;
      }

      const urlLooksLikeDownload = /\.(pdf|xlsx?|csv|docx?)([?#].*)?$/i.test(url);
      if (urlLooksLikeDownload || observations.some((o) => o.length < 200 && /download|export|save/i.test(o))) {
        const download = await this.deps.stealth_download({ profileId, url, filename: `download-${Date.now()}.bin` });
        if (download && typeof download === "object" && "filePath" in download && typeof (download as { filePath?: unknown }).filePath === "string") {
          const filePath = String((download as { filePath?: string }).filePath ?? "");
          if (filePath) {
            const ingestResult = await this.deps.ingest_file({ filePath, workspaceId: input.workspaceId, sourceUrl: url, profileId });
            artifacts.push({ name: basename(filePath), path: filePath, mimeType: "application/octet-stream" });
            metrics.ingest = { download, ingestResult };
          }
        }
      }

      this.status = "completed";
      return {
        success: true,
        output: observations.join("\n\n"),
        artifacts,
        metrics: { ...metrics, source: url, query },
      };
    } catch (err) {
      this.status = "failed";
      return {
        success: false,
        output: "",
        artifacts: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}
