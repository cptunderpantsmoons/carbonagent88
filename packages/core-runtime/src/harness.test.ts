import { describe, expect, it } from "vitest";
import { HarnessRegistry } from "./harness.js";
import type { Harness, HarnessExecutionInput, HarnessExecutionResult } from "./harness.js";

class FakeHarness implements Harness {
  id = "fake";
  name = "Fake Agent";
  type = "local" as const;
  capabilities = [{ name: "test", description: "testing capability" }];
  status: "idle" | "running" | "completed" | "failed" = "idle";

  async spawn(): Promise<HarnessExecutionResult> {
    return { success: true, output: "done", artifacts: [] };
  }
}

class BrowserHarness implements Harness {
  id = "browser-1";
  name = "Browser";
  type = "browser" as const;
  capabilities = [{ name: "scrape", description: "Web scraping" }];
  status: "idle" | "running" | "completed" | "failed" = "idle";

  async spawn(): Promise<HarnessExecutionResult> {
    return { success: true, output: "page html", artifacts: [] };
  }
}

describe("HarnessRegistry", () => {
  it("registers and retrieves harnesses", () => {
    const registry = new HarnessRegistry();
    const harness = new FakeHarness();
    registry.register(harness);
    expect(registry.get("fake")).toBe(harness);
    expect(registry.all()).toHaveLength(1);
  });

  it("unregisters harnesses by id", () => {
    const registry = new HarnessRegistry();
    registry.register(new FakeHarness());
    expect(registry.unregister("fake")).toBe(true);
    expect(registry.get("fake")).toBeUndefined();
  });

  it("filters harnesses by capability", () => {
    const registry = new HarnessRegistry();
    registry.register(new FakeHarness());
    registry.register(new BrowserHarness());
    expect(registry.byCapability("test")).toHaveLength(1);
    expect(registry.byCapability("scrape")).toHaveLength(1);
    expect(registry.byCapability("missing")).toHaveLength(0);
  });

  it("filters harnesses by type", () => {
    const registry = new HarnessRegistry();
    registry.register(new FakeHarness());
    registry.register(new BrowserHarness());
    expect(registry.byType("local")).toHaveLength(1);
    expect(registry.byType("browser")).toHaveLength(1);
    expect(registry.byType("code")).toHaveLength(0);
  });
});

describe("Harness interfaces", () => {
  it("FakeHarness satisfies Harness interface", async () => {
    const harness: Harness = new FakeHarness();
    const result = await harness.spawn({
      task: "do something",
      context: "test context",
      workspaceId: "ws-1",
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("done");
  });
});
