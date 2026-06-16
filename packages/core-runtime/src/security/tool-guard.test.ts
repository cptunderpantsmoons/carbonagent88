import { describe, it, expect } from "vitest";
import { createToolGuard, permitTool } from "./tool-guard.js";

describe("tool-guard", () => {
  it("allows tools without permission metadata", () => {
    const resolver = createToolGuard([]);
    expect(permitTool(undefined, resolver)).toBe(true);
    expect(permitTool([], resolver)).toBe(true);
  });

  it("grants listed permissions", () => {
    const resolver = createToolGuard(["tools:browser", "memory:write"]);
    expect(resolver("tools:browser")).toBe(true);
    expect(resolver("memory:write")).toBe(true);
    expect(resolver("skills:write")).toBe(false);
  });

  it("requires all tool permissions (AND semantics)", () => {
    const resolver = createToolGuard(["tools:terminal"]);
    expect(permitTool(["tools:terminal"], resolver)).toBe(true);
    expect(permitTool(["tools:terminal", "workspace:write"], resolver)).toBe(false);
  });

  it("permits when resolver grants every permission", () => {
    const resolver = createToolGuard(["a", "b", "c"]);
    expect(permitTool(["a", "b"], resolver)).toBe(true);
  });
});
