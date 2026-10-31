import { beforeEach, describe, expect, it, vi } from 'vitest';

// R12 ruling 19, imports: a failed job whose tournament resolves to a stored
// row, ignored or not, is covered by the stored copy and is not in the Inbox
// or its count. Only a job whose tournament is not stored is raised.

const h = vi.hoisted(() => ({ jobs: vi.fn(), match: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { ingestJob: { findMany: h.jobs } } }));
vi.mock('@/lib/admin/scrapeHealth', () => ({ matchJobs: h.match }));
vi.mock('@/lib/admin/adminChecks', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/adminChecks')>()),
  marksFor: async () => new Map(),
}));

const { openImportGroups } = await import('@/lib/admin/inbox');

const job = (id: string, url: string) => ({
  id,
  userId: 'u1',
  url,
  attempts: 1,
  lastError: 'boom',
  finishedAt: new Date('2026-10-30T00:00:00Z'),
  scheduledAt: new Date('2026-10-29T00:00:00Z'),
});

beforeEach(() => {
  h.jobs.mockReset();
  h.match.mockReset();
});

describe('failed imports and ignored tournaments', () => {
  it('raises the unstored one only, leaving the stored (here ignored) one out', async () => {
    h.jobs.mockResolvedValue([
      job('a', 'https://a.calicotab.com/ignored-test/'),
      job('b', 'https://b.calicotab.com/never-stored/'),
    ]);
    h.match.mockResolvedValue({
      stored: new Map([['a', { id: '7', name: 'test', scrapedAt: new Date() }]]),
      ambiguous: new Map(),
    });
    const { open } = await openImportGroups();
    expect(open.map((x) => x.g.jobs.map((j) => j.id))).toEqual([['b']]);
  });
});
