import { CarbonDatabase, initDatabase } from "@carbon-agent/local-store";
import { CronExpressionParser } from "cron-parser";
import { runAgent } from "./agent-runner.js";
import { emitWatcherAnalytics } from "./desktop-events.js";

interface WatcherRunSnapshot {
  watcherId: string;
  watcherName: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
}

export class WatcherManager {
  private intervals = new Map<string, ReturnType<typeof setInterval>>();
  private history: WatcherRunSnapshot[] = [];

  private publishHistory(): void {
    emitWatcherAnalytics({ runs: this.history.slice(-50) });
  }

  async sync(watcherId: string): Promise<void> {
    this.stop(watcherId);
    try {
      await initDatabase();
      const db = new CarbonDatabase();
      const row = await db.getWatcher(watcherId);
      if (row && (row.enabled === 1 || row.enabled === true)) {
        await this.start(watcherId, row.cron_expression as string, row.prompt as string, row.workspace_id as string);
      }
    } catch (e) {
      console.error("[WM] sync error", e);
    }
  }

  async initAll(): Promise<void> {
    try {
      await initDatabase();
      const db = new CarbonDatabase();
      const rows = await db.listWatchers();
      for (const r of rows) {
        if (r.enabled === 1 || r.enabled === true) {
          await this.start(r.id as string, r.cron_expression as string, r.prompt as string, r.workspace_id as string);
        }
      }
    } catch (e) {
      console.error("[WM] initAll error", e);
    }
  }

  private async start(watcherId: string, cronExpression: string, prompt: string, workspaceId: string): Promise<void> {
    const ms = this.cronToMs(cronExpression);
    const id = setInterval(() => {
      this.execute(watcherId, prompt, workspaceId).catch((e) => console.error("[W]", e));
    }, ms);
    this.intervals.set(watcherId, id);
    try {
      const db = new CarbonDatabase();
      await db.updateWatcher(watcherId, { enabled: true });
    } catch { /* ignore */ }
  }

  stop(watcherId: string): void {
    const id = this.intervals.get(watcherId);
    if (id) {
      clearInterval(id);
      this.intervals.delete(watcherId);
    }
  }

  dispose(): void {
    for (const [, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }

  async executeNow(watcherId: string, prompt: string, workspaceId: string): Promise<void> {
    return this.execute(watcherId, prompt, workspaceId);
  }

  private cronToMs(cron: string): number {
    try {
      const interval = CronExpressionParser.parse(cron);
      const next = interval.next();
      const now = new Date();
      const diffMs = Math.max(60_000, next.getTime() - now.getTime());
      return Math.min(diffMs, 86_400_000);
    } catch {
      return 60_000;
    }
  }

  private async execute(watcherId: string, prompt: string, workspaceId: string): Promise<void> {
    const startedAt = new Date().toISOString();
    try {
      await initDatabase();
      const db = new CarbonDatabase();
      const watcherRow = await db.getWatcher(watcherId);
      const watcherName = String(watcherRow?.name ?? watcherRow?.prompt ?? watcherId);
      await db.updateWatcher(watcherId, { lastRunAt: new Date().toISOString(), lastRunStatus: "running" });

      // Find or use first provider
      const providers = await db.listProvidersWithKeys();
      if (providers.length === 0) {
        await db.updateWatcher(watcherId, { lastRunStatus: "failed" });
        console.error("[Watcher] No providers configured for workspace", workspaceId);
        this.history.push({ watcherId, watcherName, startedAt, completedAt: new Date().toISOString(), success: false });
        this.publishHistory();
        return;
      }
      const providerId = providers[0]!.id as string;

      // Create a conversation for this watcher run
      const conversationId = crypto.randomUUID();
      await db.createConversation({ id: conversationId, workspaceId });

      const result = await runAgent({ db, workspaceId, conversationId, providerId, message: prompt, maxSteps: 30, defaultProfileId: watcherRow?.profile_id as string | undefined });
      const watcherStatus = result.runStatus === "completed" ? "success" : "failed";

      await db.updateWatcher(watcherId, { lastRunStatus: watcherStatus });
      this.history.push({ watcherId, watcherName, startedAt, completedAt: new Date().toISOString(), success: watcherStatus === "success" });
      this.publishHistory();
      console.log(`[Watcher] ${watcherId} completed: ${watcherStatus}`);
    } catch (e) {
      console.error("[Watcher] execute error", e);
      try {
        const db = new CarbonDatabase();
        await db.updateWatcher(watcherId, { lastRunStatus: "failed" });
        const watcherRow = await db.getWatcher(watcherId);
        this.history.push({
          watcherId,
          watcherName: String(watcherRow?.name ?? watcherRow?.prompt ?? watcherId),
          startedAt,
          completedAt: new Date().toISOString(),
          success: false,
        });
        this.publishHistory();
      } catch { /* ignore */ }
    }
  }
}
