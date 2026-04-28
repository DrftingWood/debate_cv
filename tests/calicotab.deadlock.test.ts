import { describe, expect, test } from 'vitest';
import { isDeadlockError } from '@/lib/calicotab/ingest';

describe('isDeadlockError', () => {
  test('matches PostgreSQL 40P01 by message', () => {
    expect(isDeadlockError(new Error('SQLSTATE 40P01: deadlock detected'))).toBe(true);
    expect(isDeadlockError('error code 40P01')).toBe(true);
  });

  test('matches the literal "deadlock" word case-insensitively', () => {
    expect(isDeadlockError(new Error('Deadlock detected'))).toBe(true);
    expect(isDeadlockError(new Error('upstream reported a DEADLOCK'))).toBe(true);
  });

  test('matches Prisma P2034 (write conflict)', () => {
    expect(
      isDeadlockError(Object.assign(new Error('write conflict'), { code: 'P2034' })),
    ).toBe(true);
  });

  test('matches Postgres 40001 serialization_failure (treated as same class)', () => {
    expect(
      isDeadlockError(Object.assign(new Error('serialization_failure'), { code: '40001' })),
    ).toBe(true);
  });

  test('matches the post-exhaustion "withDeadlockRetry: exhausted" throw', () => {
    expect(isDeadlockError(new Error('withDeadlockRetry: exhausted, last error: deadlock'))).toBe(true);
  });

  test('rejects unrelated errors', () => {
    expect(isDeadlockError(new Error('network unreachable'))).toBe(false);
    expect(isDeadlockError(new Error('parse failed'))).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
    expect(isDeadlockError(undefined)).toBe(false);
  });
});
