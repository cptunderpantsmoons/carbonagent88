import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { CarbonDatabase } from "@carbon-agent/local-store";
import { storeSession, getSession, deleteSession } from "./secure-storage.js";

const SALT_ROUNDS = 12;
const SESSION_NS = "session:";

export interface SessionPayload {
  userId: string;
  tenantId: string;
  roleId: string;
}

export interface AuthService {
  login(email: string, password: string): Promise<{ token: string; session: SessionPayload } | null>;
  logout(token: string): Promise<void>;
  createSession(userId: string): Promise<{ token: string; session: SessionPayload }>;
  verifySession(token: string): Promise<SessionPayload | null>;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
}

let _db: CarbonDatabase | null = null;

export function setAuthDb(db: CarbonDatabase): void {
  _db = db;
}

function getDb(): CarbonDatabase {
  if (!_db) throw new Error("Auth database not initialized");
  return _db;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<{ token: string; session: SessionPayload }> {
  const db = getDb();
  const user = await db.getUserById(userId);
  if (!user || !user.active) throw new Error("User not found or inactive");
  const token = `${SESSION_NS}${crypto.randomBytes(32).toString("hex")}`;
  const session: SessionPayload = {
    userId: String(user.id),
    tenantId: String(user.tenant_id),
    roleId: String(user.role_id),
  };
  storeSession(token, session);
  return { token, session };
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  const payload = getSession(token);
  if (!payload) return null;
  const db = getDb();
  const user = await db.getUserById(payload.userId);
  if (!user || !user.active) {
    deleteSession(token);
    return null;
  }
  return {
    userId: String(user.id),
    tenantId: String(user.tenant_id),
    roleId: String(user.role_id),
  };
}

export async function login(email: string, password: string): Promise<{ token: string; session: SessionPayload } | null> {
  const db = getDb();
  const row = await db.getUserByEmail(email);
  if (!row || !row.active) return null;
  const hash = row.password_hash;
  if (!hash || typeof hash !== "string") return null;
  if (!(await verifyPassword(password, hash))) return null;
  return createSession(String(row.id));
}

export async function logout(token: string): Promise<void> {
  deleteSession(token);
}

export function buildAuthService(db?: CarbonDatabase): AuthService {
  if (db) setAuthDb(db);
  return {
    login,
    logout,
    createSession,
    verifySession,
    hashPassword,
    verifyPassword,
  };
}
