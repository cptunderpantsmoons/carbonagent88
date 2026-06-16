import { describe, it, expect, beforeEach } from "vitest";
import { createMemorySystem, type EpisodicEvent, type EpisodicPersistence } from "./system.js";

describe("AgenticMemorySystem episodic persistence", () => {
  const workspaceId = "ws-episodic-test";

  let persistedEvents: EpisodicEvent[] = [];
  let storedIds: string[] = [];
  let deletedIds: string[] = [];

  function createMockPersistence(initial: EpisodicEvent[] = []): EpisodicPersistence {
    persistedEvents = [...initial];
    storedIds = [];
    deletedIds = [];
    return {
      async load(wsId: string) {
        return persistedEvents.filter((e) => e.workspaceId === wsId);
      },
      async save(wsId: string, events: EpisodicEvent[]) {
        persistedEvents = persistedEvents.filter((e) => e.workspaceId !== wsId).concat(events.filter((e) => e.workspaceId === wsId));
      },
      async store(event: EpisodicEvent) {
        persistedEvents = persistedEvents.filter((e) => e.id !== event.id).concat([event]);
        storedIds.push(event.id);
      },
      async deleteEvents(ids: string[]) {
        persistedEvents = persistedEvents.filter((e) => !ids.includes(e.id));
        deletedIds.push(...ids);
      },
      async deleteEventsByRange() {
        // no-op for this test
      },
    };
  }

  it("should persist events via recordEvent", async () => {
    const persistence = createMockPersistence();
    const system = createMemorySystem({ workspaceId, episodic: { persistence } });

    const event = system.recordEvent("task", "Completed extraction");
    expect(event.summary).toBe("Completed extraction");

    // Give the async persistence store a tick to resolve.
    await new Promise((r) => setTimeout(r, 10));
    expect(storedIds).toContain(event.id);
    expect(persistedEvents).toHaveLength(1);
  });

  it("should hydrate persisted events on initialize", async () => {
    const initial: EpisodicEvent = {
      id: "evt-persisted",
      workspaceId,
      type: "task",
      summary: "Persisted task",
      details: {},
      outcome: "success",
      embedding: [],
      importance: 0.6,
      accessCount: 0,
      decayFactor: 1,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };
    const persistence = createMockPersistence([initial]);
    const system = createMemorySystem({ workspaceId, episodic: { persistence } });

    await system.initialize();

    const events = system.queryEvents({ usePersistence: true });
    expect(events.some((e) => e.event.id === "evt-persisted")).toBe(true);
  });

  it("should query by outcome", async () => {
    const persistence = createMockPersistence();
    const system = createMemorySystem({ workspaceId, episodic: { persistence } });

    system.recordEvent("task", "Task one", {}, "success");
    system.recordEvent("error", "Task two", {}, "failure");

    const failures = system.queryEvents({ outcome: "failure" });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.event.outcome).toBe("failure");
  });

  it("should include episodic events in export/import", async () => {
    const system = createMemorySystem({ workspaceId });
    const event = system.recordEvent("decision", "Important decision");

    const data = system.exportData();
    expect(data.episodicMemory.some((e) => e.id === event.id)).toBe(true);
  });
});
