/**
 * Tool Guard — Permission resolution helpers for agent tools.
 *
 * Control Corridor:
 * - Pure, synchronous callbacks: no dependency on local-store or RBAC DB.
 * - Consumers build a PermissionResolver from any authority (RBAC, session,
 *   hard-coded allow-lists, etc.) and inject it into the runtime.
 */

/**
 * Resolve whether the current execution context is granted a permission.
 * Implementations may be closures over RBAC roles, workspace membership,
 * or feature flags.
 */
export type PermissionResolver = (permission: string) => boolean;

/**
 * Build a resolver that grants exactly the listed permissions.
 */
export function createToolGuard(permissions: string[]): PermissionResolver {
  const granted = new Set(permissions);
  return (permission: string): boolean => granted.has(permission);
}

/**
 * Decide whether a tool may be executed.
 *
 * - Tools without permission metadata are always allowed.
 * - Tools with permissions require every listed permission to be granted
 *   (AND semantics), so a tool that needs ["tools:terminal", "workspace:write"]
 *   is only usable when both are granted.
 */
export function permitTool(
  toolPermissions: string[] | undefined,
  resolve: PermissionResolver,
): boolean {
  if (!toolPermissions || toolPermissions.length === 0) {
    return true;
  }
  return toolPermissions.every((permission) => resolve(permission));
}
