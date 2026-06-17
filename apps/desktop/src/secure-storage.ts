import { safeStorage } from "electron";
import { encrypt, decrypt } from "@carbon-agent/local-store";

export interface StoredSecret {
  encrypted: string;
  isSafeStorage: boolean;
}

export class SecureStorage {
  /** Returns true if safeStorage encryption is available. */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /** Encrypt a plaintext string. */
  encrypt(plaintext: string): StoredSecret {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = safeStorage.encryptString(plaintext);
      return { encrypted: buffer.toString("base64"), isSafeStorage: true };
    }
    // Fallback: use portable AES-256-GCM crypto
    const encrypted = encrypt(plaintext);
    return { encrypted, isSafeStorage: false };
  }

  /** Decrypt a stored secret back to plaintext. */
  decrypt(secret: StoredSecret): string {
    if (secret.isSafeStorage && safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(secret.encrypted, "base64");
      return safeStorage.decryptString(buffer);
    }
    return decrypt(secret.encrypted);
  }

  /** Check if the platform supports safeStorage and what fallback is active. */
  getStatus(): { available: boolean; platform: string; encryptionLabel: string } {
    const available = safeStorage.isEncryptionAvailable();
    let label = "safeStorage (OS keychain)";
    if (!available) {
      try {
        encrypt("test");
        label = "AES-256-GCM (local-store fallback)";
      } catch {
        label = "base64 (no encryption — insecure!)";
      }
    }
    return {
      available,
      platform: process.platform,
      encryptionLabel: label,
    };
  }
}

/** Singleton for global use in main process. */
export const secureStorage = new SecureStorage();

const SESSION_PREFIX = "sess:";
const SESSION_TTL_MS = 86_400_000; // 24 hours

interface SessionEntry {
  session: string;
  expiresAt: number;
}

const sessionStore = new Map<string, SessionEntry>();

export interface StoredSession {
  userId: string;
  tenantId: string;
  roleId: string;
}

export function storeSession(token: string, session: StoredSession): void {
  sessionStore.set(`${SESSION_PREFIX}${token}`, {
    session: JSON.stringify(session),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

export function getSession(token: string): StoredSession | null {
  const key = `${SESSION_PREFIX}${token}`;
  const entry = sessionStore.get(key);
  if (!entry) return null;

  // Check if session has expired
  if (Date.now() > entry.expiresAt) {
    sessionStore.delete(key);
    return null;
  }

  try {
    return JSON.parse(entry.session) as StoredSession;
  } catch {
    return null;
  }
}

export function deleteSession(token: string): void {
  sessionStore.delete(`${SESSION_PREFIX}${token}`);
}

export function listSessionKeys(): string[] {
  return Array.from(sessionStore.keys())
    .filter((k) => k.startsWith(SESSION_PREFIX))
    .map((k) => k.slice(SESSION_PREFIX.length));
}

/**
 * Removes all expired sessions from the store.
 * Should be called periodically (e.g., on app startup or via a timer).
 */
export function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [key, entry] of sessionStore) {
    if (now > entry.expiresAt) {
      sessionStore.delete(key);
    }
  }
}
