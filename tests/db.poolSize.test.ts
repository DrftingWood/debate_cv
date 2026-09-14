import { describe, it, expect } from 'vitest';
import { poolSizedUrl } from '@/lib/db';

/**
 * The drain is only as parallel as the connection pool lets it be. This
 * cannot be left to the env var: POSTGRES_PRISMA_URL is owned by the Vercel
 * Postgres/Neon integration, which can rewrite it, so a hand-edited
 * connection_limit is not guaranteed to survive.
 */
describe('poolSizedUrl', () => {
  it('raises a limit below the drain concurrency, preserving other params', () => {
    const out = poolSizedUrl('postgres://u:p@h/db?pgbouncer=true&connection_limit=1', 6)!;
    const url = new URL(out);
    expect(url.searchParams.get('connection_limit')).toBe('6');
    expect(url.searchParams.get('pgbouncer')).toBe('true');
  });

  it('adds the limit when the URL has none', () => {
    const out = poolSizedUrl('postgres://u:p@h/db', 6)!;
    expect(new URL(out).searchParams.get('connection_limit')).toBe('6');
  });

  it('never lowers a deliberately higher limit', () => {
    const raw = 'postgres://u:p@h/db?connection_limit=20';
    expect(poolSizedUrl(raw, 6)).toBe(raw);
  });

  it('passes through what it cannot parse rather than mangling it', () => {
    expect(poolSizedUrl('not a url', 6)).toBe('not a url');
    expect(poolSizedUrl(undefined, 6)).toBeUndefined();
  });
});
