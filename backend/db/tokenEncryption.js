import crypto from "crypto";

/**
 * Encryption-at-rest for GitHub OAuth access tokens.
 *
 * Tokens are never stored as plaintext when TOKEN_ENCRYPTION_KEY is set.
 * Each token is encrypted with AES-256-GCM using a fresh random 12-byte IV,
 * and the auth tag is stored alongside so tampering is detected.
 *
 * Stored format:  v1.<iv base64>.<authTag base64>.<ciphertext base64>
 *
 * The key is derived from TOKEN_ENCRYPTION_KEY (any length) via SHA-256.
 * NOTE: rotating TOKEN_ENCRYPTION_KEY invalidates previously encrypted
 * tokens — users will simply need to re-authenticate.
 */

const KEY_ENV = "TOKEN_ENCRYPTION_KEY";
const PREFIX = "v1.";
const ALGORITHM = "aes-256-gcm";

const key = process.env[KEY_ENV]
    ? crypto.createHash("sha256").update(process.env[KEY_ENV]).digest()
    : null;

if (!key) {
    console.warn(
        `[SECURITY] ${KEY_ENV} is not set — GitHub access tokens will be stored in PLAINTEXT. ` +
        `Set ${KEY_ENV} to enable AES-256-GCM encryption at rest.`
    );
}

/** True when encryption at rest is active (a key is configured). */
export function isTokenEncryptionEnabled() {
    return Boolean(key);
}

/** True when the stored value is an encrypted payload (v1.<iv>.<tag>.<data>). */
export function isEncryptedToken(payload) {
    return typeof payload === "string" && payload.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext token for storage.
 * Returns the plaintext unchanged if no key is configured (legacy behavior).
 */
export function encryptToken(plaintext) {
    if (!key || plaintext == null) return plaintext;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

/**
 * Decrypt a stored token.
 * - Encrypted payload + key  -> plaintext
 * - Legacy plaintext         -> returned as-is (so existing users keep working;
 *                               the deserializer migrates these to encrypted)
 * - Encrypted payload, no key -> throws (tokens are unusable without the key)
 */
export function decryptToken(payload) {
    if (payload == null) return payload;

    if (!isEncryptedToken(payload)) {
        return payload; // legacy plaintext
    }

    if (!key) {
        throw new Error(
            `${KEY_ENV} is not set but stored tokens are encrypted — cannot decrypt. ` +
            `Set the same ${KEY_ENV} used when the tokens were encrypted.`
        );
    }

    const parts = payload.slice(PREFIX.length).split(".");
    if (parts.length !== 3) {
        throw new Error("Malformed encrypted token payload");
    }

    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64")),
        decipher.final()
    ]);

    return decrypted.toString("utf8");
}
