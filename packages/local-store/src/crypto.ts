import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;
const SALT_LEN = 32;
const PBKDF2_ITERATIONS = 600_000;
const MASTER_KEY_FILE = "carbon-master-key.enc";

type KeySource = "safeStorage" | "passphrase" | "insecure-fallback";

let _keySource: KeySource | null = null;
let _cachedSecret: Buffer | null = null;

/**
 * Returns the key derivation secret as a Buffer.
 *
 * Priority:
 * 1. CARBON_ENCRYPTION_PASSPHRASE env var (explicit user override)
 * 2. Random master key persisted via Electron safeStorage
 * 3. Insecure fallback (dev-only, logs a warning)
 */
function getKeyMaterial(): Buffer {
  if (_cachedSecret) return _cachedSecret;

  // 1. Check for explicit passphrase env var
  const passphrase = process.env.CARBON_ENCRYPTION_PASSPHRASE;
  if (passphrase && passphrase.length > 0) {
    _cachedSecret = Buffer.from(passphrase, "utf-8");
    _keySource = "passphrase";
    return _cachedSecret;
  }

  // 2. Try safeStorage-backed master key
  try {
    const { safeStorage, app } = require("electron");
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const dataDir = app.getPath("userData");
      const keyPath = path.join(dataDir, MASTER_KEY_FILE);

      if (fs.existsSync(keyPath)) {
        // Load existing master key
        const encryptedKey = fs.readFileSync(keyPath);
        _cachedSecret = safeStorage.decryptString(Buffer.from(encryptedKey, "base64"));
        _keySource = "safeStorage";
        return _cachedSecret;
      } else {
        // Generate a new random 32-byte master key on first run
        const masterKey = crypto.randomBytes(32);
        const encryptedKey = safeStorage.encryptString(masterKey);
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(keyPath, encryptedKey.toString("base64"));
        _cachedSecret = masterKey;
        _keySource = "safeStorage";
        return _cachedSecret;
      }
    }
  } catch {
    // safeStorage not available (not in Electron main process, or platform unsupported)
  }

  // 3. Insecure fallback — only in development
  if (process.env.NODE_ENV === "test" || process.env.CARBON_DEV === "true") {
    console.warn("[crypto] WARNING: Using insecure fallback key derivation. Set CARBON_ENCRYPTION_PASSPHRASE for production.");
    _cachedSecret = Buffer.from("carbon-agent-insecure-dev-key-do-not-use", "utf-8");
    _keySource = "insecure-fallback";
    return _cachedSecret;
  }

  // In production with no safeStorage and no passphrase, fail hard
  throw new Error(
    "Encryption key material unavailable. safeStorage is not accessible and CARBON_ENCRYPTION_PASSPHRASE is not set. " +
    "Please set the CARBON_ENCRYPTION_PASSPHRASE environment variable to a strong passphrase."
  );
}

function deriveKey(salt: Buffer): Buffer {
  const secret = getKeyMaterial();
  return crypto.pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
}

/**
 * Returns the current key source for diagnostic / security audit purposes.
 */
export function getKeySource(): KeySource {
  if (_keySource) return _keySource;
  // Trigger key material resolution to populate _keySource
  try {
    getKeyMaterial();
  } catch {
    return "insecure-fallback";
  }
  return _keySource ?? "insecure-fallback";
}

export function encrypt(plaintext: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([salt, iv, authTag, encrypted]);
  return payload.toString("base64");
}

export function decrypt(ciphertext: string): string {
  const payload = Buffer.from(ciphertext, "base64");
  const salt = payload.subarray(0, SALT_LEN);
  const iv = payload.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const authTag = payload.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + AUTH_TAG_LEN);
  const encrypted = payload.subarray(SALT_LEN + IV_LEN + AUTH_TAG_LEN);
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf-8");
}