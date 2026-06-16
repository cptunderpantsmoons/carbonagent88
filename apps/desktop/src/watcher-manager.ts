import { CarbonDatabase, initDatabase } from "@carbon-agent/local-store";
import { CronExpressionParser } from "cron-parser";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runAgent } from "./agent-runner.js";
import { emitWatcherAnalytics, emitAnomalyDetected, type AnomalyDetectedPayload } from "./desktop-events.js";

interface WatcherRunSnapshot {
  watcherId: string;
  watcherName: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
}

export type WatcherRuleMetric =
  | "new_file_count"
  | "file_size"
  | "run_failure_rate"
  | "connector_item_count";

export type WatcherRuleOperator = "gt" | "lt" | "eq" | "changed";

export interface WatcherRule {
  id: string;
  watcherId: string;
  metric: WatcherRuleMetric;
  operator: WatcherRuleOperator;
  threshold?: number | null;
  windowMinutes: number;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
  targetId?: string | null;
}

interface RuleEvaluationContext {
  filePath?: string;
  fileSize?: number;
  runSuccess: boolean;
}

interface ConnectorSyncContext {
  connectorId: string;
  workspaceId: string;
  itemsProcessed: number;
}

function parseJson<T = unknown>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
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

  /**
   * Evaluate anomaly rules for a watcher after a run.
   */
  async evaluateRulesForWatcher(
    watcherId: string,
    workspaceId: string,
    context: RuleEvaluationContext,
  ): Promise<AnomalyDetectedPayload[]> {
    const db = new CarbonDatabase();
    const rows = await db.listAnomalyRulesForWatcher(watcherId);
    const rules: WatcherRule[] = rows.map((row) => ({
      id: String(row.id),
      watcherId: String(row.watcher_id),
      metric: String(row.metric) as WatcherRuleMetric,
      operator: String(row.operator) as WatcherRuleOperator,
      threshold: row.threshold == null ? null : Number(row.threshold),
      windowMinutes: Number(row.window_minutes ?? 60),
      severity: String(row.severity ?? "warning") as "info" | "warning" | "critical",
      enabled: Boolean(Number(row.enabled ?? 1)),
      targetId: row.target_id == null ? null : String(row.target_id),
    }));

    const triggered: AnomalyDetectedPayload[] = [];
    const now = new Date();

      for (const rule of rules) {
        if (!rule.enabled) continue;
        const observed = await this.computeMetric(db, workspaceId, rule, context);
        const payload = this.evaluateRule(rule, observed, now, workspaceId, watcherId);
        if (payload) {
          triggered.push(payload);
          await this.recordAnomalyEvent(db, workspaceId, payload, rule);
          emitAnomalyDetected(payload);
        }
      }

    this.publishHistory();
    return triggered;
  }

  /**
   * Evaluate connector-related anomaly rules after a connector sync.
   */
  async submitConnectorSyncResult(ctx: ConnectorSyncContext): Promise<AnomalyDetectedPayload[]> {
    const db = new CarbonDatabase();
    // Find all workspace rules with metric connector_item_count targeting this connector.
    const workspaceWatchers = await db.listWatchersForWorkspace(ctx.workspaceId);
    const triggered: AnomalyDetectedPayload[] = [];
    const now = new Date();

    for (const watcherRow of workspaceWatchers) {
      const rows = await db.listAnomalyRulesForWatcher(String(watcherRow.id));
      const rules: WatcherRule[] = rows
        .filter((row) => row.metric === "connector_item_count" && (row.target_id === ctx.connectorId || row.target_id == null))
        .map((row) => ({
          id: String(row.id),
          watcherId: String(row.watcher_id),
          metric: String(row.metric) as WatcherRuleMetric,
          operator: String(row.operator) as WatcherRuleOperator,
          threshold: row.threshold == null ? null : Number(row.threshold),
          windowMinutes: Number(row.window_minutes ?? 60),
          severity: String(row.severity ?? "warning") as "info" | "warning" | "critical",
          enabled: Boolean(Number(row.enabled ?? 1)),
          targetId: row.target_id == null ? null : String(row.target_id),
        }));

      for (const rule of rules) {
        if (!rule.enabled) continue;
        const payload = this.evaluateRule(rule, ctx.itemsProcessed, now, ctx.workspaceId, rule.watcherId, ctx.connectorId);
        if (payload) {
          triggered.push(payload);
          await this.recordAnomalyEvent(db, ctx.workspaceId, payload, rule);
          emitAnomalyDetected(payload);
        }
      }
    }

    this.publishHistory();
    return triggered;
  }

  private async computeMetric(
    db: CarbonDatabase,
    workspaceId: string,
    rule: WatcherRule,
    context: RuleEvaluationContext,
  ): Promise<number> {
    const windowMinutes = rule.windowMinutes;
    const after = new Date(Date.now() - windowMinutes * 60_000).toISOString();

    switch (rule.metric) {
      case "new_file_count": {
        const events = await db.findEpisodicEvents({
          workspaceId,
          types: "task",
          after,
          limit: 1000,
        });
        const fileEvents = events.filter((e) => {
          const details = parseJson(String(e.details_json ?? "{}")) as Record<string, unknown>;
          return details.source === "filesystem" || String(details.watcherId ?? "") === rule.watcherId;
        });
        return fileEvents.length;
      }
      case "file_size": {
        return context.fileSize ?? 0;
      }
      case "run_failure_rate": {
        const events = await db.findEpisodicEvents({
          workspaceId,
          types: "task",
          after,
          limit: 1000,
        });
        const watcherEvents = events.filter((e) => {
          const details = parseJson(String(e.details_json ?? "{}")) as Record<string, unknown>;
          return String(details.watcherId ?? "") === rule.watcherId;
        });
        if (watcherEvents.length === 0) return 0;
        const failures = watcherEvents.filter((e) => e.outcome !== "success").length;
        return failures / watcherEvents.length;
      }
      case "connector_item_count": {
        if (!rule.targetId) return 0;
        const runs = await db.listConnectorRuns(rule.targetId, 1);
        if (runs.length === 0) return 0;
        return Number(runs[0]?.items_processed ?? 0);
      }
      default:
        return 0;
    }
  }

  private evaluateRule(
    rule: WatcherRule,
    observed: number,
    now: Date,
    workspaceId: string,
    watcherId: string,
    connectorId?: string,
  ): AnomalyDetectedPayload | undefined {
    const threshold = rule.threshold ?? 0;
    let triggered = false;

    switch (rule.operator) {
      case "gt":
        triggered = observed > threshold;
        break;
      case "lt":
        triggered = observed < threshold;
        break;
      case "eq":
        triggered = observed === threshold;
        break;
      case "changed":
        triggered = observed !== 0;
        break;
    }

    if (!triggered) return undefined;

    return {
      anomalyId: crypto.randomUUID(),
      watcherId,
      connectorId,
      workspaceId,
      metric: rule.metric,
      operator: rule.operator,
      observedValue: observed,
      threshold: rule.threshold ?? undefined,
      severity: rule.severity,
      message: `${rule.metric} (${rule.operator}) triggered: observed ${observed}, threshold ${threshold}`,
      triggeredAt: now.toISOString(),
    };
  }

  private async recordAnomalyEvent(
    db: CarbonDatabase,
    workspaceId: string,
    payload: AnomalyDetectedPayload,
    rule: WatcherRule,
  ): Promise<void> {
    payload.workspaceId = workspaceId;
    await db.storeEpisodicEvent({
      id: payload.anomalyId,
      workspaceId,
      type: "error",
      summary: `Anomaly detected: ${rule.metric}`,
      details: {
        anomalyId: payload.anomalyId,
        watcherId: payload.watcherId,
        connectorId: payload.connectorId,
        metric: rule.metric,
        operator: rule.operator,
        observedValue: payload.observedValue,
        threshold: rule.threshold,
        severity: rule.severity,
        message: payload.message,
      },
      outcome: "failure",
      importance: rule.severity === "critical" ? 0.9 : rule.severity === "warning" ? 0.7 : 0.5,
      embedding: [],
    });
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

      // Evaluate anomaly rules
      let fileSize: number | undefined;
      if (triggerFilePath && fs.existsSync(triggerFilePath)) {
        try { fileSize = fs.statSync(triggerFilePath).size; } catch { /* ignore */ }
      }
      await this.evaluateRulesForWatcher(watcherId, workspaceId, {
        filePath: triggerFilePath,
        fileSize,
        runSuccess: watcherStatus === "success",
      });
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
        await this.evaluateRulesForWatcher(watcherId, workspaceId, {
          filePath: triggerFilePath,
          fileSize: triggerFilePath && fs.existsSync(triggerFilePath) ? fs.statSync(triggerFilePath).size : undefined,
          runSuccess: false,
        });
      } catch { /* ignore */ }
    }
  }
}
