import { describe, expect, it, vi } from 'vitest';
import { extractNavigation } from '@/lib/calicotab/parseNav';
import { parseRoundResults } from '@/lib/calicotab/parseTabs';
import {
  emptyRoundOutcome,
  roundPublishedEmpty,
  unpublishedTabOutcomes,
} from '@/lib/calicotab/unpublished';
import { pieceOutcome, recordPieceOutcomes, type PieceOutcome } from '@/lib/calicotab/scrapePieces';
import { check, inputs, marked, piece } from './fixtures/auditInputs';
import { bpRows } from './fixtures/auditInputs';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

// What a tournament never published is not a failure. TGS Sept 2021
// (Tabbycat 2.12.1) serves R1 with its columns and `"data": []`; Euphoria
// links outrounds but no break tab and no team tab.

const BASE = 'https://wolce.calicotab.com/tgssept2021/';
const vueRound = (data: string) =>
  `<html><body><h1>Round 1</h1><script>window.vueData = {"tablesData":[{"head":[{"key":"team","title":"Team"},{"key":"points","title":"Pts"}],"data":${data},"empty_title":"No Data Available"}]}</script></body></html>`;
const link = (path: string, text: string) => `<a href="${BASE}${path}">${text}</a>`;
const landing = (links: string[]) => `<html><body>${links.join('')}</body></html>`;

describe('a round published with columns and no rows', () => {
  it('is detected from the vue table (TGS shape)', () => {
    const html = vueRound('[]');
    expect(parseRoundResults(html, `${BASE}results/round/1/`).teamResults).toEqual([]);
    expect(roundPublishedEmpty(html)).toBe(true);
  });
  it('is not a page with rows, no table, or unreadable data', () => {
    expect(roundPublishedEmpty(vueRound('[[{"text":"A"},{"text":"3"}]]'))).toBe(false);
    expect(roundPublishedEmpty('<html><body>Maintenance</body></html>')).toBe(false);
  });
  it('becomes a withheld outcome with reason not_published, not ok', () => {
    const done = pieceOutcome('round', `${BASE}results/round/1/`, { status: 200 });
    expect(emptyRoundOutcome(done)).toMatchObject({
      ok: false,
      withheld: true,
      reason: 'not_published',
      key: '1',
    });
  });
});

describe('a tab the menu never links', () => {
  const nav = (links: string[]) => extractNavigation(landing(links), BASE);

  it('is recorded as not published when other tabs are linked', () => {
    const n = nav([link('tab/speaker/', 'Speaker Tab'), link('results/round/1/', 'Round 1')]);
    const out = unpublishedTabOutcomes(n, []);
    expect(out.map((o) => o.kind).sort()).toEqual(['motions', 'participants', 'team']);
    expect(out.find((o) => o.kind === 'team')).toMatchObject({
      withheld: true,
      reason: 'not_published',
      url: `${BASE}tab/team/`,
      label: 'Team tab',
    });
  });
  it('is not judged when only an institutions link was discovered', () => {
    const n = nav([link('participants/institutions/', 'Institutions')]);
    expect(n.meta.discovered).toEqual(['institutions']);
    expect(unpublishedTabOutcomes(n, [])).toEqual([]);
  });
  it('is not judged when the menu could not be read', () => {
    expect(unpublishedTabOutcomes(nav([]), [])).toEqual([]);
  });
  it('keeps a constructed page that loaded, and any failure that is not a 404', () => {
    const n = nav([link('tab/speaker/', 'Speaker Tab')]);
    const loaded = pieceOutcome('team', `${BASE}tab/team/`, { status: 200 });
    const timeout = pieceOutcome('motions', `${BASE}motions/`, { status: 504, error: 'HTTP 504' });
    const outcomes = [loaded, timeout];
    const out = unpublishedTabOutcomes(n, outcomes);
    expect(out.map((o) => o.kind)).toEqual(['participants']);
    expect(outcomes).toHaveLength(2);
  });
  it('moves a 404 on the constructed page out of the failures', () => {
    const n = nav([link('tab/speaker/', 'Speaker Tab')]);
    const gone = pieceOutcome('team', `${BASE}tab/team/`, { status: 404, error: 'HTTP 404' });
    const outcomes: PieceOutcome[] = [gone];
    const out = unpublishedTabOutcomes(n, outcomes);
    expect(out.find((o) => o.kind === 'team')?.httpStatus).toBe(404);
    expect(outcomes).toEqual([]);
  });
  it('records a missing break tab only when outrounds are linked (Euphoria shape)', () => {
    const withOut = nav([
      link('tab/speaker/', 'Speaker Tab'),
      link('results/round/5/', 'Quarterfinals'),
    ]);
    expect(unpublishedTabOutcomes(withOut, []).some((o) => o.kind === 'break')).toBe(true);
    const prelimsOnly = nav([
      link('tab/speaker/', 'Speaker Tab'),
      link('results/round/1/', 'Round 1'),
    ]);
    expect(unpublishedTabOutcomes(prelimsOnly, []).some((o) => o.kind === 'break')).toBe(false);
  });
  it('honours a partial re-scrape that did not ask for the tab', () => {
    const n = nav([link('tab/speaker/', 'Speaker Tab')]);
    const out = unpublishedTabOutcomes(n, [], [{ kind: 'team', key: '' }]);
    expect(out.map((o) => o.kind)).toEqual(['team']);
  });
});

describe('recording', () => {
  it('stores the reason on a withheld piece and clears it on a later load', async () => {
    resetPrismaMock();
    prismaMock.scrapePiece.upsert.mockResolvedValue({});
    const done = pieceOutcome('round', `${BASE}results/round/1/`, { status: 200 });
    await recordPieceOutcomes(5n, [emptyRoundOutcome(done), done]);
    const [held, ok] = prismaMock.scrapePiece.upsert.mock.calls.map((c) => c[0]);
    expect(held.update).toMatchObject({
      status: 'withheld',
      reason: 'not_published',
    });
    expect(ok.update).toMatchObject({ status: 'ok', reason: null });
  });
});

describe('an absent link never downgrades a piece that loaded', () => {
  const absent = (kind: 'team' | 'break', key: string) =>
    ({
      kind,
      key,
      label: 'x',
      url: BASE,
      ok: false,
      httpStatus: null,
      error: 'Not published by the tournament',
      withheld: true,
      reason: 'not_published',
    }) as PieceOutcome;
  it('leaves an ok or failed piece alone, and writes over a withheld or missing one', async () => {
    resetPrismaMock();
    prismaMock.scrapePiece.upsert.mockResolvedValue({});
    prismaMock.scrapePiece.findUnique
      .mockResolvedValueOnce({ status: 'ok' })
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ status: 'withheld' })
      .mockResolvedValueOnce(null);
    await recordPieceOutcomes(5n, [
      absent('team', ''),
      absent('break', 'open'),
      absent('team', ''),
      absent('break', 'open'),
    ]);
    expect(prismaMock.scrapePiece.upsert).toHaveBeenCalledTimes(2);
  });
  it('a real 404 answer still withholds an ok piece', async () => {
    resetPrismaMock();
    prismaMock.scrapePiece.upsert.mockResolvedValue({});
    prismaMock.scrapePiece.findUnique.mockResolvedValue({ status: 'ok' });
    await recordPieceOutcomes(5n, [{ ...absent('team', ''), httpStatus: 404 }]);
    expect(prismaMock.scrapePiece.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('the audit treats not_published like withheld', () => {
  const notPub = (kind: 'team' | 'round', key: string, label: string) => ({
    ...marked(piece(kind, key, label), 'withheld'),
    reason: 'not_published',
  });

  it('team tab: na, worded as not published, nothing suggested', () => {
    const c = check(
      inputs({ roundRows: bpRows([8, 8, 8]), pieces: [notPub('team', '', 'Team tab')] }),
      'team_coverage',
    );
    expect(c.status).toBe('na');
    expect(c.detail).toBe("The tournament hasn't published its team tab.");
    expect(c.pieces).toEqual([]);
  });
  it('rounds: R3 published empty is not expected and says so', () => {
    const c = check(
      inputs({ roundRows: bpRows([8, 8]), pieces: [notPub('round', '3', 'R3')] }),
      'rounds_complete',
    );
    expect(c.status).toBe('pass');
    expect(c.detail).toContain('R3 was published with no results');
    expect(c.pieces).toEqual([]);
  });
});

describe('the piece grid pill', () => {
  it('reads "Not published" for a never-published piece, not "Withheld"', async () => {
    const { toPieceCard } = await import('@/lib/admin/pieceGrid');
    const row = {
      kind: 'team' as const,
      key: '',
      label: 'Team tab',
      status: 'withheld' as const,
      httpStatus: null,
      attempts: 0,
      loadedAt: null,
      lastAttemptAt: new Date('2026-10-31T00:00:00Z'),
      nextRetryAt: null,
      lastError: null,
    };
    const now = new Date('2026-10-31T01:00:00Z');
    expect(toPieceCard({ ...row, reason: 'not_published' }, now).pill).toBe('Not published');
    expect(toPieceCard({ ...row, reason: 'withheld' }, now).pill).toBe(
      'Withheld by the tournament',
    );
  });
});
