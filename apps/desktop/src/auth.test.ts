import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state — survives vi.mock hoisting
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  db: {
    getUserById: vi.fn(),
    getUserByEmail: vi.fn(),
  },
  sessionStore: new Map<string, unknown>(),
}));

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

vi.mock("@carbon-agent/local-store", () => ({
  CarbonDatabase: class {
    getUserById = mockState.db.getUserById;
    getUserByEmail = mockState.db.getUserByEmail;
  },
}));

vi.mock("./secure-storage.js", () => ({
  storeSession: vi.fn((token: string, session: unknown) => {
    mockState.sessionStore.set(token, session);
  }),
  getSession: vi.fn((token: string) => mockState.sessionStore.get(token) ?? null),
  deleteSession: vi.fn((token: string) => {
    mockState.sessionStore.delete(token);
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  hashPassword,
  verifyPassword,
  login,
  logout,
  createSession,
  verifySession,
  buildAuthService,
  setAuthDb,
} from "./auth.js";
import { storeSession, getSession, deleteSession } from "./secure-storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "user-1",
    tenant_id: "tenant-1",
    role_id: "role-1",
    email: "test@example.com",
    name: "Test User",
    active: 1,
    password_hash: null as string | null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function hashAndSetUser(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const hash = await hashPassword("correct-password");
  return makeUser({ password_hash: hash, ...overrides });
}

// ---------------------------------------------------------------------------

describe("auth — hashPassword / verifyPassword", () => {
  it("hashPassword produces a bcrypt hash different from the input", async () => {
    const hash = await hashPassword("mySecret123");
    expect(hash).not.toBe("mySecret123");
    expect(hash).toMatch(/^\$2[aby]?\$/);
  });

  it("verifyPassword returns true for a correct password", async () => {
    const hash = await hashPassword("correct-pass");
    expect(await verifyPassword("correct-pass", hash)).toBe(true);
  });

  it("verifyPassword returns false for a wrong password", async () => {
    const hash = await hashPassword("correct-pass");
    expect(await verifyPassword("wrong-pass", hash)).toBe(false);
  });

  it("hashPassword produces different hashes for same input (salt)", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------

describe("auth — login", () => {
  beforeEach(() => {
    mockState.sessionStore.clear();
    vi.clearAllMocks();
    setAuthDb(new (await import("@carbon-agent/local-store")).CarbonDatabase());
  });

  it("returns a token and session for valid credentials", async () => {
    const user = await hashAndSetUser();
    mockState.db.getUserByEmail.mockResolvedValue(user);
    mockState.db.getUserById.mockResolvedValue(user);

    const result = await login("test@example.com", "correct-password");
    expect(result).not.toBeNull();
    expect(result!.token).toMatch(/^session:/);
    expect(result!.session.userId).toBe("user-1");
    expect(result!.session.tenantId).toBe("tenant-1");
    expect(result!.session.roleId).toBe("role-1");
    expect(storeSession).toHaveBeenCalledTimes(1);
  });

  it("returns null for an invalid password", async () => {
    const user = await hashAndSetUser();
    mockState.db.getUserByEmail.mockResolvedValue(user);

    const result = await login("test@example.com", "wrong-password");
    expect(result).toBeNull();
  });

  it("returns null for a non-existent email", async () => {
    mockState.db.getUserByEmail.mockResolvedValue(undefined);
    const result = await login("nobody@example.com", "any-password");
    expect(result).toBeNull();
  });

  it("returns null for an inactive user", async () => {
    const user = await hashAndSetUser({ active: 0 });
    mockState.db.getUserByEmail.mockResolvedValue(user);
    const result = await login("test@example.com", "correct-password");
    expect(result).toBeNull();
  });

  it("returns null when password_hash is missing", async () => {
    const user = makeUser({ password_hash: null });
    mockState.db.getUserByEmail.mockResolvedValue(user);
    const result = await login("test@example.com", "correct-password");
    expect(result).toBeNull();
  });

  it("returns null when password_hash is not a string", async () => {
    const user = makeUser({ password_hash: 12345 });
    mockState.db.getUserByEmail.mockResolvedValue(user);
    const result = await login("test@example.com", "correct-password");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("auth — createSession", () => {
  beforeEach(() => {
    mockState.sessionStore.clear();
    vi.clearAllMocks();
  });

  it("creates a session for an active user", async () => {
    const user = makeUser({ active: 1 });
    mockState.db.getUserById.mockResolvedValue(user);

    const result = await createSession("user-1");
    expect(result.token).toMatch(/^session:/);
    expect(result.session.userId).toBe("user-1");
    expect(result.session.tenantId).toBe("tenant-1");
    expect(result.session.roleId).toBe("role-1");
    expect(storeSession).toHaveBeenCalledTimes(1);
  });

  it("throws when user is not found", async () => {
    mockState.db.getUserById.mockResolvedValue(undefined);
    await expect(createSession("nonexistent")).rejects.toThrow("User not found or inactive");
  });

  it("throws when user is inactive", async () => {
    const user = makeUser({ active: 0 });
    mockState.db.getUserById.mockResolvedValue(user);
    await expect(createSession("user-1")).rejects.toThrow("User not found or inactive");
  });
});

// ---------------------------------------------------------------------------

describe("auth — verifySession", () => {
  beforeEach(() => {
    mockState.sessionStore.clear();
    vi.clearAllMocks();
  });

  it("returns the session payload for a valid token", async () => {
    const user = makeUser({ active: 1 });
    mockState.db.getUserById.mockResolvedValue(user);
    const { token } = await createSession("user-1");

    const payload = await verifySession(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-1");
    expect(payload!.tenantId).toBe("tenant-1");
  });

  it("returns null for an invalid token", async () => {
    const payload = await verifySession("session:nonexistent-token");
    expect(payload).toBeNull();
  });

  it("returns null and deletes session when user is inactive", async () => {
    const user = makeUser({ active: 1 });
    mockState.db.getUserById.mockResolvedValue(user);
    const { token } = await createSession("user-1");

    // Now make user inactive
    mockState.db.getUserById.mockResolvedValue(makeUser({ active: 0 }));
    const payload = await verifySession(token);
    expect(payload).toBeNull();
    expect(deleteSession).toHaveBeenCalledWith(token);
  });

  it("returns null and deletes session when user is not found", async () => {
    const user = makeUser({ active: 1 });
    mockState.db.getUserById.mockResolvedValue(user);
    const { token } = await createSession("user-1");

    mockState.db.getUserById.mockResolvedValue(undefined);
    const payload = await verifySession(token);
    expect(payload).toBeNull();
    expect(deleteSession).toHaveBeenCalledWith(token);
  });
});

// ---------------------------------------------------------------------------

describe("auth — logout", () => {
  beforeEach(() => {
    mockState.sessionStore.clear();
    vi.clearAllMocks();
  });

  it("deletes the session for the given token", async () => {
    const user = makeUser({ active: 1 });
    mockState.db.getUserById.mockResolvedValue(user);
    const { token } = await createSession("user-1");
    expect(getSession(token)).not.toBeNull();

    await logout(token);
    expect(deleteSession).toHaveBeenCalledWith(token);
  });
});

// ---------------------------------------------------------------------------

describe("auth — buildAuthService", () => {
  it("returns an object with all required methods", () => {
    const service = buildAuthService();
    expect(typeof service.login).toBe("function");
    expect(typeof service.logout).toBe("function");
    expect(typeof service.createSession).toBe("function");
    expect(typeof service.verifySession).toBe("function");
    expect(typeof service.hashPassword).toBe("function");
    expect(typeof service.verifyPassword).toBe("function");
  });

  it("sets the database when provided", () => {
    const db = new (await import("@carbon-agent/local-store")).CarbonDatabase();
    const service = buildAuthService(db);
    expect(service).toBeDefined();
    // Should not throw when calling a db-dependent function
    expect(typeof service.login).toBe("function");
  });
});