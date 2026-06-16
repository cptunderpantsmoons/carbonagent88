import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "./approval-coordinator.js";
import { ApprovalCoordinator } from "./approval-coordinator.js";

describe("ApprovalCoordinator", () => {
  const coordinator = new ApprovalCoordinator({ defaultTimeoutMs: 50 });

  it("resolves an approval when approved", async () => {
    const summary = "Approve me";
    const promise = coordinator.requestApproval("session-1", "tool", "Test approval", summary);

    // Give the coordinator a tick to register the pending request.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const pending = coordinator.listPending("session-1");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.summary).toBe(summary);

    const approved = coordinator.approve(pending[0]!.correlationId, "user approved");
    expect(approved).toBe(true);

    const result = await promise;
    expect(result.decision).toBe("approved");
    expect(result.reason).toBe("user approved");
    expect(coordinator.listPending("session-1")).toHaveLength(0);
  });

  it("rejects an approval when rejected", async () => {
    const promise = coordinator.requestApproval("session-2", "plan", "Plan approval", "Plan summary");
    await new Promise((resolve) => setTimeout(resolve, 5));

    const pending = coordinator.listPending("session-2");
    expect(pending).toHaveLength(1);

    const rejected = coordinator.reject(pending[0]!.correlationId, "user denied");
    expect(rejected).toBe(true);

    const result = await promise;
    expect(result.decision).toBe("rejected");
    expect(result.reason).toBe("user denied");
  });

  it("auto-rejects on timeout", async () => {
    const shortCoordinator = new ApprovalCoordinator({ defaultTimeoutMs: 20 });
    const promise = shortCoordinator.requestApproval("session-3", "tool", "Timeout test", "Will timeout");

    const result = await promise;
    expect(result.decision).toBe("rejected");
    expect(result.reason).toBe("timeout");
  });

  it("uses injected callbacks", async () => {
    const onRequest = vi.fn();
    const onResolve = vi.fn();
    const c = new ApprovalCoordinator({ defaultTimeoutMs: 1000, onRequest, onResolve });

    const promise = c.requestApproval("session-4", "tool", "Callback test", "Callbacks");
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-4", title: "Callback test" }));

    const pending = c.listPending("session-4");
    c.approve(pending[0]!.correlationId);
    await promise;

    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: pending[0]!.correlationId }),
      expect.objectContaining({ decision: "approved" }),
    );
  });

  it("loads pending requests from persistence", async () => {
    const recovered: ApprovalRequest = {
      correlationId: "550e8400-e29b-41d4-a716-446655440000",
      sessionId: "session-5",
      kind: "tool",
      priority: "high",
      title: "Recovered",
      summary: "Recovered from DB",
      requestedAt: new Date().toISOString(),
      timeoutAt: new Date(Date.now() + 1000).toISOString(),
    };

    const c = new ApprovalCoordinator({ loadPending: vi.fn().mockResolvedValue([recovered]), defaultTimeoutMs: 1000 });
    await c.loadFromDb();

    expect(c.listPending("session-5")).toHaveLength(1);
    expect(c.listPending("session-5")[0]?.title).toBe("Recovered");
  });
});
