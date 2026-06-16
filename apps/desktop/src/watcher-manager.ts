import { CarbonDatabase, initDatabase } from "@carbon-agent/local-store";
import { CronExpressionParser } from "cron-parser";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runAgent } from "./agent-runner.js";
import { emitWatcherAnalytics } from "./desktop-events.js";

interface WatcherRunSnapshot {
  watcherId: string;
  watcherName: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
}

export type WatcherTrigger = "cron" | "filesystem";

export class WatcherManager {
  private intervals = new Map<string, ReturnType<typeof setInterval>>();
  private fsWatchers = new Map<string, { close(): void }>();
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
        const trigger = (row.trigger as WatcherTrigger) ?? "cron";
        await this.start(watcherId, {
          trigger,
          cronExpression: row.cron_expression as string,
          watchPath: row.watch_path as string | undefined,
          recursive: (row.recursive as number | undefined) !== 0,
          prompt: row.prompt as string,
          workspaceId: row.workspace_id as string,
        });
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
          const trigger = (r.trigger as WatcherTrigger) ?? "cron";
          await this.start(r.id as string, {
            trigger,
            cronExpression: r.cron_expression as string,
            watchPath: r.watch_path as string | undefined,
            recursive: (r.recursive as number | undefined) !== 0,
            prompt: r.prompt as string,
            workspaceId: r.workspace_id as string,
          });
        }
      }
    } catch (e) {
      console.error("[WM] initAll error", e);
    }
  }

  private async start(
    watcherId: string,
    options: {
      trigger: WatcherTrigger;
      cronExpression?: string;
      watchPath?: string;
      recursive?: boolean;
      prompt: string;
      workspaceId: string;
    },
  ): Promise<void> {
    if (options.trigger === "filesystem") {
      await this.startFilesystemWatcher(watcherId, options);
    } else {
      const ms = this.cronToMs(options.cronExpression ?? "*/1 * * * *");
      const id = setInterval(() => {
        this.execute(watcherId, options.prompt, options.workspaceId).catch((e) => console.error("[W]", e));
      }, ms);
      this.intervals.set(watcherId, id);
    }

    try {
      const db = new CarbonDatabase();
      await db.updateWatcher(watcherId, { enabled: true });
    } catch { /* ignore */ }
  }

  private async startFilesystemWatcher(
    watcherId: string,
    options: {
      prompt: string;
      workspaceId: string;
      watchPath?: string;
      recursive?: boolean;
    },
  ): Promise<void> {
    if (!options.watchPath || !fs.existsSync(options.watchPath)) {
      console.warn(`[WM] filesystem watcher ${watcherId} has no valid path: ${options.watchPath}`);
      return;
    }

    const handler = async (filePath: string) => {
      await this.execute(watcherId, options.prompt, options.workspaceId, filePath);
    };

    const watcherHandle = await this.createFsWatcher(options.watchPath, options.recursive ?? true, handler);
    this.fsWatchers.set(watcherId, watcherHandle);
  }

  private async createFsWatcher(
    watchPath: string,
    recursive: boolean,
    onEvent: (filePath: string) => void | Promise<void>,
  ): Promise<{ close(): void }> {
    try {
      const chokidar = await import("chokidar");
      const watcher = chokidar.watch(watchPath, {
        ignored: /(^|[/\\])\../,
        persistent: true,
        ignoreInitial: true,
        depth: recursive ? undefined : 0,
      });
      watcher.on("add", (filePath: string) => onEvent(filePath));
      watcher.on("change", (filePath: string) => onEvent(filePath));
      return {
        close() {
          watcher.close().catch(() => {});
        },
      };
    } catch {
      // Fallback to fs.watch when chokidar is unavailable.
      const watcher = fs.watch(watchPath, { recursive }, (_eventType, filename) => {
        if (!filename) return;
        const fullPath = path.resolve(watchPath, filename);
        if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return;
        void onEvent(fullPath);
      });
      return {
        close() {
          watcher.close();
        },
      };
    }
  }

  stop(watcherId: string): void {
    const interval = this.intervals.get(watcherId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(watcherId);
    }
    const fsWatcher = this.fsWatchers.get(watcherId);
    if (fsWatcher) {
      fsWatcher.close();
      this.fsWatchers.delete(watcherId);
    }
  }

  dispose(): void {
    for (const [, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();
    for (const [, fsWatcher] of this.fsWatchers) {
      fsWatcher.close();
    }
    this.fsWatchers.clear();
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

  private async execute(
    watcherId: string,
    prompt: string,
    workspaceId: string,
    triggerFilePath?: string,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    try {
      await initDatabase();
      const db = new CarbonDatabase();
      const watcherRow = await db.getWatcher(watcherId);
      const watcherName = String(watcherRow?.name ?? watcherRow?.prompt ?? watcherId);
      await db.updateWatcher(watcherId, { lastRunAt: new Date().toISOString(), lastRunStatus: "running" });

      if (triggerFilePath) {
        await db.storeEpisodicEvent({
          id: crypto.randomUUID(),
          workspaceId,
          type: "task",
          summary: `File watcher ${watcherName} detected ${path.basename(triggerFilePath)}`,
          details: { watcherId, filePath: triggerFilePath, source: "filesystem" },
          outcome: "success",
          importance: 0.5,
          embedding: [],
        });
      }

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

      const result = await runAgent({
        db,
        workspaceId,
        conversationId,
        providerId,
        message: triggerFilePath
          ? `${prompt}\n\nDetected file: ${triggerFilePath}`
          : prompt,
        maxSteps: 30,
        defaultProfileId: watcherRow?.profile_id as string | undefined,
      });
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
