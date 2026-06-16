import { describe, it, expect, vi } from "vitest";
import { AgenticMemorySystem } from "./system.js";

describe("AgenticMemorySystem workspace membership gating", () => {
  it("blocks reads and writes when the membership resolver returns false", () => {
    const system = new AgenticMemorySystem({
      workspaceId: "ws-1",
      userId: "user-1",
      membershipResolver: () => false,
    });

    expect(() => system.storeMemory("key", "value")).toThrow("Access denied");
    expect(() => system.listMemories()).toThrow("Access denied");
    expect(() => system.recordEvent("task", "summary")).toThrow("Access denied");
    expect(() => system.storeGraphNode({ id: "n1", workspaceId: "ws-1", entityType: "person", name: "Alice" })).toThrow("Access denied");
  });

  it("allows reads and writes when the membership resolver returns true", () => {
    const system = new AgenticMemorySystem({
      workspaceId: "ws-1",
      userId: "user-1",
      membershipResolver: () => true,
    });

    expect(() => system.storeMemory("key", "value")).not.toThrow();
    expect(system.listMemories()).toHaveLength(1);
    expect(() => system.recordEvent("task", "summary")).not.toThrow();
    expect(() => system.storeGraphNode({ id: "n1", workspaceId: "ws-1", entityType: "person", name: "Alice" })).not.toThrow();
  });

  it("allows all operations when no membership resolver is configured", () => {
    const system = new AgenticMemorySystem({ workspaceId: "ws-1" });

    expect(() => system.storeMemory("key", "value")).not.toThrow();
    expect(() => system.listMemories()).not.toThrow();
    expect(() => system.storeGraphNode({ id: "n2", workspaceId: "ws-1", entityType: "company", name: "Acme" })).not.toThrow();
  });

  it("receives the correct workspace and user ids in the resolver", async () => {
    const resolver = vi.fn().mockReturnValue(true);
    const system = new AgenticMemorySystem({
      workspaceId: "ws-42",
      userId: "user-7",
      membershipResolver: resolver,
    });

    system.storeMemory("trigger", "test");
    expect(resolver).toHaveBeenCalledWith("ws-42", "user-7");
  });
});
