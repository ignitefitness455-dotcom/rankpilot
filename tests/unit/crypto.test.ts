import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { buildKeyring, decryptSecret, encryptSecret } from "@/lib/security/crypto";

describe("lib/security/crypto — AES-256-GCM & keyring rotation", () => {
  const k1 = randomBytes(32).toString("base64");
  const k2 = randomBytes(32).toString("base64");

  it("encrypts and decrypts with AAD binding", () => {
    const keyring = buildKeyring(k1, 1, "");
    const aad = "user-123:gemini_key:global";
    const enc = encryptSecret("AIzaSyDummyTestKey9876", aad, keyring);

    expect(enc.last4).toBe("9876");
    expect(enc.keyVersion).toBe(1);
    expect(enc.ciphertext).not.toContain("AIzaSy");

    const plain = decryptSecret(enc, aad, keyring);
    expect(plain).toBe("AIzaSyDummyTestKey9876");
  });

  it("rejects decryption when AAD does not match (prevents cross-user transplant)", () => {
    const keyring = buildKeyring(k1, 1, "");
    const enc = encryptSecret("AIzaSySecretKey1111", "user-A:gemini_key:global", keyring);

    expect(() => decryptSecret(enc, "user-B:gemini_key:global", keyring)).toThrow();
  });

  it("supports key rotation via ENCRYPTION_KEYS_OLD", () => {
    const ringV1 = buildKeyring(k1, 1, "");
    const oldCipher = encryptSecret("legacy-secret-key-4321", "user-1:serpapi:global", ringV1);

    // Rotate to version 2 while keeping version 1 in ENCRYPTION_KEYS_OLD
    const ringV2 = buildKeyring(k2, 2, `1:${k1}`);
    expect(decryptSecret(oldCipher, "user-1:serpapi:global", ringV2)).toBe(
      "legacy-secret-key-4321",
    );

    const newCipher = encryptSecret("new-secret-key-8888", "user-1:serpapi:global", ringV2);
    expect(newCipher.keyVersion).toBe(2);
    expect(decryptSecret(newCipher, "user-1:serpapi:global", ringV2)).toBe("new-secret-key-8888");
  });
});
