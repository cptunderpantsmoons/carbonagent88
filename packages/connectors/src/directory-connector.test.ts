import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DirectoryConnector } from "./directory-connector.js";

describe("DirectoryConnector", () => {
  let tmpDir: string;
  const connector = new DirectoryConnector();

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "carbon-dir-conn-"));
    fs.mkdirSync(path.join(tmpDir, "nested"));
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "Hello world");
    fs.writeFileSync(path.join(tmpDir, "b.md"), "# Title\nContent");
    fs.writeFileSync(path.join(tmpDir, "nested", "c.txt"), "Deep file");
    fs.writeFileSync(path.join(tmpDir, "skip.bin"), Buffer.from([0, 1, 2]));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans a directory recursively and lists text files as items", async () => {
    const result = await connector.fetch(
      {
        id: "conn-1",
        name: "test",
        workspaceId: "ws-1",
        type: "directory",
        enabled: true,
        options: { basePath: tmpDir, recursive: true },
      },
      {},
    );

    expect(result.items.length).toBeGreaterThanOrEqual(3);
    const titles = result.items.map((i) => i.title).sort();
    expect(titles).toContain("a.txt");
    expect(titles).toContain("b.md");
    expect(titles).toContain(path.join("nested", "c.txt"));
    const binary = result.items.find((i) => i.title === "skip.bin");
    expect(binary?.body).toContain("Binary file");
  });

  it("filters by extension when configured", async () => {
    const result = await connector.fetch(
      {
        id: "conn-2",
        name: "test",
        workspaceId: "ws-1",
        type: "directory",
        enabled: true,
        options: { basePath: tmpDir, recursive: false, extensions: [".md"] },
      },
      {},
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("b.md");
  });
});
