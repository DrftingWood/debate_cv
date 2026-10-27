import { describe, expect, it } from 'vitest';
import { shouldMigrate } from '../scripts/lib/migrate-gate.mjs';

const URL = 'postgres://example/db';

describe('shouldMigrate', () => {
  it('skips when no URL is set', () => {
    expect(shouldMigrate({}).migrate).toBe(false);
    expect(shouldMigrate({ VERCEL: '1', VERCEL_ENV: 'production' }).migrate).toBe(false);
  });
  it('migrates on Vercel production with a URL', () => {
    const env = { VERCEL: '1', VERCEL_ENV: 'production', POSTGRES_URL_NON_POOLING: URL };
    expect(shouldMigrate(env).migrate).toBe(true);
  });
  it('skips on Vercel preview with a URL', () => {
    const r = shouldMigrate({ VERCEL: '1', VERCEL_ENV: 'preview', POSTGRES_URL_NON_POOLING: URL });
    expect(r.migrate).toBe(false);
    expect(r.reason).toContain('ALLOW_PREVIEW_MIGRATIONS=1');
  });
  it('migrates on Vercel preview when ALLOW_PREVIEW_MIGRATIONS=1', () => {
    const env = {
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      POSTGRES_URL_NON_POOLING: URL,
      ALLOW_PREVIEW_MIGRATIONS: '1',
    };
    expect(shouldMigrate(env).migrate).toBe(true);
  });
  it('migrates on a non-Vercel build with a URL', () => {
    expect(shouldMigrate({ POSTGRES_URL_NON_POOLING: URL }).migrate).toBe(true);
  });
  it('falls back to DIRECT_URL', () => {
    expect(shouldMigrate({ DIRECT_URL: URL }).migrate).toBe(true);
    expect(shouldMigrate({ VERCEL: '1', VERCEL_ENV: 'preview', DIRECT_URL: URL }).migrate).toBe(
      false,
    );
  });
});
