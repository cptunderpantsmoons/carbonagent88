import { Notification, type BrowserWindow } from "electron";
import { getLockedContext } from "@carbon-agent/cloak-bridge";

export interface DesktopAXTreeNode {
  role: string;
  name?: string;
  value?: string;
  axNodeId: string;
  children?: DesktopAXTreeNode[];
}

export interface DesktopViewportFrame {
  profileId: string;
  mimeType: string;
  base64: string;
}

export interface DesktopTopologyNode {
  id: string;
  label: string;
  status: "idle" | "running" | "completed" | "failed";
  x: number;
  y: number;
}

export interface DesktopTopologyEdge {
  from: string;
  to: string;
}

export interface DesktopWatcherRun {
  watcherId: string;
  watcherName: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
}

let mainWindow: BrowserWindow | null = null;

const profileTelemetry = new Map<string, {
  viewportTimer: ReturnType<typeof setInterval> | null;
  axTreeTimer: ReturnType<typeof setInterval> | null;
  viewportBusy: boolean;
  axTreeBusy: boolean;
}>();

function send(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function mapAXTreeNode(node: unknown, indexPath = "0"): DesktopAXTreeNode {
  const current = node as {
    role?: string;
    name?: string;
    value?: string;
    children?: unknown[];
  };

  const children = Array.isArray(current.children)
    ? current.children.map((child, index) => mapAXTreeNode(child, `${indexPath}.${index}`))
    : undefined;

  return {
    role: current.role ?? "unknown",
    name: current.name,
    value: current.value,
    axNodeId: `ax_${indexPath}`,
    children,
  };
}

async function captureViewport(profileId: string): Promise<void> {
  const context = getLockedContext(profileId);
  if (!context) return;

  const page = context.pages()[0] ?? await context.newPage();
  try {
    const buffer = await page.screenshot({ type: "jpeg", quality: 72 });
    send("carbon-event:viewport-frame", {
      profileId,
      mimeType: "image/jpeg",
      base64: Buffer.from(buffer).toString("base64"),
    } satisfies DesktopViewportFrame);
  } catch {
    // Ignore transient screenshot failures.
  }
}

async function captureAXTree(profileId: string): Promise<void> {
  const context = getLockedContext(profileId);
  if (!context) return;

  const page = context.pages()[0] ?? await context.newPage();
  try {
    const snapshot = await (page as unknown as {
      accessibility?: {
        snapshot(options?: { interestingOnly?: boolean }): Promise<unknown>;
      };
    }).accessibility?.snapshot({ interestingOnly: false });

    if (!snapshot) return;

    send("carbon-event:axtree", {
      profileId,
      tree: mapAXTreeNode(snapshot),
      activeNodeId: "ax_0",
    });
  } catch {
    // Ignore transient accessibility failures.
  }
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function emitVaultChange(payload: { workspaceId: string; filePath: string; content: string }): void {
  send("carbon-event:vault-change", payload);
}

export function emitAgentTopology(payload: { runId: string; nodes: DesktopTopologyNode[]; edges: DesktopTopologyEdge[] }): void {
  send("carbon-event:agent-topology", payload);
}

export function emitWatcherAnalytics(payload: { runs: DesktopWatcherRun[] }): void {
  send("carbon-event:watcher-analytics", payload);
}

export interface AnomalyDetectedPayload {
  anomalyId: string;
  watcherId?: string;
  connectorId?: string;
  workspaceId: string;
  metric: string;
  operator: string;
  observedValue: number;
  threshold?: number;
  severity: "info" | "warning" | "critical";
  message: string;
  triggeredAt: string;
}

export function emitAnomalyDetected(payload: AnomalyDetectedPayload): void {
  send("carbon-event:anomaly-detected", payload);
}

export interface ApprovalRequestedPayload {
  correlationId: string;
  sessionId: string;
  kind: "tool" | "plan" | "plan-step";
  priority: "low" | "medium" | "high";
  title: string;
  summary: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  requestedAt: string;
  timeoutAt?: string;
}

export interface ApprovalResolvedPayload {
  request: ApprovalRequestedPayload;
  decision: { decision: "approved" | "rejected"; reason?: string };
}

export function emitApprovalRequested(payload: ApprovalRequestedPayload): void {
  send("carbon-event:approval-requested", payload);
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: "Carbon Agent — approval requested",
          body: payload.title,
        });
        notification.show();
      }
    } catch {
      // Ignore transient notification failures.
    }
  }
}

export function emitApprovalResolved(payload: ApprovalResolvedPayload): void {
  send("carbon-event:approval-resolved", payload);
}

export async function startProfileTelemetry(profileId: string): Promise<void> {
  const current = profileTelemetry.get(profileId);
  if (current) {
    if (current.viewportTimer) clearInterval(current.viewportTimer);
    if (current.axTreeTimer) clearInterval(current.axTreeTimer);
  }

  const state = {
    viewportTimer: null as ReturnType<typeof setInterval> | null,
    axTreeTimer: null as ReturnType<typeof setInterval> | null,
    viewportBusy: false,
    axTreeBusy: false,
  };
  profileTelemetry.set(profileId, state);

  const viewportTick = async (): Promise<void> => {
    if (state.viewportBusy) return;
    state.viewportBusy = true;
    try {
      await captureViewport(profileId);
    } finally {
      state.viewportBusy = false;
    }
  };

  const axTreeTick = async (): Promise<void> => {
    if (state.axTreeBusy) return;
    state.axTreeBusy = true;
    try {
      await captureAXTree(profileId);
    } finally {
      state.axTreeBusy = false;
    }
  };

  await viewportTick();
  await axTreeTick();
  state.viewportTimer = setInterval(() => { void viewportTick(); }, 1500);
  state.axTreeTimer = setInterval(() => { void axTreeTick(); }, 2500);
}

export function stopProfileTelemetry(profileId: string): void {
  const state = profileTelemetry.get(profileId);
  if (!state) return;
  if (state.viewportTimer) clearInterval(state.viewportTimer);
  if (state.axTreeTimer) clearInterval(state.axTreeTimer);
  profileTelemetry.delete(profileId);
}
