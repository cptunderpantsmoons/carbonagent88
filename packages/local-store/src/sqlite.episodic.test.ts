import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CarbonDatabase, initDatabase, saveDatabase, closeDatabase } from "./sqlite.js";
import path from "node:path";
import fs from "node:fs";

const testDbPath = "/tmp/carbon-test-episodic.db";
const workspaceId = "550e8400-e29b-41d4-a716-446655440200";

describe("CarbonDatabase episodic CRUD", () => {
  let db: CarbonDatabase;

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    await initDatabase(testDbPath);
    db = new CarbonDatabase();
    await db.createWorkspace({
      id: workspaceId,
      name: "Episodic Test",
      vaultDir: "/tmp/v-episodic",
    });
  });

  afterAll(() => {
    saveDatabase();
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it("stores and retrieves an episodic event", async () => {
    await db.storeEpisodicEvent({
      id: "evt-1",
      workspaceId,
      type: "task",
      summary: "Test task",
      details: { source: "test" },
      outcome: "success",
      embedding: [1, 0, 0],
      importance: 0.8,
    });

    const events = await db.findEpisodicEvents({ workspaceId });
    expect(events).toHaveLength(1);
    expect(String(events[0]?.id)).toBe("evt-1");
    expect(String(events[0]?.summary)).toBe("Test task");
  });

  it("filters events by type", async () => {
    await db.storeEpisodicEvent({
      id: "evt-2",
      workspaceId,
      type: "error",
      summary: "Test error",
      outcome: "failure",
    });

    const errors = await db.findEpisodicEvents({ workspaceId, types: "error" });
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.type)).toBe("error");

    const tasks = await db.findEpisodicEvents({ workspaceId, types: "task" });
    expect(tasks).toHaveLength(1);
  });

  it("filters events by date range", async () => {
    const after = new Date(Date.now() - 1000).toISOString();
    const events = await db.findEpisodicEvents({ workspaceId, after });
    expect(events.length).toBeGreaterThanOrEqual(2);

    const before = new Date(Date.now() - 86_400_000).toISOString();
    const old = await db.findEpisodicEvents({ workspaceId, before });
    expect(old).toHaveLength(0);
  });

  it("excludes embeddings when requested", async () => {
    const events = await db.findEpisodicEvents({ workspaceId, includeEmbeddings: false });
    expect(events[0]).not.toHaveProperty("embedding_json");
  });

  it("deletes events by ids", async () => {
    await db.deleteEpisodicEvents(["evt-1"]);
    const events = await db.findEpisodicEvents({ workspaceId, types: "task" });
    expect(events).toHaveLength(0);
  });

  it("deletes events by date range", async () => {
    await db.storeEpisodicEvent({
      id: "evt-old",
      workspaceId,
      type: "decision",
      summary: "Old decision",
      outcome: "success",
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const before = new Date(Date.now() - 3600_000).toISOString();
    await db.deleteEpisodicEventsByRange(workspaceId, before);

    const events = await db.findEpisodicEvents({ workspaceId, types: "decision" });
    expect(events).toHaveLength(0);
  });
});
