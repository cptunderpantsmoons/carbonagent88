import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./crypto";

describe("Crypto", () => {
  it("round-trips plaintext", () => {
    const original = "sk-test-api-key-12345";
    const ciphertext = encrypt(original);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertexts for same plaintext", () => {
    const original = "same-text";
    const c1 = encrypt(original);
    const c2 = encrypt(original);
    expect(c1).not.toBe(c2);
  });

  it("throws on corrupted ciphertext", () => {
    const original = "secret";
    const ciphertext = encrypt(original);
    // Corrupt the ciphertext
    const corrupted = ciphertext.slice(0, -4) + "xxxx";
    expect(() => decrypt(corrupted)).toThrow();
  });

  it("handles empty string", () => {
    const original = "";
    const ciphertext = encrypt(original);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(original);
  });

  it("handles multi-line and special characters", () => {
    const original = "sk-\n\t!@#$%^&*()_+{}|:<>?~`";
    const ciphertext = encrypt(original);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(original);
  });
});
