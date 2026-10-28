import { describe, it, expect } from 'vitest';
import { poolConfig } from '@/lib/db';

/**
 * The drain is only as parallel as the connection pool lets it be. This
 * cannot be left to the env var: POSTGRES_PRISMA_URL is owned by the Vercel
 * Postgres/Neon integration, which can rewrite it, so a hand-edited
 * connection_limit is not guaranteed to survive. Prisma 7's pg adapter takes
 * the pool size as an option, not from the URL.
 */
describe('poolConfig', () => {
  it('raises a limit below the drain concurrency and strips the Prisma-only params', () => {
    const out = poolConfig(
      'postgres://u:p@h/db?sslmode=require&pgbouncer=true&connection_limit=1',
      6,
    )!;
    expect(out.max).toBe(6);
    const url = new URL(out.connectionString);
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
    expect(url.searchParams.has('pgbouncer')).toBe(false);
    expect(url.searchParams.has('connection_limit')).toBe(false);
  });

  it('uses the drain concurrency when the URL has no limit', () => {
    expect(poolConfig('postgres://u:p@h/db', 6)!.max).toBe(6);
  });

  it('never lowers a deliberately higher limit', () => {
    expect(poolConfig('postgres://u:p@h/db?connection_limit=20', 6)!.max).toBe(20);
  });

  it('defaults the connection wait to 10 s and honours pool_timeout, then connect_timeout', () => {
    expect(poolConfig('postgres://u:p@h/db', 6)!.connectionTimeoutMillis).toBe(10_000);
    expect(poolConfig('postgres://u:p@h/db?pool_timeout=30', 6)!.connectionTimeoutMillis).toBe(
      30_000,
    );
    expect(poolConfig('postgres://u:p@h/db?connect_timeout=3', 6)!.connectionTimeoutMillis).toBe(
      3_000,
    );
  });

  it('passes through what it cannot parse rather than mangling it', () => {
    expect(poolConfig('not a url', 6)!.connectionString).toBe('not a url');
    expect(poolConfig(undefined, 6)).toBeUndefined();
  });

  it.each(['prefer', 'require', 'verify-ca'])('spells out verify-full for sslmode=%s', (mode) => {
    const out = poolConfig(`postgres://u:p@h/db?sslmode=${mode}`, 6)!;
    expect(new URL(out.connectionString).searchParams.get('sslmode')).toBe('verify-full');
  });

  it('leaves other ssl settings alone', () => {
    for (const q of [
      'sslmode=disable',
      'sslmode=verify-full',
      'sslmode=require&uselibpqcompat=true',
      '',
    ]) {
      const out = poolConfig(`postgres://u:p@h/db?${q}`, 6)!;
      expect(new URL(out.connectionString).search).toBe(q ? `?${q}` : '');
    }
  });
});
