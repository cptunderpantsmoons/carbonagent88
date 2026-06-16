import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { initDatabase, closeDatabase, saveDatabase, CarbonDatabase } from "./sqlite.js";
import {
  initSkillsTable,
  dbStoreSkill,
  dbListSkills,
  dbTogglePin,
  dbDeleteSkill,
  dbRecallSkillsBySimilarity,
} from "./skills.js";

describe("local-store skills persistence", () => {
  const testDbPath = "/tmp/carbon-test-skills.db";

  beforeAll(async () => {
    await initDatabase(testDbPath);
    await initSkillsTable();
    const db = new CarbonDatabase();
    await db.createWorkspace({
      id: "ws-skill-test",
      name: "Skill Test",
      vaultDir: "/tmp/v-skill",
    });
  });

  afterAll(() => {
    saveDatabase();
    closeDatabase();
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = testDbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it("stores, lists, pins, recalls, and deletes skills", async () => {
    await dbStoreSkill({
      id: "skill-1",
      workspaceId: "ws-skill-test",
      trigger: "inspect a portal",
      triggerEmbedding: [1, 0, 0],
      name: "portal_inspect",
      description: "Inspect a portal",
      toolSequence: [{ toolName: "stealth_open", input: { url: "https://example.com" } }],
    });

    let skills = await dbListSkills("ws-skill-test");
    expect(skills).toHaveLength(1);
    expect(skills[0]?.pinned).toBe(0);

    await dbTogglePin("skill-1", true);
    skills = await dbListSkills("ws-skill-test");
    expect(skills[0]?.pinned).toBe(1);

    const recalled = await dbRecallSkillsBySimilarity("ws-skill-test", [1, 0, 0], 5);
    expect(recalled[0]?.id).toBe("skill-1");

    await dbDeleteSkill("skill-1");
    skills = await dbListSkills("ws-skill-test");
    expect(skills).toHaveLength(0);
  });
});
