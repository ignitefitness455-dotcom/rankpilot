import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { getEnv } from "./env";

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
  last4: string;
}

export interface Keyring {
  currentVersion: number;
  keys: Map<number, Buffer>;
}

/**
 * Builds a keyring from the current ENCRYPTION_KEY + optional ENCRYPTION_KEYS_OLD
 * formatted as `"1:base64key,2:base64key"`.
 */
export function buildKeyring(
  currentKeyBase64?: string,
  currentVersion?: number,
  oldKeysSpec?: string,
): Keyring {
  const env = getEnv();
  const curB64 = currentKeyBase64 ?? env.ENCRYPTION_KEY;
  const curVer = currentVersion ?? env.ENCRYPTION_KEY_VERSION;
  const oldSpec = oldKeysSpec ?? env.ENCRYPTION_KEYS_OLD;

  const keys = new Map<number, Buffer>();
  const primary = Buffer.from(curB64, "base64");
  if (primary.byteLength !== 32) {
    throw new Error("Primary encryption key must decode to 32 bytes");
  }
  keys.set(curVer, primary);

  if (oldSpec && oldSpec.trim().length > 0) {
    for (const entry of oldSpec.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const [verStr, b64] = trimmed.split(":");
      const ver = Number(verStr);
      if (!Number.isInteger(ver) || ver <= 0 || !b64) {
        throw new Error(`Invalid ENCRYPTION_KEYS_OLD entry: ${entry}`);
      }
      const buf = Buffer.from(b64, "base64");
      if (buf.byteLength !== 32) {
        throw new Error(`Encryption key version ${ver} must decode to 32 bytes`);
      }
      keys.set(ver, buf);
    }
  }

  return { currentVersion: curVer, keys };
}

/**
 * Encrypts a secret using AES-256-GCM with a random 96-bit IV and binds `aad`
 * (e.g., `${ownerId}:${kind}`) so ciphertext cannot be transplanted across users or key types.
 */
export function encryptSecret(
  plaintext: string,
  aad: string,
  keyring: Keyring = buildKeyring(),
): EncryptedPayload {
  if (!plaintext) {
    throw new Error("Cannot encrypt an empty secret");
  }
  const key = keyring.keys.get(keyring.currentVersion);
  if (!key) {
    throw new Error(`Missing encryption key for version ${keyring.currentVersion}`);
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const last4 = plaintext.length >= 4 ? plaintext.slice(-4) : "••••";

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    keyVersion: keyring.currentVersion,
    last4,
  };
}

export function decryptSecret(
  payload: Pick<EncryptedPayload, "ciphertext" | "iv" | "tag" | "keyVersion">,
  aad: string,
  keyring: Keyring = buildKeyring(),
): string {
  const key = keyring.keys.get(payload.keyVersion);
  if (!key) {
    throw new Error(`Unknown encryption key version: ${payload.keyVersion}`);
  }
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const data = Buffer.from(payload.ciphertext, "base64");
  if (iv.byteLength !== 12 || tag.byteLength !== 16) {
    throw new Error("Malformed IV or auth tag length");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
