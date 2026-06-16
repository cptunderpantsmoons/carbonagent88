import { CarbonDatabase } from "./sqlite.js";

export const ALL_PERMISSIONS = [
  "workspace:read",
  "workspace:write",
  "workspace:delete",
  "memory:read",
  "memory:write",
  "skills:read",
  "skills:write",
  "skills:delete",
  "run:create",
  "run:cancel",
  "provider:manage",
  "profile:manage",
  "connector:manage",
  "watcher:manage",
  "user:manage",
  "role:manage",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: Array.from(ALL_PERMISSIONS) as Permission[],
  member: [
    "workspace:read",
    "workspace:write",
    "memory:read",
    "memory:write",
    "skills:read",
    "skills:write",
    "run:create",
    "run:cancel",
    "provider:manage",
    "profile:manage",
    "connector:manage",
    "watcher:manage",
  ],
  viewer: [
    "workspace:read",
    "memory:read",
    "skills:read",
  ],
};

export interface AuthContext {
  userId: string;
  tenantId: string;
  roleId: string;
}

export interface RoleRecord {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: number;
}

export interface UserRecord {
  id: string;
  tenant_id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  role_id: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface TenantRecord {
  id: string;
  name: string;
  created_at: string;
}

export async function getUserEffectiveRole(
  db: CarbonDatabase,
  userId: string,
  workspaceId?: string | null,
): Promise<{ roleId: string; roleName: string; tenantId: string } | undefined> {
  const user = await db.getUserById(userId);
  if (!user) return undefined;
  const tenantId = String(user.tenant_id ?? "");
  if (!tenantId) return undefined;

  if (workspaceId) {
    const explicit = await db.getWorkspaceMemberRole(workspaceId, userId);
    if (explicit) {
      const role = await db.getRole(explicit.roleId);
      if (role) {
        return { roleId: String(role.id), roleName: String(role.name), tenantId };
      }
    }
  }

  const tenantMember = await db.getTenantMemberRole(tenantId, userId);
  if (tenantMember) {
    const role = await db.getRole(tenantMember.roleId);
    if (role) {
      return { roleId: String(role.id), roleName: String(role.name), tenantId };
    }
  }

  const fallback = await db.getRole(String(user.role_id ?? ""));
  if (fallback) {
    return { roleId: String(fallback.id), roleName: String(fallback.name), tenantId };
  }

  return undefined;
}

export async function listUserPermissions(db: CarbonDatabase, userId: string, workspaceId?: string | null): Promise<Permission[]> {
  const effective = await getUserEffectiveRole(db, userId, workspaceId);
  if (!effective) return [];
  const names = await db.listPermissionsForRole(effective.roleId);
  return names.filter((name): name is Permission => ALL_PERMISSIONS.includes(name as Permission));
}

export async function canAccessWorkspace(db: CarbonDatabase, userId: string, workspaceId: string): Promise<boolean> {
  const user = await db.getUserById(userId);
  if (!user) return false;
  const tenantId = String(user.tenant_id ?? "");
  if (!tenantId) return false;

  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) return false;
  if (workspace.tenant_id && String(workspace.tenant_id) !== tenantId) return false;

  const effective = await getUserEffectiveRole(db, userId, workspaceId);
  if (!effective) return false;
  const perms = await listUserPermissions(db, userId, workspaceId);
  return perms.includes("workspace:read");
}

export async function hasPermission(
  db: CarbonDatabase,
  userId: string,
  permission: Permission,
  opts?: { workspaceId?: string | null; tenantId?: string | null },
): Promise<boolean> {
  const user = await db.getUserById(userId);
  if (!user || !Number(user.active ?? 0)) return false;
  if (opts?.tenantId && String(user.tenant_id ?? "") !== opts.tenantId) return false;

  // Admin fallback at tenant level can do everything on tenant-scoped resources
  const perms = await listUserPermissions(db, userId, opts?.workspaceId);
  if (perms.includes(permission)) return true;

  // If workspace scoped, also allow admin with workspace:write to perform all workspace resource mutations
  if (opts?.workspaceId && perms.includes("workspace:write")) return true;

  // Super admin bootstrap
  const role = await db.getRole(String(user.role_id ?? ""));
  if (role && role.name === "admin") return true;

  return false;
}

export async function ensureTenantAdmin(db: CarbonDatabase, tenantId: string, userId: string): Promise<boolean> {
  const user = await db.getUserById(userId);
  if (!user) return false;
  if (String(user.tenant_id ?? "") !== tenantId) return false;
  const effective = await getUserEffectiveRole(db, userId);
  if (!effective) return false;
  return effective.roleName === "admin";
}

export async function assignWorkspaceRole(
  db: CarbonDatabase,
  workspaceId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  await db.addWorkspaceMember(workspaceId, userId, roleId);
}

export async function revokeWorkspaceRole(db: CarbonDatabase, workspaceId: string, userId: string): Promise<void> {
  await db.removeWorkspaceMember(workspaceId, userId);
}
