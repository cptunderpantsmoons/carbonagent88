/**
 * ApprovalCoordinator — human-in-the-loop confirmation engine.
 *
 * Control Corridor:
 * - Owns: pending approval state, timeouts, resume/reject callbacks.
 * - Must NOT own: renderer events, local-store persistence, Electron notifications.
 *
 * Persistence is injected via optional load/save callbacks so that desktop
 * can wire SQLite without coupling core-runtime to local-store.
 */

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

export type ApprovalKind = "tool" | "plan" | "plan-step";

export type ApprovalPriority = "low" | "medium" | "high";

export interface ApprovalRequest {
  correlationId: string;
  sessionId: string;
  kind: ApprovalKind;
  priority: ApprovalPriority;
  title: string;
  summary: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  requestedAt: string;
  timeoutAt?: string;
}

export interface ApprovalDecision {
  decision: "approved" | "rejected";
  reason?: string;
}

export interface ApprovalCoordinatorOptions {
  /** Default timeout in milliseconds (default 5 minutes). */
  defaultTimeoutMs?: number;
  /** Called when a new approval request is created so the renderer can ask the user. */
  onRequest?: (request: ApprovalRequest) => void | Promise<void>;
  /** Called when a request is resolved (approved, rejected, or timed out). */
  onResolve?: (request: ApprovalRequest, decision: ApprovalDecision) => void | Promise<void>;
  /** Optional persistence: load pending requests, e.g. after a crash. */
  loadPending?: () => ApprovalRequest[] | Promise<ApprovalRequest[]>;
  /** Optional persistence: save the current list of pending requests. */
  savePending?: (requests: ApprovalRequest[]) => void | Promise<void>;
}

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (value: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApprovalCoordinator {
  private options: Required<Pick<ApprovalCoordinatorOptions, "defaultTimeoutMs">> &
    Omit<ApprovalCoordinatorOptions, "defaultTimeoutMs">;
  private pending = new Map<string, PendingEntry>();

  constructor(options: ApprovalCoordinatorOptions = {}) {
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs ?? 5 * 60 * 1000,
      onRequest: options.onRequest,
      onResolve: options.onResolve,
      loadPending: options.loadPending,
      savePending: options.savePending,
    };
  }

  /**
   * Load pending approvals from the injected persistence layer and arm
   * their timeouts. Should be called once after the process starts.
   */
  async loadFromDb(): Promise<void> {
    const loader = this.options.loadPending;
    if (!loader) return;
    const requests = await loader();
    for (const request of requests) {
      if (!request.correlationId) continue;
      // Re-arm the timer with whatever time remains from the original timeout.
      const timeoutAt = request.timeoutAt ? new Date(request.timeoutAt).getTime() : 0;
      const remaining = timeoutAt ? Math.max(0, timeoutAt - Date.now()) : this.options.defaultTimeoutMs;
      this.track(request, remaining);
    }
    await this.flush();
  }

  /**
   * Save pending approvals to the injected persistence layer.
   */
  async saveToDb(): Promise<void> {
    await this.flush();
  }

  /**
   * Request approval for an action. Returns a promise that resolves when the
   * user approves/rejects or rejects automatically on timeout.
   */
  requestApproval(
    sessionId: string,
    kind: ApprovalKind,
    title: string,
    summary: string,
    options?: {
      priority?: ApprovalPriority;
      toolName?: string;
      arguments?: Record<string, unknown>;
      correlationId?: string;
      timeoutMs?: number;
    },
  ): Promise<ApprovalDecision> {
    const timeoutMs = options?.timeoutMs ?? this.options.defaultTimeoutMs;
    const correlationId = options?.correlationId ?? randomId();
    const requestedAt = nowIso();
    const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();
    const request: ApprovalRequest = {
      correlationId,
      sessionId,
      kind,
      priority: options?.priority ?? "medium",
      title,
      summary,
      toolName: options?.toolName,
      arguments: options?.arguments,
      requestedAt,
      timeoutAt,
    };

    return new Promise<ApprovalDecision>((resolve) => {
      this.track(request, timeoutMs, resolve);
      void this.emitRequest(request);
      void this.flush();
    });
  }

  approve(correlationId: string, reason?: string): boolean {
    const entry = this.pending.get(correlationId);
    if (!entry) return false;
    this.resolve(entry, { decision: "approved", reason });
    return true;
  }

  reject(correlationId: string, reason?: string): boolean {
    const entry = this.pending.get(correlationId);
    if (!entry) return false;
    this.resolve(entry, { decision: "rejected", reason: reason ?? "rejected by user" });
    return true;
  }

  listPending(sessionId?: string): ApprovalRequest[] {
    const all = Array.from(this.pending.values()).map((entry) => entry.request);
    if (!sessionId) return all;
    return all.filter((request) => request.sessionId === sessionId);
  }

  getPending(correlationId: string): ApprovalRequest | undefined {
    return this.pending.get(correlationId)?.request;
  }

  private track(request: ApprovalRequest, timeoutMs: number, resolve?: (value: ApprovalDecision) => void): void {
    if (this.pending.has(request.correlationId)) {
      // If this request is already known (e.g. from crash recovery), keep the
      // original resolver if a new one wasn't provided.
      const existing = this.pending.get(request.correlationId)!;
      if (resolve) {
        clearTimeout(existing.timer);
        const timer = setTimeout(() => {
          this.resolve(existing, { decision: "rejected", reason: "timeout" });
        }, timeoutMs);
        this.pending.set(request.correlationId, { request, resolve, timer });
      }
      return;
    }

    const resolver = resolve ?? ((_decision: ApprovalDecision) => {
      // Default resolver for crash-recovered requests: resolved into the void.
    });
    const entry: PendingEntry = {
      request,
      resolve: resolver,
      timer: setTimeout(() => {
        this.resolve(entry, { decision: "rejected", reason: "timeout" });
      }, timeoutMs),
    };
    this.pending.set(request.correlationId, entry);
  }

  private resolve(entry: PendingEntry, decision: ApprovalDecision): void {
    if (!this.pending.has(entry.request.correlationId)) return;
    clearTimeout(entry.timer);
    this.pending.delete(entry.request.correlationId);
    entry.resolve(decision);
    void this.emitResolve(entry.request, decision);
    void this.flush();
  }

  private async emitRequest(request: ApprovalRequest): Promise<void> {
    try {
      await this.options.onRequest?.(request);
    } catch {
      // Renderer/notification failures must not block the approval promise.
    }
  }

  private async emitResolve(request: ApprovalRequest, decision: ApprovalDecision): Promise<void> {
    try {
      await this.options.onResolve?.(request, decision);
    } catch {
      // Same as above: persistence/notification failures are non-blocking.
    }
  }

  private async flush(): Promise<void> {
    const saver = this.options.savePending;
    if (!saver) return;
    const requests = this.listPending();
    try {
      await saver(requests);
    } catch {
      // Persistence is best-effort for the coordinator's own operations.
    }
  }
}
