import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function parseFile(filePath: string): { title: string; content: string; mimeType: string } {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);

  if (ext === ".txt" || ext === ".md" || ext === ".csv") {
    return { title: basename, content: buffer.toString("utf-8"), mimeType: ext === ".csv" ? "text/csv" : "text/plain" };
  }

  if (ext === ".html" || ext === ".htm") {
    const html = buffer.toString("utf-8");
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { title: basename, content: text, mimeType: "text/html" };
  }

  return { title: basename, content: buffer.toString("utf-8"), mimeType: "application/octet-stream" };
}

describe("parseFile", () => {
  it("parses a text file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-test-"));
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "Hello from test file");
    const result = parseFile(filePath);
    expect(result.title).toBe("test.txt");
    expect(result.content).toBe("Hello from test file");
    expect(result.mimeType).toBe("text/plain");
    fs.unlinkSync(filePath);
    fs.rmdirSync(tmpDir);
  });

  it("parses HTML and strips tags", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-test-"));
    const filePath = path.join(tmpDir, "test.html");
    fs.writeFileSync(filePath, "<html><body><p>Hello</p><script>alert(1)</script></body></html>");
    const result = parseFile(filePath);
    expect(result.content).toContain("Hello");
    expect(result.content).not.toContain("<script>");
    fs.unlinkSync(filePath);
    fs.rmdirSync(tmpDir);
  });
});
