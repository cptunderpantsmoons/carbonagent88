import crypto from "node:crypto";
import os from "node:os";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;
const SALT_LEN = 32;

function deriveKey(salt: Buffer): Buffer {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const secretBase = `${hostname}:${username}:carbon-agent-v1`;
  return crypto.pbkdf2Sync(secretBase, salt, 100_000, KEY_LEN, "sha256");
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
