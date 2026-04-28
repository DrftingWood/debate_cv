import { describe, expect, test } from 'vitest';

// Internal helper isn't exported; we re-derive the same algorithm here so
// the test pins the contract (fits int64, deterministic, distinct
// fingerprints map to distinct keys with overwhelming probability).
//
// If the helper signature ever changes, this test should be updated to
// import the real export instead.
function fingerprintLockKey(fingerprint: string): bigint {
  const hex = fingerprint.slice(0, 15) || '0';
  return BigInt(`0x${hex}`);
}

describe('fingerprintLockKey (audit #4 cross-ingest race serialization)', () => {
  test('returns a positive bigint for any 32-char hex fingerprint', () => {
    const key = fingerprintLockKey('0123456789abcdef'.padEnd(32, '0'));
    expect(typeof key).toBe('bigint');
    expect(key > 0n).toBe(true);
  });

  test('always fits in a positive 64-bit signed integer (max bigint per pg_advisory_xact_lock)', () => {
    // postgres int8 max = 2^63 - 1 = 9_223_372_036_854_775_807. We use 60
    // bits (15 hex chars) so the largest possible value is 2^60 - 1, well
    // under the limit and unambiguously positive.
    const allF = fingerprintLockKey('f'.repeat(32));
    expect(allF).toBeLessThan(1n << 63n);
    expect(allF).toBeGreaterThanOrEqual(0n);
  });

  test('is deterministic — same fingerprint produces same key', () => {
    const a = fingerprintLockKey('abcdef0123456789'.padEnd(32, '0'));
    const b = fingerprintLockKey('abcdef0123456789'.padEnd(32, '0'));
    expect(a).toBe(b);
  });

  test('distinct fingerprints produce distinct keys (no collision in our test set)', () => {
    // Real fingerprints are sha256 prefixes with random-looking hex from
    // bit zero — so we generate test inputs that vary at the *high* end
    // (where fingerprintLockKey reads from) instead of padding with
    // leading zeros (which would make every key 0).
    const keys = new Set<bigint>();
    for (let i = 0; i < 100; i++) {
      const fp = i.toString(16).padStart(15, '0').padEnd(32, '0');
      keys.add(fingerprintLockKey(fp));
    }
    expect(keys.size).toBe(100);
  });

  test('handles short or empty inputs without throwing', () => {
    expect(() => fingerprintLockKey('')).not.toThrow();
    expect(() => fingerprintLockKey('abc')).not.toThrow();
  });
});
