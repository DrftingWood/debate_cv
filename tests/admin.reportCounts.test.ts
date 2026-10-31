import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task R6 fix round 1: the Reports chips carry counts. Each status comes from
// one grouped query; Checked counts only the marks that still hold.

const h = vi.hoisted(() => ({
  db: { cvErrorReport: { groupBy: vi.fn(), findMany: vi.fn() } },
  marks: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: h.db }));
vi.mock('@/lib/admin/adminChecks', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/adminChecks')>()),
  listMarks: h.marks,
}));

const { reportCounts } = await import('@/lib/admin/reportsChecked');
const { fingerprintOf } = await import('@/lib/admin/adminChecks');

const mark = (status: string) => ({
  fingerprint: fingerprintOf('report', { status }),
  checkedBy: 'o@x.org',
  checkedAt: new Date('2026-10-30T10:00:00Z'),
  note: null,
});

beforeEach(() => {
  h.db.cvErrorReport.groupBy.mockResolvedValue([
    { status: 'open', _count: { _all: 4 } },
    { status: 'fixed', _count: { _all: 7 } },
  ]);
});

describe('reportCounts', () => {
  it('counts each status, all, and only the marks that still hold', async () => {
    h.marks.mockResolvedValue(
      new Map([
        ['r1', mark('open')],
        ['r2', mark('open')],
      ]),
    );
    // r1 is still open (its mark holds); r2 has since been fixed (its mark lapsed).
    h.db.cvErrorReport.findMany.mockResolvedValue([
      { id: 'r1', status: 'open' },
      { id: 'r2', status: 'fixed' },
    ]);
    expect(await reportCounts()).toEqual({
      open: 4,
      acknowledged: 0,
      fixed: 7,
      wont_fix: 0,
      all: 11,
      checked: 1,
    });
  });
});
