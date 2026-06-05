import { describe, it, expect, vi } from "vitest";
import {
  extractGraphFromText,
  extractGraphWithLLM,
} from "./graph.js";

describe("Knowledge Graph Extraction", () => {
  describe("extractGraphFromText (regex fallback)", () => {
    it("extracts emails from text", () => {
      const text = "Contact john.doe@example.com or jane@company.org for details.";
      const result = extractGraphFromText(text);
      const emails = result.entities.filter(e => e.entityType === "email");
      expect(emails.length).toBeGreaterThanOrEqual(1);
      expect(emails[0].name).toBe("john.doe@example.com");
    });

    it("extracts URLs from text", () => {
      const text = "Visit https://example.com and http://test.org for more info.";
      const result = extractGraphFromText(text);
      const urls = result.entities.filter(e => e.entityType === "url");
      expect(urls.length).toBeGreaterThanOrEqual(1);
      expect(urls[0].name).toBe("https://example.com");
    });

    it("extracts relationship patterns", () => {
      const text = "Acme Corp signed with John Smith. Acme Corp is located in New York.";
      const result = extractGraphFromText(text);
      expect(result.entities.length).toBeGreaterThan(0);
    });

    it("returns empty arrays for empty text", () => {
      const result = extractGraphFromText("");
      expect(result.entities).toEqual([]);
      expect(result.relationships).toEqual([]);
    });
  });

  describe("extractGraphWithLLM", () => {
    it("falls back to regex when no LLM caller is provided", async () => {
      const text = "Contact alice@example.com for details about Project Alpha.";
      const result = await extractGraphWithLLM(text);
      const emails = result.entities.filter(e => e.entityType === "email");
      expect(emails.length).toBeGreaterThanOrEqual(1);
      expect(emails[0].name).toBe("alice@example.com");
    });

    it("uses LLM caller when provided and returns valid entities", async () => {
      const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
        entities: [
          { name: "Acme Corp", entityType: "company", properties: {} },
          { name: "John Doe", entityType: "person", properties: {} },
        ],
        relationships: [
          { sourceName: "John Doe", targetName: "Acme Corp", relationType: "works_for", properties: {} },
        ],
      }));

      const text = "John Doe works at Acme Corp as a senior engineer.";
      const result = await extractGraphWithLLM(text, mockLLM);

      expect(mockLLM).toHaveBeenCalled();
      expect(result.entities).toHaveLength(2);
      expect(result.entities[0].name).toBe("Acme Corp");
      expect(result.entities[1].name).toBe("John Doe");
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].relationType).toBe("works_for");
    });

    it("falls back to regex when LLM returns invalid JSON", async () => {
      const mockLLM = vi.fn().mockResolvedValue("This is not JSON at all");

      const text = "Contact bob@example.com for support.";
      const result = await extractGraphWithLLM(text, mockLLM);

      // Should fallback to regex and still find the email
      const emails = result.entities.filter(e => e.entityType === "email");
      expect(emails.length).toBeGreaterThanOrEqual(1);
    });

    it("falls back to regex when LLM returns empty entities", async () => {
      const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
        entities: [],
        relationships: [],
      }));

      const text = "Contact charlie@example.com for details.";
      const result = await extractGraphWithLLM(text, mockLLM);

      // Should fallback to regex since LLM returned no entities
      const emails = result.entities.filter(e => e.entityType === "email");
      expect(emails.length).toBeGreaterThanOrEqual(1);
    });

    it("handles LLM errors gracefully", async () => {
      const mockLLM = vi.fn().mockRejectedValue(new Error("Network error"));

      const text = "Contact dave@example.com for info.";
      const result = await extractGraphWithLLM(text, mockLLM);

      // Should fallback to regex
      const emails = result.entities.filter(e => e.entityType === "email");
      expect(emails.length).toBeGreaterThanOrEqual(1);
    });

    it("truncates long text to 12000 chars before sending to LLM", async () => {
      const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
        entities: [{ name: "Test", entityType: "company", properties: {} }],
        relationships: [],
      }));

      const longText = "a".repeat(20000);
      await extractGraphWithLLM(longText, mockLLM);

      const prompt = mockLLM.mock.calls[0][0];
      expect(prompt.length).toBeLessThanOrEqual(13000); // 12000 text + prompt template overhead
    });
  });
});
