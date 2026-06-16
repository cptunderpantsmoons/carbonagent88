import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CarbonDatabase, initDatabase, saveDatabase, closeDatabase } from "./sqlite";
import path from "node:path";

describe("CarbonDatabase multi-tenancy/RBAC round-trip", () => {
  let db: CarbonDatabase;
  const testDbPath = "/tmp/carbon-test-rbac.db";

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

  it("ensures default tenant, admin role and admin user", async () => {
    const tenants = await db.listTenants();
    expect(tenants.length).toBeGreaterThanOrEqual(1);

    const admin = await db.getUserByEmail("admin@local");
    expect(admin).toBeDefined();
    expect(Number(admin?.active)).toBe(1);

    const roles = await db.listRoles(String(admin?.tenant_id));
    expect(roles.find((r: any) => r.name === "admin")).toBeDefined();
    expect(roles.find((r: any) => r.name === "member")).toBeDefined();
    expect(roles.find((r: any) => r.name === "viewer")).toBeDefined();
  });

  it("creates and updates a user", async () => {
    const tenant = await db.getTenant("00000000-0000-0000-0000-000000000001");
    expect(tenant).toBeDefined();
    const memberRole = (await db.listRoles(String(tenant?.id))).find((r: any) => r.name === "member");
    expect(memberRole).toBeDefined();

    const userId = "11111111-1111-1111-1111-111111111111";
    await db.createUser({
      id: userId,
      tenantId: String(tenant?.id),
      email: "member@local",
      name: "Member User",
      passwordHash: "hash",
      roleId: String(memberRole?.id),
      active: true,
    });

    const user = await db.getUserById(userId);
    expect(user?.email).toBe("member@local");

    await db.updateUser(userId, { name: "Updated Member" });
    expect((await db.getUserById(userId))?.name).toBe("Updated Member");
  });

  it("creates workspace and assigns membership for user listing", async () => {
    const tenant = await db.getTenant("00000000-0000-0000-0000-000000000001");
    const admin = await db.getUserByEmail("admin@local");
    const wsId = "22222222-2222-2222-2222-222222222222";
    await db.createWorkspace({
      id: wsId,
      name: "Member Workspace",
      vaultDir: "/tmp/vault/member",
      tenantId: String(tenant?.id),
      userId: String(admin?.id),
    });

    // Admin sees it.
    const adminList = await db.listWorkspacesForUser(String(admin?.id));
    expect(adminList.find((w: any) => String(w.id) === wsId)).toBeDefined();

    // Non-member does not.
    const memberId = "11111111-1111-1111-1111-111111111111";
    const memberList = await db.listWorkspacesForUser(memberId);
    expect(memberList.find((w: any) => String(w.id) === wsId)).toBeUndefined();

    // After adding member, they see it.
    const memberRole = (await db.listRoles(String(tenant?.id))).find((r: any) => r.name === "member");
    await db.addWorkspaceMember(wsId, memberId, String(memberRole?.id));
    const memberList2 = await db.listWorkspacesForUser(memberId);
    expect(memberList2.find((w: any) => String(w.id) === wsId)).toBeDefined();

    const members = await db.listWorkspaceMembers(wsId);
    expect(members.length).toBeGreaterThanOrEqual(1);
    expect(members.find((m: any) => String(m.role_name) === "member")).toBeDefined();
  });

  it("assigns and revokes role permissions", async () => {
    const tenant = await db.getTenant("00000000-0000-0000-0000-000000000001");
    const role = await db.createRole({ id: "33333333-3333-3333-3333-333333333333", tenantId: String(tenant?.id), name: "custom", description: "Custom" });
    const permissions = await db.listPermissionsForRole(role);
    expect(permissions.length).toBe(0);

    const permission = await db.getPermissionByName("workspace:read");
    expect(permission).toBeDefined();

    await db.assignPermission(role, String(permission?.id));
    const updated = await db.listPermissionsForRole(role);
    expect(updated).toContain("workspace:read");

    await db.revokePermission(role, String(permission?.id));
    const removed = await db.listPermissionsForRole(role);
    expect(removed).not.toContain("workspace:read");
  });
});
