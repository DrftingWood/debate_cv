import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptValue, decryptValue, sha256Hex } from '@/lib/crypto';

describe('token encryption', () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    // Fresh 256-bit key per test so we test the whole path.
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    vi.resetModules();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  test('round-trips an access token with the same key', () => {
    const { value, version } = encryptValue('ya29.a0-test');
    expect(version).toBe('v1');
    expect(value).toMatch(/^v1:/);
    expect(decryptValue(value, version)).toBe('ya29.a0-test');
  });

  test('null input passes through as null', () => {
    const r = encryptValue(null);
    expect(r).toEqual({ value: null, version: null });
    expect(decryptValue(null, null)).toBe(null);
  });

  test('legacy plaintext (version=null) decrypts to the input', () => {
    expect(decryptValue('plaintext-refresh-token', null)).toBe('plaintext-refresh-token');
  });

  test('tampered ciphertext fails to decrypt', () => {
    const { value, version } = encryptValue('secret');
    const parts = value!.split(':');
    // Flip one byte of the ciphertext.
    const buf = Buffer.from(parts[3]!, 'base64');
    buf[0] = (buf[0]! + 1) & 0xff;
    parts[3] = buf.toString('base64');
    expect(() => decryptValue(parts.join(':'), version)).toThrow();
  });

  test('ciphertext encrypted under a different key fails', () => {
    const { value } = encryptValue('secret');
    // Rotate key before decrypt — should fail closed.
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(() => decryptValue(value, 'v1')).toThrow();
  });

  test('no key + encrypted value => explicit throw (fails closed)', () => {
    const { value, version } = encryptValue('secret');
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => decryptValue(value, version)).toThrow(
      /TOKEN_ENCRYPTION_KEY is required/i,
    );
  });

  test('no key + null version => returns value as-is (dev plaintext)', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    const { value, version } = encryptValue('dev-token');
    expect(version).toBe(null);
    expect(value).toBe('dev-token');
  });

  test('malformed ciphertext is rejected', () => {
    expect(() => decryptValue('nope', 'v1')).toThrow(/Malformed/i);
    expect(() => decryptValue('v1:bad', 'v1')).toThrow(/Malformed/i);
  });

  test('bad key length throws with a clear message', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('short').toString('base64');
    expect(() => encryptValue('x')).toThrow(/32 bytes/);
  });
});

describe('sha256Hex', () => {
  test('stable hex digest', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
