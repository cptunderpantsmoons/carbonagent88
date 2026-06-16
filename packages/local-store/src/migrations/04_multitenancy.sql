-- Multi-tenancy + RBAC migration (Phase 4)
-- Idempotent: uses IF NOT EXISTS for tables and ALTER column checks.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  password_hash TEXT,
  role_id TEXT NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON tenant_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

-- Add nullable ownership columns to existing resource tables.
ALTER TABLE workspaces ADD COLUMN tenant_id TEXT;
ALTER TABLE workspaces ADD COLUMN user_id TEXT;
ALTER TABLE workspaces ADD COLUMN owner_id TEXT;

ALTER TABLE ai_providers ADD COLUMN tenant_id TEXT;
ALTER TABLE ai_providers ADD COLUMN user_id TEXT;
ALTER TABLE ai_providers ADD COLUMN owner_id TEXT;

ALTER TABLE browser_profiles ADD COLUMN tenant_id TEXT;
ALTER TABLE browser_profiles ADD COLUMN user_id TEXT;
ALTER TABLE browser_profiles ADD COLUMN owner_id TEXT;

ALTER TABLE conversations ADD COLUMN tenant_id TEXT;
ALTER TABLE conversations ADD COLUMN user_id TEXT;
ALTER TABLE conversations ADD COLUMN owner_id TEXT;

ALTER TABLE runs ADD COLUMN tenant_id TEXT;
ALTER TABLE runs ADD COLUMN user_id TEXT;
ALTER TABLE runs ADD COLUMN owner_id TEXT;

ALTER TABLE data_sources ADD COLUMN tenant_id TEXT;
ALTER TABLE data_sources ADD COLUMN user_id TEXT;
ALTER TABLE data_sources ADD COLUMN owner_id TEXT;

ALTER TABLE documents ADD COLUMN tenant_id TEXT;
ALTER TABLE documents ADD COLUMN user_id TEXT;
ALTER TABLE documents ADD COLUMN owner_id TEXT;

ALTER TABLE watchers ADD COLUMN tenant_id TEXT;
ALTER TABLE watchers ADD COLUMN user_id TEXT;
ALTER TABLE watchers ADD COLUMN owner_id TEXT;

ALTER TABLE connector_configs ADD COLUMN tenant_id TEXT;
ALTER TABLE connector_configs ADD COLUMN user_id TEXT;
ALTER TABLE connector_configs ADD COLUMN owner_id TEXT;

ALTER TABLE harness_configs ADD COLUMN tenant_id TEXT;
ALTER TABLE harness_configs ADD COLUMN user_id TEXT;
ALTER TABLE harness_configs ADD COLUMN owner_id TEXT;

ALTER TABLE orchestration_sessions ADD COLUMN tenant_id TEXT;
ALTER TABLE orchestration_sessions ADD COLUMN user_id TEXT;
ALTER TABLE orchestration_sessions ADD COLUMN owner_id TEXT;
