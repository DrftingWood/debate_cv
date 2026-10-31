import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// Ruling 11: an accuracy check can be set aside for review. The review set's
// 'audit_check' source names it `<tournamentId>:<checkCode>`; the route
// refuses other shapes, the writer takes the tournament's public tab, and
// the reader and export describe it by tournament name and check label.

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));
const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { POST } = await import('@/app/api/admin/review-set/route');
const { addToReviewSet, loadReviewSet, reviewSetCsv, toExportRecord } =
  await import('@/lib/admin/reviewSet');
const { parseAuditCheckId, SOURCES } = await import('@/lib/admin/reviewSetTypes');

const KEY = 'k3yS3cr3t';
const PRIVATE = `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`;

const post = (sourceId: string) =>
  POST(
    new Request('http://x/api/admin/review-set', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ source: 'audit_check', sourceId }],
        priority: 'medium',
        comment: 'look at this',
      }),
    }),
  );

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  resetPrismaMock();
  prismaMock.reviewFlag.findMany.mockResolvedValue([]);
  prismaMock.reviewFlag.createMany.mockImplementation(async ({ data }) => ({ count: data.length }));
  prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
  prismaMock.scrapePiece.findMany.mockResolvedValue([]);
  prismaMock.ingestJob.findMany.mockResolvedValue([]);
  prismaMock.tournament.findMany.mockResolvedValue([
    { id: 5n, name: 'Oxford IV 2025', sourceUrlRaw: PRIVATE },
  ]);
});

describe('the audit_check source id', () => {
  it('is a source, and reads <digits>:<known check>', () => {
    expect(SOURCES).toContain('audit_check');
    expect(parseAuditCheckId('5:rounds_complete')).toEqual({
      tournamentId: '5',
      code: 'rounds_complete',
    });
    for (const bad of ['5', '5:nonsense', 'x:rounds_complete', '0x10:champion', '5:champion:x']) {
      expect(parseAuditCheckId(bad)).toBeNull();
    }
  });
});

describe('POST /api/admin/review-set with an audit check', () => {
  it('accepts a known check and stores the tournament and its public tab', async () => {
    const res = await post('5:rounds_complete');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ flagged: 1 });
    const data = prismaMock.reviewFlag.createMany.mock.calls[0][0].data;
    expect(data).toEqual([
      expect.objectContaining({
        source: 'audit_check',
        sourceId: '5:rounds_complete',
        url: 'https://oxiv.calicotab.com/oxiv2025/',
        tournamentId: 5n,
      }),
    ]);
    expect(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(
      KEY,
    );
  });

  it('refuses an id that is not a tournament and a known check', async () => {
    for (const bad of ['5:nonsense', 'five:champion', '5']) {
      expect((await post(bad)).status).toBe(400);
    }
    expect(prismaMock.reviewFlag.createMany).not.toHaveBeenCalled();
  });

  it('skips a check whose tournament is no longer stored', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([]);
    const out = await addToReviewSet({
      items: [{ source: 'audit_check', sourceId: '9:champion' }],
      priority: 'low',
      comment: 'x',
      createdBy: 'a@b.c',
    });
    expect(out).toEqual({ flagged: 0 });
  });
});

describe('reading and exporting an audit check flag', () => {
  const row = {
    id: 3n,
    source: 'audit_check',
    sourceId: '5:rounds_complete',
    url: 'https://oxiv.calicotab.com/oxiv2025/',
    tournamentId: 5n,
    tournament: { id: 5n, name: 'Oxford IV 2025' },
    priority: 'medium',
    comment: 'look',
    status: 'open',
    createdBy: 'a@b.c',
    createdAt: new Date('2026-10-30T00:00:00Z'),
  };

  it('names the tournament and the check in words', async () => {
    prismaMock.reviewFlag.findMany.mockResolvedValue([row]);
    const [view] = await loadReviewSet();
    expect(view!.detail).toEqual({
      kind: 'audit_check',
      tournament: { id: '5', name: 'Oxford IV 2025' },
      check: 'Rounds complete',
    });
    expect(view!.tournament).toEqual({ id: '5', name: 'Oxford IV 2025' });
    expect(toExportRecord(view!).detail).toMatchObject({ check: 'Rounds complete' });
    const csv = reviewSetCsv([view!]);
    expect(csv).toContain('audit_check');
    expect(csv).toContain('Oxford IV 2025 · Rounds complete');
  });
});
