/**
 * Desktop Approval Coordinator — wraps the core ApprovalCoordinator with
 * renderer events and optional SQLite persistence.
 */

import {
  ApprovalCoordinator,
  type ApprovalCoordinatorOptions,
  type ApprovalRequest,
  type ApprovalDecision,
} from "@carbon-agent/core-runtime";
import type { CarbonDatabase } from "@carbon-agent/local-store";
import { emitApprovalRequested, emitApprovalResolved } from "./desktop-events.js";

export type { ApprovalRequest, ApprovalDecision };

interface PendingApprovalDb {
  listPendingApprovals(sessionId?: string): Promise<Record<string, unknown>[]>;
  savePendingApproval(p: {
    correlationId: string;
    sessionId: string;
    kind: string;
    priority: string;
    title: string;
    summary: string;
    toolName?: string;
    arguments?: Record<string, unknown>;
    requestedAt: string;
    timeoutAt?: string;
  }): Promise<void>;
  deletePendingApproval(correlationId: string): Promise<void>;
}

function mapApprovalRow(row: Record<string, unknown>): ApprovalRequest {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(String(row.arguments_json ?? "{}")); } catch { /* ignore */ }
  return {
    correlationId: String(row.correlation_id),
    sessionId: String(row.session_id),
    kind: String(row.kind) as ApprovalRequest["kind"],
    priority: String(row.priority) as ApprovalRequest["priority"],
    title: String(row.title),
    summary: String(row.summary),
    toolName: row.tool_name == null ? undefined : String(row.tool_name),
    arguments: args,
    requestedAt: String(row.requested_at),
    timeoutAt: row.timeout_at == null ? undefined : String(row.timeout_at),
  };
}

function buildCoordinatorOptions(db?: PendingApprovalDb): ApprovalCoordinatorOptions {
  return {
    defaultTimeoutMs: 5 * 60 * 1000,
    onRequest: async (request: ApprovalRequest) => {
      emitApprovalRequested(request);
      if (db) {
        await db.savePendingApproval({
          correlationId: request.correlationId,
          sessionId: request.sessionId,
          kind: request.kind,
          priority: request.priority,
          title: request.title,
          summary: request.summary,
          toolName: request.toolName,
          arguments: request.arguments,
          requestedAt: request.requestedAt,
          timeoutAt: request.timeoutAt,
        });
      }
    },
    onResolve: async (request: ApprovalRequest, decision: ApprovalDecision) => {
      emitApprovalResolved({ request, decision });
      if (db) {
        await db.deletePendingApproval(request.correlationId);
      }
    },
    loadPending: db
      ? async () => {
        const rows = await db.listPendingApprovals();
        return rows.map(mapApprovalRow);
      }
      : undefined,
    savePending: db
      ? async (requests: ApprovalRequest[]) => {
        // Persist each pending request. Resolved rows are removed via onResolve.
        for (const request of requests) {
          await db.savePendingApproval({
            correlationId: request.correlationId,
            sessionId: request.sessionId,
            kind: request.kind,
            priority: request.priority,
            title: request.title,
            summary: request.summary,
            toolName: request.toolName,
            arguments: request.arguments,
            requestedAt: request.requestedAt,
            timeoutAt: request.timeoutAt,
          });
        }
      }
      : undefined,
  };
}

let coordinator: ApprovalCoordinator | null = null;
let boundDb: PendingApprovalDb | undefined;

export function setApprovalDb(db: PendingApprovalDb): void {
  boundDb = db;
  if (coordinator) {
    // Options are captured at construction; if the DB becomes available later,
    // callers should re-create the coordinator via createApprovalCoordinator.
  }
}

export function createApprovalCoordinator(db?: PendingApprovalDb): ApprovalCoordinator {
  if (db) boundDb = db;
  coordinator = new ApprovalCoordinator(buildCoordinatorOptions(boundDb));
  return coordinator;
}

export function getApprovalCoordinator(): ApprovalCoordinator {
  if (!coordinator) {
    coordinator = new ApprovalCoordinator(buildCoordinatorOptions(boundDb));
  }
  return coordinator;
}

export async function loadPendingApprovalsFromDb(db: CarbonDatabase): Promise<void> {
  setApprovalDb(db as unknown as PendingApprovalDb);
  const coord = getApprovalCoordinator();
  await coord.loadFromDb();
}
