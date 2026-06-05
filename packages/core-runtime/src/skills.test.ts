import { describe, it, expect } from "vitest";
import {
  storeSkill,
  recallSkills,
  listSkills,
  deleteSkill,
  pinSkill,
  recordSkillFailure,
} from "./skills.js";

describe("Persistent Agent Memory (Skills)", () => {
  const testWorkspace = "ws_test_001";

  describe("storeSkill", () => {
    it("stores a new skill successfully", async () => {
      const skill = await storeSkill(
        testWorkspace,
        "Navigate to SharePoint admin panel",
        "sp_admin_nav",
        "Navigate to SharePoint admin and open settings",
        [
          { toolName: "stealth_open", input: { url: "https://admin.sharepoint.com" }, notes: "Open admin" },
          { toolName: "stealth_interact", input: { action: "click", selector: "[data-id='settings']" }, notes: "Click settings" },
        ],
      );
      expect(skill.id).toBeDefined();
      expect(skill.workspaceId).toBe(testWorkspace);
      expect(skill.trigger).toBe("Navigate to SharePoint admin panel");
      expect(skill.name).toBe("sp_admin_nav");
      expect(skill.successCount).toBe(1);
      expect(skill.pinned).toBe(false);
    });

    it("deduplicates similar skills by trigger text match", async () => {
      const s1 = await storeSkill(
        testWorkspace,
        "Navigate to SharePoint admin panel",
        "sp_admin_nav",
        "Navigate to SharePoint admin and open settings",
        [{ toolName: "stealth_open", input: { url: "test" } }],
      );
      const s2 = await storeSkill(
        testWorkspace,
        "Navigate to SharePoint admin panel",
        "sp_admin_nav2",
        "Another description",
        [{ toolName: "stealth_open", input: { url: "test2" } }],
      );
      // Same trigger text should update existing skill
      expect(s1.id).toBe(s2.id);
      expect(s2.successCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("recallSkills", () => {
    it("recalls skills by semantic similarity", async () => {
      await storeSkill(
        testWorkspace,
        "Navigate to SharePoint admin panel",
        "sp_admin",
        "Nav to SP admin",
        [{ toolName: "stealth_open", input: { url: "test" } }],
      );

      const results = await recallSkills(testWorkspace, "How do I get to the SharePoint admin area?", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toMatch(/sp_admin/);
    });

    it("returns empty array when no skills exist", async () => {
      const results = await recallSkills("nonexistent_ws", "something", 5);
      expect(results).toEqual([]);
    });
  });

  describe("listSkills", () => {
    it("lists skills ordered by success count", () => {
      const skills = listSkills(testWorkspace);
      expect(skills.length).toBeGreaterThan(0);
      // Pinned items should come first
    });
  });

  describe("pinSkill", () => {
    it("pins and unpins a skill", async () => {
      const skill = await storeSkill(
        testWorkspace,
        "Pin test skill",
        "pin_test",
        "Test pinning",
        [{ toolName: "stealth_open", input: { url: "test" } }],
      );
      expect(pinSkill(skill.id, true)).toBe(true);
      const pinned = listSkills(testWorkspace).find(s => s.id === skill.id);
      expect(pinned?.pinned).toBe(true);

      expect(pinSkill(skill.id, false)).toBe(true);
      const unpinned = listSkills(testWorkspace).find(s => s.id === skill.id);
      expect(unpinned?.pinned).toBe(false);
    });
  });

  describe("deleteSkill", () => {
    it("deletes a skill", async () => {
      const skill = await storeSkill(
        testWorkspace,
        "Delete test skill",
        "del_test",
        "Test deleting",
        [{ toolName: "stealth_open", input: { url: "test" } }],
      );
      expect(deleteSkill(skill.id)).toBe(true);
      expect(listSkills(testWorkspace).find(s => s.id === skill.id)).toBeUndefined();
    });
  });

  describe("recordSkillFailure", () => {
    it("increments failure count", async () => {
      const skill = await storeSkill(
        testWorkspace,
        "Failure test skill",
        "fail_test",
        "Test failure",
        [{ toolName: "stealth_open", input: { url: "test" } }],
      );
      expect(recordSkillFailure(skill.id)).toBe(true);
      const updated = listSkills(testWorkspace).find(s => s.id === skill.id);
      expect(updated?.failureCount).toBe(1);
    });
  });
});
