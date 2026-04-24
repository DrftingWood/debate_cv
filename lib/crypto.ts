import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for values stored in Postgres.
 *
 * Ciphertext format (base64):
 *   v1:<iv_b64>:<tag_b64>:<cipher_b64>
 *
 * The version prefix lets us rotate keys / algorithms without a
 * destructive migration. Rows written before TOKEN_ENCRYPTION_KEY was
 * introduced have `encryptionVersion = null` and stay readable as
 * plaintext — the one-time backfill script (scripts/encrypt-existing-tokens.mjs)
 * upgrades them on demand.
 */

const ENC_VERSION = 'v1';

export function getEncryptionKey(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 (generate with: openssl rand -base64 32)',
    );
  }
  return key;
}

export type EncryptedValue = {
  value: string | null;
  version: string | null;
};

/**
 * Encrypt a value with the current key. If no key is configured, returns
 * plaintext with version=null so dev environments without the env var
 * stay functional.
 */
export function encryptValue(plaintext: string | null | undefined): EncryptedValue {
  if (plaintext == null) return { value: null, version: null };
  const key = getEncryptionKey();
  if (!key) return { value: plaintext, version: null };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    value: `${ENC_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`,
    version: ENC_VERSION,
  };
}

/**
 * Decrypt a stored value. When version is null we return the value as-is
 * (legacy plaintext). When version is unknown or the key is missing we
 * throw — silent failure would leak bad tokens.
 */
export function decryptValue(
  value: string | null | undefined,
  version: string | null | undefined,
): string | null {
  if (value == null) return null;
  if (!version) return value;
  if (version !== ENC_VERSION) {
    throw new Error(`Unsupported token encryption version: ${version}`);
  }
  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is required to decrypt stored tokens. Set it in Vercel env.',
    );
  }
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== ENC_VERSION) {
    throw new Error('Malformed encrypted token');
  }
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ciphertext = Buffer.from(parts[3]!, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Stable sha256 hex used for content-addressed source documents. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
