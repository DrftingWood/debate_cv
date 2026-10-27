import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// C100: the public CV photo is off unless the owner opts in.
describe('public avatar default (C100)', () => {
  it('schema defaults publicAvatarEnabled to false', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    expect(schema).toMatch(/publicAvatarEnabled\s+Boolean\s+@default\(false\)/);
  });

  it('the sharing API reports the photo as off when there is no user row', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    vi.doMock('@/lib/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }));
    vi.doMock('@/lib/rateLimit', () => ({ enforceRateLimit: async () => null }));
    vi.doMock('@/lib/db', () => ({
      prisma: {
        user: { findUnique: async () => null },
        discoveredUrl: { findMany: async () => [] },
      },
    }));
    const { GET } = await import('@/app/api/sharing/route');
    const data = (await (await GET()).json()) as { avatarEnabled: boolean };
    expect(data.avatarEnabled).toBe(false);
  });
});
