import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CarbonDatabase, initDatabase, saveDatabase, closeDatabase } from "./sqlite";
import { hasPermission, canAccessWorkspace, getUserEffectiveRole } from "./rbac";

describe("RBAC resolution", () => {
  let db: CarbonDatabase;
  const testDbPath = "/tmp/carbon-test-rbac-resolution.db";

  beforeAll(async () => {
    await initDatabase(testDbPath);
    db = new CarbonDatabase();
    await db.ensureDefaultTenantAndAdmin();
  });

  afterAll(async () => {
    saveDatabase();
    closeDatabase();
    const fs = require("node:fs");
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    for (const ext of ["-wal", "-shm"]) {
      const walPath = testDbPath + ext;
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    }
  });

  it("admin has all permissions", async () => {
    const admin = await db.getUserByEmail("admin@local");
    expect(await hasPermission(db, String(admin?.id), "role:manage")).toBe(true);
    expect(await hasPermission(db, String(admin?.id), "workspace:delete")).toBe(true);
  });

  it("member is denied role:manage and workspace:delete", async () => {
    const tenant = await db.getTenant("00000000-0000-0000-0000-000000000001");
    const memberRole = (await db.listRoles(String(tenant?.id))).find((r: any) => r.name === "member");
    const userId = "44444444-4444-4444-4444-444444444444";
    await db.createUser({
      id: userId,
      tenantId: String(tenant?.id),
      email: "member2@local",
      name: "Member",
      passwordHash: "x",
      roleId: String(memberRole?.id),
      active: true,
    });

    expect(await hasPermission(db, userId, "workspace:write")).toBe(true);
    expect(await hasPermission(db, userId, "role:manage")).toBe(false);
    expect(await hasPermission(db, userId, "workspace:delete")).toBe(false);
  });

  it("workspace role overrides tenant role", async () => {
    const tenant = await db.getTenant("00000000-0000-0000-0000-000000000001");
    const viewerRole = (await db.listRoles(String(tenant?.id))).find((r: any) => r.name === "viewer");
    const memberRole = (await db.listRoles(String(tenant?.id))).find((r: any) => r.name === "member");
    const userId = "55555555-5555-5555-5555-555555555555";
    await db.createUser({
      id: userId,
      tenantId: String(tenant?.id),
      email: "viewer@local",
      name: "Viewer",
      passwordHash: "x",
      roleId: String(viewerRole?.id),
      active: true,
    });

    const wsId = "66666666-6666-6666-6666-666666666666";
    await db.createWorkspace({ id: wsId, name: "Override", vaultDir: "/tmp", tenantId: String(tenant?.id) });

    expect(await getUserEffectiveRole(db, userId)).toEqual(expect.objectContaining({ roleName: "viewer" }));

    await db.addWorkspaceMember(wsId, userId, String(memberRole?.id));
    expect(await getUserEffectiveRole(db, userId, wsId)).toEqual(expect.objectContaining({ roleName: "member" }));

    expect(await hasPermission(db, userId, "workspace:write", { workspaceId: wsId })).toBe(true);
    expect(await hasPermission(db, userId, "workspace:write")).toBe(false);
  });

  it("canAccessWorkspace respects tenant boundaries and role permissions", async () => {
    const tenant = await db.getTenant("00000000-0000-0000-0000-000000000001");
    const viewerRole = (await db.listRoles(String(tenant?.id))).find((r: any) => r.name === "viewer");
    const memberRole = (await db.listRoles(String(tenant?.id))).find((r: any) => r.name === "member");

    // User with no workspace:read (via tenant role) cannot access.
    const userId = "77777777-7777-7777-7777-777777777777";
    await db.createUser({
      id: userId,
      tenantId: String(tenant?.id),
      email: "outsider@local",
      name: "Outsider",
      passwordHash: "x",
      roleId: String(viewerRole?.id),
      active: true,
    });

    const wsId = "88888888-8888-8888-8888-888888888888";
    await db.createWorkspace({ id: wsId, name: "Private", vaultDir: "/tmp", tenantId: String(tenant?.id) });

    // Tenant viewer has workspace:read per preset, so they can see tenant workspaces by default.
    expect(await canAccessWorkspace(db, userId, wsId)).toBe(true);

    // Cross-tenant user is denied.
    const otherUserId = "77777778-7777-7777-7777-777777777778";
    const otherTenantId = "99999999-9999-9999-9999-999999999999";
    await db.createTenant({ id: otherTenantId, name: "Other" });
    const otherRole = await db.createRole({ id: "77777777-7777-7777-7777-777777777777", tenantId: otherTenantId, name: "member" });
    await db.createUser({
      id: otherUserId,
      tenantId: otherTenantId,
      email: "other@local",
      name: "Other",
      passwordHash: "x",
      roleId: otherRole,
      active: true,
    });
    expect(await canAccessWorkspace(db, otherUserId, wsId)).toBe(false);

    // An explicit workspace member without tenant workspace:read still has access through workspace role.
    const restrictedUserId = "77777779-7777-7777-7777-777777777779";
    const noAccessRole = await db.createRole({ id: "77777777-7777-7777-7777-777777777778", tenantId: String(tenant?.id), name: "no-access" });
    await db.createUser({
      id: restrictedUserId,
      tenantId: String(tenant?.id),
      email: "restricted@local",
      name: "Restricted",
      passwordHash: "x",
      roleId: noAccessRole,
      active: true,
    });
    expect(await canAccessWorkspace(db, restrictedUserId, wsId)).toBe(false);
    await db.addWorkspaceMember(wsId, restrictedUserId, String(memberRole?.id));
    expect(await canAccessWorkspace(db, restrictedUserId, wsId)).toBe(true);
  });
});
