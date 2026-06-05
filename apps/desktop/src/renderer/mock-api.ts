/**
 * Mock Carbon API for browser development
 * Returns realistic demo data so the UI is fully interactive
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const DEMO_PROVIDERS = [
  { id: "p1", type: "anthropic", name: "Claude", model: "claude-3-5-sonnet-20241022", api_key: "sk-demo...", base_url: "", created_at: "2025-06-01", updated_at: "2025-06-05" },
  { id: "p2", type: "openai", name: "GPT-4", model: "gpt-4o", api_key: "sk-demo...", base_url: "", created_at: "2025-06-02", updated_at: "2025-06-05" },
];

const DEMO_PROFILES = [
  { id: "prof1", name: "LinkedIn Scout", profile_type: "local", status: "active", profile_dir: "/home/user/.config/chromium/linkedin", target_domains: ["linkedin.com"], last_checked_at: "2025-06-05T09:00:00Z" },
  { id: "prof2", name: "SharePoint Crawler", profile_type: "cloud_cdp", status: "locked", cdp_url: "ws://localhost:9222", cdp_fingerprint: "chrome-120-win10", target_domains: ["sharepoint.com", "office.com"], last_checked_at: "2025-06-05T08:30:00Z" },
  { id: "prof3", name: "Gmail Monitor", profile_type: "local", status: "expired", profile_dir: "/tmp/gmail-session", target_domains: ["gmail.com"], last_checked_at: null },
];

const DEMO_WORKSPACES = [
  { id: "ws1", name: "Acme Corp Intelligence", vault_dir: "/workspace/acme", description: "Competitive intelligence and market research" },
  { id: "ws2", name: "Personal KB", vault_dir: "/workspace/personal", description: "Personal notes and bookmarks" },
];

const DEMO_VAULT_FILES = ["Welcome.md", "Project Alpha.md", "Meeting Notes/2025-06-01.md", "Meeting Notes/2025-06-03.md", "Research/Competitors.md", "Research/Trends.md"];

const DEMO_SKILLS = [
  { id: "s1", name: "LinkedIn Lead Scraper", trigger: "Find leads on LinkedIn", pinned: true, successCount: 12, failureCount: 2 },
  { id: "s2", name: "SharePoint File Ingestor", trigger: "Ingest new SharePoint files", pinned: false, successCount: 8, failureCount: 0 },
];

const DEMO_WATCHERS = [
  { id: "w1", name: "Check Invoices", prompt: "Check my SharePoint Pending folder and ingest new PDFs", cronExpression: "*/30 * * * *", enabled: true, workspaceId: "ws1", profileId: "prof2" },
  { id: "w2", name: "LinkedIn Update", prompt: "Check LinkedIn for new connection requests and messages", cronExpression: "*/60 * * * *", enabled: false, workspaceId: "ws1", profileId: "prof1" },
];

const VAULT_CONTENTS: Record<string, string> = {
  "Welcome.md": "# Welcome to Knowledge Vault\n\nYour **brain extension**. Link ideas with `[[wikilinks]]`.\n\n## Getting Started\n- Create new notes from the sidebar\n- Use `[[Document Name]]` to link between ideas\n- Changes auto-save\n\n---\n*Powered by Carbon Agent*",
  "Project Alpha.md": "# Project Alpha\n\nSecret internal initiative.\n\n## Team\n- **Director:** Alice\n- **Engineer:** Bob\n- **Design:** Carol\n\n## Links\n- [[Research/Competitors]]\n- [[Meeting Notes/2025-06-01]]\n",
  "Meeting Notes/2025-06-01.md": "# Stand-up — June 1\n\n## Attendees\nAlice, Bob, Carol\n\n## Agenda\n1. Review sprint progress\n2. Blockers discussion\n3. Next actions\n\n## Notes\n- Bob needs access to [[Research/Trends]]\n- Carol will update the design system",
  "Meeting Notes/2025-06-03.md": "# Sprint Retrospective\n\n## What went well\n- Fast delivery on Project Alpha\n\n## Action items\n- [[Project Alpha]] needs QA\n",
};

export function installMockAPI(): void {
  const mockWindow = window as typeof window & { carbonAPI?: any };
  if (mockWindow.carbonAPI) return;

  const handlers: Record<string, any> = {
    async "provider/list"() {
      await sleep(200);
      return { type: "provider/list.success", providers: DEMO_PROVIDERS };
    },
    async "provider/save"(req: any) {
      await sleep(150);
      if (req.data.id) {
        const idx = DEMO_PROVIDERS.findIndex((p) => p.id === req.data.id);
        if (idx >= 0) DEMO_PROVIDERS[idx] = { ...DEMO_PROVIDERS[idx], ...req.data, updated_at: new Date().toISOString() };
      } else {
        DEMO_PROVIDERS.push({ ...req.data, id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      }
      return { type: "provider/save.success", provider: DEMO_PROVIDERS[DEMO_PROVIDERS.length - 1] };
    },
    async "provider/delete"(req: any) {
      await sleep(100);
      const idx = DEMO_PROVIDERS.findIndex((p) => p.id === req.id);
      if (idx >= 0) DEMO_PROVIDERS.splice(idx, 1);
      return { type: "provider/delete.success" };
    },
    async "profile/list"() {
      await sleep(200);
      return { type: "profile/list.success", data: DEMO_PROFILES };
    },
    async "profile/create"(req: any) {
      await sleep(150);
      const p = { ...req.data, id: uuid(), status: "idle", last_checked_at: null };
      DEMO_PROFILES.push(p);
      return { type: "profile/create.success", ...p };
    },
    async "profile/delete"(req: any) {
      await sleep(100);
      const idx = DEMO_PROFILES.findIndex((p) => p.id === req.id);
      if (idx >= 0) DEMO_PROFILES.splice(idx, 1);
      return { type: "profile/delete.success" };
    },
    async "workspace/list"() {
      await sleep(200);
      return { type: "workspace/list.success", data: DEMO_WORKSPACES };
    },
    async "workspace/create"(req: any) {
      await sleep(150);
      const w = { ...req.data, id: uuid() };
      void w;
      DEMO_WORKSPACES.push(w);
      return { type: "workspace/create.success", workspace: w };
    },
    async "vault/list"() {
      await sleep(200);
      return { type: "vault/list.success", files: DEMO_VAULT_FILES };
    },
    async "vault/read"(req: any) {
      await sleep(100);
      return { type: "vault/read.success", content: VAULT_CONTENTS[req.filePath] || "# " + req.filePath.replace(/\.md$/, "") + "\n\n*Empty note*" };
    },
    async "vault/write"(req: any) {
      await sleep(50);
      VAULT_CONTENTS[req.filePath] = req.content;
      if (!DEMO_VAULT_FILES.includes(req.filePath)) DEMO_VAULT_FILES.push(req.filePath);
      return { type: "vault/write.success" };
    },
    async "skills/list"(_req: any) {
      await sleep(200);
      return { type: "skills/list.success", skills: DEMO_SKILLS.filter((_sk) => _sk.id.startsWith("s")) };
    },
    async "skills/pin"(req: any) {
      await sleep(100);
      const skill = DEMO_SKILLS.find((sk) => sk.id === req.id);
      if (skill) skill.pinned = req.pinned;
      return { type: "skills/pin.success" };
    },
    async "skills/delete"(req: any) {
      await sleep(100);
      const idx = DEMO_SKILLS.findIndex((s) => s.id === req.id);
      if (idx >= 0) DEMO_SKILLS.splice(idx, 1);
      return { type: "skills/delete.success" };
    },
    async "watcher/list"() {
      await sleep(200);
      return { type: "watcher/list.success", watchers: DEMO_WATCHERS };
    },
    async "watcher/create"(_req: any) {
      await sleep(150);
      const w = { ..._req.data, id: uuid() };
      DEMO_WATCHERS.push(w);
      return { type: "watcher/create.success", watcher: w };
    },
    async "ingestion/scan"() {
      await sleep(1000);
      return { type: "ingestion/scan.success", files: ["doc1.pdf", "doc2.docx", "notes.md"] };
    },
    async "ingestion/ingest"(_req: any) {
      await sleep(2000);
      return { type: "ingestion/ingest.success", chunks: 42 };
    },
    async "run/events"() {
      return { type: "run/events.success", events: [] };
    },
    async "viewport/start"() {
      return { type: "viewport/start.success" };
    },
    async "conversation/send"(req: any) {
      await sleep(800);
      return {
        type: "conversation/send.success",
        message: { role: "assistant", content: `Demo response for: "${req.message?.content?.slice(0, 50)}..."` },
        runId: uuid(),
      };
    },
  };

  mockWindow.carbonAPI = {
    invoke: async (request: any) => {
      const type = request.type;
      const handler = handlers[type];
      if (!handler) {
        console.warn("[MockAPI] No handler for:", type, request);
        return { type: type + ".success" };
      }
      return handler(request);
    },
    onViewportFrame: () => () => {},
    onAgentTopology: () => () => {},
    onAXTree: () => () => {},
    onWatcherAnalytics: () => () => {},
    onVaultChange: () => () => {},
  };

  console.log("[CarbonAgent] Mock API installed for web development");
}
