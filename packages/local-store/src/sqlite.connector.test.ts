import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CarbonDatabase, initDatabase, saveDatabase, closeDatabase } from "./sqlite";
import path from "node:path";
import fs from "node:fs";

describe("CarbonDatabase connector CRUD", () => {
  let db: CarbonDatabase;
  const testDbPath = "/tmp/carbon-test-connectors.db";
  const workspaceId = "550e8400-e29b-41d4-a716-446655440100";

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    await initDatabase(testDbPath);
    db = new CarbonDatabase();
    await db.createWorkspace({
      id: workspaceId,
      name: "Connector Test",
      vaultDir: "/tmp/v-connector",
    });
  });

  afterAll(() => {
    saveDatabase();
    closeDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it("creates and retrieves a connector config", async () => {
    await db.createConnectorConfig({
      id: "conn-1",
      workspaceId,
      name: "Directory watched",
      type: "directory",
      enabled: true,
      schedule: "*/15 * * * *",
      credentials: "secret-token",
      options: { basePath: "/tmp/docs" },
    });

    const config = await db.getConnectorConfig("conn-1");
    expect(config).toBeDefined();
    expect(String(config?.name)).toBe("Directory watched");
    expect(String(config?.type)).toBe("directory");
    expect(String(config?.schedule)).toBe("*/15 * * * *");
    expect(config?.credentials_plaintext).toBe("secret-token");
    expect(JSON.parse(String(config?.options_json ?? "{}"))).toEqual({ basePath: "/tmp/docs" });
  });

  it("lists connector configs for a workspace", async () => {
    await db.createConnectorConfig({
      id: "conn-2",
      workspaceId,
      name: "REST API",
      type: "rest",
      enabled: false,
      options: { url: "https://example.com/api" },
    });
    const configs = await db.listConnectorConfigs(workspaceId);
    expect(configs.length).toBeGreaterThanOrEqual(2);
    expect(configs.some((c) => String(c.name) === "REST API")).toBe(true);
  });

  it("updates a connector config", async () => {
    await db.updateConnectorConfig("conn-1", { name: "Renamed", enabled: false, credentials: "new-secret" });
    const updated = await db.getConnectorConfig("conn-1");
    expect(String(updated?.name)).toBe("Renamed");
    expect(updated?.enabled).toBe(0);
    expect(updated?.credentials_plaintext).toBe("new-secret");
  });

  it("records and lists connector runs", async () => {
    await db.recordConnectorRun({
      id: "run-1",
      connectorId: "conn-1",
      workspaceId,
      startedAt: new Date().toISOString(),
      status: "success",
      itemsProcessed: 42,
    });
    const runs = await db.listConnectorRuns("conn-1");
    expect(runs).toHaveLength(1);
    expect(Number(runs[0]?.items_processed)).toBe(42);
    expect(String(runs[0]?.status)).toBe("success");
  });

  it("stores and retrieves connector state", async () => {
    await db.updateConnectorState({
      connectorId: "conn-1",
      workspaceId,
      cursor: "cursor-abc",
      lastItemId: "item-99",
    });
    const state = await db.getConnectorState("conn-1");
    expect(String(state?.cursor)).toBe("cursor-abc");
    expect(String(state?.last_item_id)).toBe("item-99");
  });

  it("stores and deletes anomaly rules", async () => {
    await db.createWatcher({
      id: "w-1",
      workspaceId,
      name: "Watcher",
      trigger: "filesystem",
      prompt: "go",
      enabled: true,
    });
    await db.createAnomalyRule({
      id: "rule-1",
      watcherId: "w-1",
      metric: "new_file_count",
      operator: "gt",
      threshold: 5,
      severity: "warning",
    });
    const rules = await db.listAnomalyRulesForWatcher("w-1");
    expect(rules).toHaveLength(1);
    expect(Number(rules[0]?.threshold)).toBe(5);

    await db.deleteAnomalyRule("rule-1");
    const after = await db.listAnomalyRulesForWatcher("w-1");
    expect(after).toHaveLength(0);
  });

  it("deletes a connector and cleans up state", async () => {
    await db.deleteConnectorConfig("conn-1");
    const config = await db.getConnectorConfig("conn-1");
    expect(config).toBeUndefined();
    const state = await db.getConnectorState("conn-1");
    expect(state).toBeUndefined();
  });
});
