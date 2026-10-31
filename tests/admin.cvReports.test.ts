import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// Task 5d: the CV error reports as a paged ledger (owner, 2026-10-31:
// "remake the cv error table ... according to these guidelines"). The read
// model pages twenty at a time, newest first, filtered by status (open by
// default); each tournament a report names carries its Tab state, its
// public tab address and the pages the audit engine would suggest
// re-scraping for the report's categories. The PATCH route moves a report
// through its statuses.

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));
const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { listCvReports } = await import('@/lib/admin/cvReports');
const { REPORTS_PER_PAGE, readReportFilter, readPage } = await import('@/lib/admin/cvReportTypes');
const { rangeText } = await import('@/components/ui/Pager');
const { runChecks } = await import('@/lib/audit/checks');
const { PATCH } = await import('@/app/api/admin/cv-reports/[id]/route');

const KEY = 'k3yS3cr3t';
const PRIVATE = `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`;
const NOW = new Date('2026-10-31T12:00:00Z');

const report = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  userId: 'u1',
  tournamentIds: ['7'],
  categories: ['wrong_speaker_rank'],
  comment: 'My rank is wrong',
  status: 'open',
  adminNote: null,
  createdAt: NOW,
  resolvedAt: null,
  user: { name: 'Maya', email: 'maya@example.com' },
  ...over,
});

const PIECES = [
  { kind: 'team', key: '', label: 'Team tab', status: 'ok' },
  { kind: 'speaker', key: '', label: 'Speaker tab', status: 'ok' },
  { kind: 'round', key: '1', label: 'R1', status: 'ok' },
  { kind: 'round', key: '2', label: 'R2', status: 'failed', httpStatus: 503 },
  { kind: 'round', key: '3', label: 'R3', status: 'ok' },
  { kind: 'round', key: '5', label: 'Grand Final', status: 'ok' },
  { kind: 'break', key: 'open', label: 'Open break', status: 'ok' },
].map((p) => ({
  tournamentId: 7n,
  url: `${PRIVATE}x/`,
  httpStatus: null,
  lastError: null,
  ...p,
}));

beforeEach(() => {
  resetPrismaMock();
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
  prismaMock.cvErrorReport.count.mockResolvedValue(1);
  prismaMock.cvErrorReport.findMany.mockResolvedValue([report()]);
  prismaMock.tournament.findMany.mockResolvedValue([
    { id: 7n, name: 'Oxford IV', sourceUrlRaw: PRIVATE, prelimRoundCount: 3 },
  ]);
  prismaMock.scrapePiece.findMany.mockResolvedValue(PIECES);
  prismaMock.teamResult.groupBy.mockResolvedValue([]);
});

describe('paging the CV reports', () => {
  it('reads twenty a page, newest first, open by default', async () => {
    prismaMock.cvErrorReport.count.mockResolvedValue(87);
    const list = await listCvReports({ page: 2 });
    const args = prismaMock.cvErrorReport.findMany.mock.calls[0]![0];
    expect(REPORTS_PER_PAGE).toBe(20);
    expect(args.skip).toBe(20);
    expect(args.take).toBe(20);
    expect(args.where).toEqual({ status: 'open' });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(list).toMatchObject({ total: 87, page: 2, pages: 5, status: 'open' });
    expect(rangeText(list.page, REPORTS_PER_PAGE, list.total)).toBe('21–40 of 87');
  });

  it('clamps a page past the end, and below 1, and filters by any status or none', async () => {
    prismaMock.cvErrorReport.count.mockResolvedValue(87);
    expect((await listCvReports({ page: 99, status: 'fixed' })).page).toBe(5);
    expect(prismaMock.cvErrorReport.findMany.mock.calls[0]![0]).toMatchObject({
      skip: 80,
      where: { status: 'fixed' },
    });
    expect((await listCvReports({ page: -3, status: 'all' })).page).toBe(1);
    expect(prismaMock.cvErrorReport.findMany.mock.calls[1]![0]).toMatchObject({
      skip: 0,
      where: {},
    });
  });

  it('tells "no reports at all" from "none with this status"', async () => {
    prismaMock.cvErrorReport.count.mockResolvedValueOnce(0).mockResolvedValueOnce(4);
    prismaMock.cvErrorReport.findMany.mockResolvedValue([]);
    expect(await listCvReports({ page: 1 })).toMatchObject({ total: 0, anyReports: true });
    prismaMock.cvErrorReport.count.mockResolvedValue(0);
    expect(await listCvReports({ page: 1 })).toMatchObject({ total: 0, anyReports: false });
  });

  it('reads the query parameters forgivingly', () => {
    expect(readReportFilter(undefined)).toBe('open');
    expect(readReportFilter('wont_fix')).toBe('wont_fix');
    expect(readReportFilter('all')).toBe('all');
    expect(readReportFilter('nonsense')).toBe('open');
    expect(readPage(undefined)).toBe(1);
    expect(readPage('3')).toBe(3);
    expect(readPage('x')).toBe(1);
    expect(rangeText(1, 20, 5)).toBe('1–5 of 5');
  });
});

describe('a report row', () => {
  it('names the reporter, labels its categories and shows its tournaments with Tab status', async () => {
    const [row] = (await listCvReports({ page: 1 })).rows;
    expect(row!.reporter).toEqual({ name: 'Maya', email: 'maya@example.com' });
    expect(row!.categories).toEqual([{ code: 'wrong_speaker_rank', label: 'Wrong speaker rank' }]);
    const t = row!.tournaments[0]!;
    expect(t).toMatchObject({ id: '7', name: 'Oxford IV', stored: true });
    expect(t.tabUrl).toBe('https://oxiv.calicotab.com/oxiv2025/');
    expect(t.tab).toEqual({
      state: 'partial',
      tournamentId: '7',
      errors: ['R2: HTTP 503 Service Unavailable'],
    });
    expect(JSON.stringify(row)).not.toContain(KEY);
  });

  it('keeps a tournament that is no longer stored, as not loaded and unlinked', async () => {
    prismaMock.cvErrorReport.findMany.mockResolvedValue([report({ tournamentIds: ['7', '99'] })]);
    const [row] = (await listCvReports({ page: 1 })).rows;
    expect(row!.tournaments[1]).toMatchObject({
      id: '99',
      stored: false,
      tabUrl: null,
      suggested: [],
      tab: { state: 'missing' },
    });
  });

  it('removes a private key a user pasted into the comment', async () => {
    prismaMock.cvErrorReport.findMany.mockResolvedValue([
      report({ comment: `my link ${PRIVATE}tab/speaker/ is wrong` }),
    ]);
    const [row] = (await listCvReports({ page: 1 })).rows;
    expect(row!.comment).toBe('my link https://oxiv.calicotab.com/oxiv2025/ is wrong');
  });
});

describe('suggested pages', () => {
  it('suggests the pages the audit engine would, for the same categories', async () => {
    const categories = ['wrong_team_result', 'wrong_outround', 'wrong_teammate', 'wrong_identity'];
    prismaMock.cvErrorReport.findMany.mockResolvedValue([report({ categories })]);
    const [row] = (await listCvReports({ page: 1 })).rows;

    const engine = runChecks(
      {
        format: null,
        prelimRoundCount: 3,
        parserVersion: null,
        teamTab: [],
        roundRows: [],
        outrounds: [],
        breakRows: [],
        speakersByTeam: {},
        redactedByTeam: {},
        speakerParticipants: 0,
        speakersWithScores: 0,
        judgeParticipants: 0,
        roundResultJudges: 0,
        judgesByRound: {},
        motionRounds: [],
        pieces: PIECES.map(({ kind, key, label, status, url }) => ({
          kind: kind as 'round',
          key,
          label,
          status: status as 'ok',
          url,
        })),
        openReports: [{ categories }],
      },
      'v',
    ).find((c) => c.code === 'user_reports')!;
    expect(row!.tournaments[0]!.suggested).toEqual(engine.pieces);
    expect(engine.pieces.length).toBeGreaterThan(3);
    expect(JSON.stringify(row!.tournaments[0]!.suggested)).not.toContain(KEY);
  });

  it('counts prelims from the stored rounds when the round count was never recorded', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 7n, name: 'Oxford IV', sourceUrlRaw: PRIVATE, prelimRoundCount: null },
    ]);
    prismaMock.teamResult.groupBy.mockResolvedValue([
      { tournamentId: 7n, _max: { roundNumber: 2 } },
    ]);
    prismaMock.cvErrorReport.findMany.mockResolvedValue([
      report({ categories: ['wrong_team_result'] }),
    ]);
    const [row] = (await listCvReports({ page: 1 })).rows;
    expect(row!.tournaments[0]!.suggested.map((p) => p.label)).toEqual(['Team tab', 'R1', 'R2']);
  });
});

const patchReport = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://x/api/admin/cv-reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe('PATCH /api/admin/cv-reports/[id]', () => {
  const patch = patchReport;

  beforeEach(() => {
    prismaMock.cvErrorReport.updateMany.mockResolvedValue({ count: 1 });
  });

  it('sets resolvedAt when an open report is fixed or will not be fixed', async () => {
    for (const status of ['fixed', 'wont_fix']) {
      // Not closed yet: the keep-the-stamp update matches nothing.
      prismaMock.cvErrorReport.updateMany.mockResolvedValueOnce({ count: 0 });
      const res = await patch('r1', { status });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    const calls = prismaMock.cvErrorReport.updateMany.mock.calls;
    expect(calls[1]![0].where).toEqual({ id: 'r1' });
    expect(calls[1]![0].data.status).toBe('fixed');
    expect(calls[1]![0].data.resolvedAt).toBeInstanceOf(Date);
    expect(calls[3]![0].data.resolvedAt).toBeInstanceOf(Date);
  });

  it('clears resolvedAt when a report is opened again or acknowledged', async () => {
    await patch('r1', { status: 'open' });
    await patch('r1', { status: 'acknowledged' });
    const calls = prismaMock.cvErrorReport.updateMany.mock.calls;
    expect(calls[0]![0].data).toEqual({ status: 'open', resolvedAt: null });
    expect(calls[1]![0].data).toEqual({ status: 'acknowledged', resolvedAt: null });
  });

  it('answers 404 for a report that is gone, and 400 for a bad body', async () => {
    prismaMock.cvErrorReport.updateMany.mockResolvedValue({ count: 0 });
    const gone = await patch('r9', { status: 'fixed' });
    expect((await patch('r9', { status: 'open' })).status).toBe(404);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: 'not_found' });
    for (const body of [{ status: 'closed' }, {}, null]) {
      const res = await patch('r1', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_request' });
    }
    expect((await patch('bad id!', { status: 'fixed' })).status).toBe(400);
  });

  it('answers 403 to a non-admin and 401 when signed out, and writes nothing', async () => {
    requireAdminMock.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await patch('r1', { status: 'fixed' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    requireAdminMock.mockRejectedValueOnce(
      Object.assign(new Error('unauthorized'), { status: 401 }),
    );
    expect((await patch('r1', { status: 'fixed' })).status).toBe(401);
    expect(prismaMock.cvErrorReport.updateMany).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/cv-reports/[id] between closed statuses', () => {
  beforeEach(() => {
    prismaMock.cvErrorReport.updateMany.mockResolvedValue({ count: 1 });
  });

  // Review leftover: fixed → won't fix re-stamped the time it was closed.
  it("keeps resolvedAt when a closed report moves between fixed and won't fix", async () => {
    const res = await patchReport('r1', { status: 'wont_fix' });
    expect(res.status).toBe(200);
    const calls = prismaMock.cvErrorReport.updateMany.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual({
      where: { id: 'r1', resolvedAt: { not: null } },
      data: { status: 'wont_fix' },
    });
  });
});
