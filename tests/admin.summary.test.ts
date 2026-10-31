import { beforeEach, describe, expect, it, vi } from 'vitest';

// The summary line sits above every tab, so its reads are count-only: audits
// are grouped in SQL (never findMany with the checks JSON) and the inbox is
// counted without building a single item.

const h = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
  jobCount: vi.fn(async () => 4),
  countInbox: vi.fn(),
  listInbox: vi.fn(),
  overview: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    tournamentAudit: { groupBy: h.groupBy, findMany: h.findMany },
    ingestJob: { count: h.jobCount },
  },
}));
vi.mock('@/lib/admin/inbox', () => ({ countInbox: h.countInbox, listInbox: h.listInbox }));
vi.mock('@/lib/admin/accuracy', () => ({ getAccuracyOverview: h.overview }));

beforeEach(() => {
  vi.clearAllMocks();
  h.countInbox.mockResolvedValue({ check: 2, report: 1, import: 3, parser: 0 });
});

describe('getSummary', () => {
  it('counts bands and the weighted score from grouped audits, without findMany or an overview', async () => {
    h.groupBy.mockResolvedValue([
      { score: 95, usersAffected: 0, _count: { _all: 2 } },
      { score: 90, usersAffected: 1, _count: { _all: 1 } },
      { score: 89, usersAffected: 0, _count: { _all: 1 } },
      { score: 70, usersAffected: 0, _count: { _all: 1 } },
      { score: 69, usersAffected: 0, _count: { _all: 1 } },
    ]);
    const { getSummary } = await import('@/lib/admin/summary');
    const s = await getSummary();
    expect(s.accuracy).toMatchObject({ good: 3, check: 2, rescrape: 1 });
    // (95*2 + 90*2 + 89 + 70 + 69) / (2 + 2 + 1 + 1 + 1) = 598 / 7 -> 85
    expect(s.accuracy?.score).toBe(85);
    expect(s.needsYou).toBe(6);
    expect(s.importsFailing).toBe(3);
    expect(s.queue).toBe(4);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.overview).not.toHaveBeenCalled();
    expect(h.listInbox).not.toHaveBeenCalled();
  });

  it('gives a null score and zero bands when nothing is audited', async () => {
    h.groupBy.mockResolvedValue([]);
    const { getSummary } = await import('@/lib/admin/summary');
    expect((await getSummary()).accuracy).toEqual({ score: null, good: 0, check: 0, rescrape: 0 });
  });

  it('shows a dash for a figure whose read failed and keeps the others', async () => {
    h.groupBy.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getSummary } = await import('@/lib/admin/summary');
    const s = await getSummary();
    expect(s.accuracy).toBeNull();
    expect(s.queue).toBe(4);
  });
});
