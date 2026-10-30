import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * rescrapePieces (lib/calicotab/partialScrape.ts): re-scrape one tab or one
 * round of a stored tournament and delete only that piece's rows.
 *
 * Mocked the same way as calicotab.ingest.characterization.test.ts: the
 * database, the network and the parsers; everything between (nav narrowing,
 * the claim, the write transaction, the scoped deletes) is the real code.
 */

const BASE = 'https://oxiv.calicotab.com/oxiv2025/';
const R1 = `${BASE}results/round/1/`;
const R2 = `${BASE}results/round/2/`;
const R3 = `${BASE}results/round/3/`;
const GF = `${BASE}results/round/7/`;
const TEAM_TAB = `${BASE}tab/team/`;
const SPEAKER_TAB = `${BASE}tab/speaker/`;
const MOTIONS_TAB = `${BASE}motions/`;
const BREAK_TAB = `${BASE}break/teams/open/`;
const PARTICIPANTS = `${BASE}participants/list/`;

const h = vi.hoisted(() => ({
  fetchHtml: vi.fn(),
  fetchRound: vi.fn(),
  recordPieceOutcomes: vi.fn(),
  // Per-test break page parse (null: one Open row for Oxford A).
  breakRows: null as unknown[] | null,
}));

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@/lib/calicotab/provenance', () => ({
  recordParserRun: vi.fn(async () => undefined),
  collectRegistrationWarnings: () => [],
}));
vi.mock('@/lib/calicotab/scrapePieces', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/calicotab/scrapePieces')>()),
  recordPieceOutcomes: h.recordPieceOutcomes,
}));
vi.mock('@/lib/calicotab/yearFromEmail', () => ({
  fillTournamentYearFromEmails: async () => null,
}));
vi.mock('@/lib/calicotab/fetch', () => ({
  FETCH_MIN_INTERVAL_MS: 0,
  LANDING_FETCH_TIMEOUT_MS: 30_000,
  fetchHtmlWithProvenance: h.fetchHtml,
  fetchRoundWithProvenance: h.fetchRound,
  isCdnRateLimit: () => false,
  isWithheldByTournament: (r: { status: number; cdnBlocked?: boolean }) =>
    r.status === 404 || (r.status === 403 && r.cdnBlocked === false),
  withApiSnapshots: <T>(f: T) => f,
}));

const SNAPSHOT = {
  sourceUrl: BASE,
  tournamentName: 'Oxford IV 2025',
  navigation: {
    home: BASE,
    teamTab: TEAM_TAB,
    speakerTab: SPEAKER_TAB,
    motionsTab: MOTIONS_TAB,
    resultsRounds: [R1, R2, R3, GF],
    resultsRoundLabels: { [R1]: 'Round 1', [R2]: 'Round 2', [R3]: 'Round 3', [GF]: 'Grand Final' },
    breakTabs: [BREAK_TAB],
    participants: PARTICIPANTS,
    institutions: null,
    meta: { discovered: ['teamTab', 'speakerTab', 'resultsRounds'], constructed: [] as string[] },
  },
  registration: { personName: null, teamName: null, speakers: [], institution: null },
};

vi.mock('@/lib/calicotab/parseNav', () => ({
  parsePrivateUrlPage: () => structuredClone(SNAPSHOT),
  extractAdjudicatorRounds: () => [],
  extractSpeakerRounds: () => [],
}));

const prelim = (n: number) => ({
  roundLabel: `Round ${n}`,
  isOutround: false,
  roundNumber: n,
  teamResults: [
    { teamName: 'Oxford A', position: 'OG', points: 3, won: null },
    { teamName: 'Cambridge A', position: 'OO', points: 0, won: null },
  ],
  judgeAssignments: [{ personName: 'Judge Judy', panelRole: 'chair' }],
});
const ROUNDS: Record<string, unknown> = {
  [R1]: prelim(1),
  [R2]: prelim(2),
  [R3]: prelim(3),
  // Numbered by its URL, as roundIdentity numbers it.
  [GF]: {
    roundLabel: 'Grand Final',
    isOutround: true,
    roundNumber: 7,
    teamResults: [
      { teamName: 'Oxford A', position: 'OG', points: null, won: true },
      { teamName: 'Cambridge A', position: 'OO', points: null, won: false },
    ],
    judgeAssignments: [{ personName: 'Judge Judy', panelRole: 'chair' }],
  },
};

vi.mock('@/lib/calicotab/parseTabs', async (importActual) => ({
  // The real URL-to-stage mapping: a break piece is cleared by the stage its
  // rows are written under.
  breakPageKind: (await importActual<typeof import('@/lib/calicotab/parseTabs')>()).breakPageKind,
  parseTeamTab: () => [
    {
      rank: 1,
      teamName: 'Oxford A',
      institution: 'Oxford',
      speakers: ['Ada Lovelace'],
      wins: null,
      totalPoints: 5,
      firsts: 1,
      seconds: 1,
    },
  ],
  parseSpeakerTab: () => [
    {
      rank: 1,
      rankEsl: null,
      rankEfl: null,
      categories: [],
      speakerName: 'Ada Lovelace',
      teamName: 'Oxford A',
      institution: 'Oxford',
      totalScore: 160,
      roundScores: [],
    },
  ],
  parseRoundResults: (_html: string, url: string) => structuredClone(ROUNDS[url]),
  parseBreakPage: () =>
    h.breakRows ?? [
      {
        rank: 1,
        entityType: 'team',
        entityName: 'Oxford A',
        institution: 'Oxford',
        score: 5,
        stage: 'Open',
      },
    ],
  parseParticipantsList: () => [],
  diagnoseVueData: () => 'diagnosis',
}));
vi.mock('@/lib/calicotab/parseMotions', () => ({ parseMotionsTab: () => [] }));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { ScrapeBusyError } from '@/lib/calicotab/ingest';
import { rescrapePieces } from '@/lib/calicotab/partialScrape';
import { computeFingerprint, normalizePersonName } from '@/lib/calicotab/fingerprint';
import { PARSER_VERSION } from '@/lib/calicotab/version';
import { resetMotionsChecks } from '@/lib/calicotab/prescrape';

const FINGERPRINT = computeFingerprint({
  host: 'oxiv.calicotab.com',
  tournamentSlug: 'oxiv2025',
  tournamentName: 'Oxford IV 2025',
  year: 2025,
});
const PERSON_IDS: Record<string, bigint> = {
  [normalizePersonName('Ada Lovelace')]: 101n,
  [normalizePersonName('Judge Judy')]: 104n,
};

const EXISTING = {
  id: 7n,
  fingerprint: FINGERPRINT,
  sourceUrlRaw: BASE,
  scrapedAt: new Date('2025-03-01T00:00:00Z'),
  parserVersion: PARSER_VERSION,
  totalTeams: 2,
  totalParticipants: 4,
  year: 2025,
};

function okPage(url: string) {
  return {
    ok: true as const,
    url,
    html: `<html>${url}</html>`,
    status: 200,
    contentHash: 'hash',
    contentLength: 10,
    sourceDocumentId: `doc:${url}`,
    elapsedMs: 1,
  };
}

function install(opts: { claimHeld?: boolean } = {}) {
  let participantId = 500n;
  h.fetchHtml.mockImplementation(async (url: string) => okPage(url));
  h.fetchRound.mockImplementation(async (url: string) => okPage(url));
  h.recordPieceOutcomes.mockResolvedValue(undefined);
  prismaMock.tournament.findUnique.mockResolvedValue(EXISTING);
  prismaMock.tournament.findMany.mockResolvedValue([]);
  prismaMock.tournament.updateMany.mockImplementation(async (args: { data: object }) => ({
    // The claim is a conditional update: held means it matches no row.
    count: opts.claimHeld && 'scrapeClaimedAt' in args.data && args.data.scrapeClaimedAt ? 0 : 1,
  }));
  prismaMock.tournament.upsert.mockResolvedValue({ id: 7n });
  prismaMock.teamResult.findMany.mockResolvedValue([]);
  prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);
  prismaMock.tournamentParticipant.upsert.mockImplementation(async () => ({ id: participantId++ }));
  prismaMock.judgeAssignment.findMany.mockResolvedValue([]);
  prismaMock.judgeAssignment.createMany.mockResolvedValue({ count: 0 });
  prismaMock.person.findMany.mockResolvedValue([]);
  prismaMock.parserRun.findFirst.mockResolvedValue({ parserVersion: PARSER_VERSION });
  prismaMock.$queryRaw.mockImplementation(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('INSERT INTO "Person"')) {
        const id = PERSON_IDS[values[1] as string];
        return id ? [{ id }] : [];
      }
      return [];
    },
  );
  prismaMock.$executeRaw.mockResolvedValue(0);
}

const callsOf = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls.map((c) => c[0] as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any

const DELETING_MODELS = [
  'teamResult',
  'eliminationResult',
  'judgeAssignment',
  'speakerRoundScore',
  'participantRole',
  'tournamentParticipant',
  'motion',
] as const;
const allDeletes = () =>
  DELETING_MODELS.flatMap((m) =>
    callsOf(prismaMock[m].deleteMany).map((c) => ({ model: m, where: c.where })),
  );
const fetchedUrls = () => [
  ...h.fetchHtml.mock.calls.map((c) => c[0] as string),
  ...h.fetchRound.mock.calls.map((c) => c[0] as string),
];

let savedApiTabs: string | undefined;
beforeAll(() => {
  savedApiTabs = process.env.TABBYCAT_API_TABS;
  process.env.TABBYCAT_API_TABS = '0';
});
afterAll(() => {
  if (savedApiTabs === undefined) delete process.env.TABBYCAT_API_TABS;
  else process.env.TABBYCAT_API_TABS = savedApiTabs;
});
beforeEach(() => {
  resetPrismaMock();
  h.fetchHtml.mockReset();
  h.fetchRound.mockReset();
  h.recordPieceOutcomes.mockReset();
  h.breakRows = null;
  resetMotionsChecks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('rescrapePieces: scoped deletes', () => {
  it('rescraping round 3 deletes and rewrites only round 3', async () => {
    install();
    const result = await rescrapePieces(7n, [{ kind: 'round', key: '3' }]);

    expect(result).toEqual({
      tournamentId: 7n,
      loaded: [{ kind: 'round', key: '3' }],
      failed: [],
      notOnTab: [],
    });
    const teamDeletes = callsOf(prismaMock.teamResult.deleteMany);
    expect(teamDeletes).toEqual([{ where: { tournamentId: 7n, roundNumber: 3 } }]);
    // No tournament-wide refresh: nothing is deleted by tournament alone.
    for (const d of allDeletes()) expect(Object.keys(d.where)).not.toEqual(['tournamentId']);
    expect(prismaMock.tournamentParticipant.deleteMany).not.toHaveBeenCalled();
    // Round 3's judge panels are replaced through the pre-scrape's writer,
    // scoped to round 3.
    const judgeDeletes = callsOf(prismaMock.judgeAssignment.deleteMany);
    expect(judgeDeletes).toEqual([
      {
        where: {
          tournamentId: 7n,
          source: 'round_results',
          OR: [{ roundNumber: { in: [3] } }],
        },
      },
    ]);
    // Only round 3's rows are rewritten.
    const rounds = callsOf(prismaMock.teamResult.upsert).map(
      (c) => c.where.tournamentId_teamName_roundNumber.roundNumber,
    );
    expect(new Set(rounds)).toEqual(new Set([3]));
    expect(fetchedUrls().sort()).toEqual([BASE, R3].sort());
  });

  it('an outround deletes only its stage', async () => {
    install();
    await rescrapePieces(7n, [{ kind: 'round', key: '7' }]);

    expect(callsOf(prismaMock.eliminationResult.deleteMany)).toEqual([
      {
        where: {
          tournamentId: 7n,
          entityType: 'team',
          stage: 'Grand Final',
          result: { in: ['won', 'lost'] },
        },
      },
    ]);
    expect(callsOf(prismaMock.teamResult.deleteMany)).toEqual([
      { where: { tournamentId: 7n, roundNumber: 7 } },
    ]);
  });
});

describe('rescrapePieces: what it refuses or reports', () => {
  it('a round no longer on the tab is reported, not deleted', async () => {
    install();
    const result = await rescrapePieces(7n, [{ kind: 'round', key: '9' }]);

    expect(result).toEqual({
      tournamentId: 7n,
      loaded: [],
      failed: [],
      notOnTab: [{ kind: 'round', key: '9' }],
    });
    expect(allDeletes()).toEqual([]);
    // Nothing to re-scrape: only the landing page was read, no claim taken.
    expect(fetchedUrls()).toEqual([BASE]);
    expect(prismaMock.tournament.updateMany).not.toHaveBeenCalled();
    // It is no longer a piece of the tournament: its ScrapePiece row goes.
    expect(callsOf(prismaMock.scrapePiece.deleteMany)).toEqual([
      { where: { tournamentId: 7n, OR: [{ kind: 'round', key: '9' }] } },
    ]);
  });

  it('refuses while another scrape holds the claim', async () => {
    install({ claimHeld: true });
    await expect(rescrapePieces(7n, [{ kind: 'round', key: '3' }])).rejects.toBeInstanceOf(
      ScrapeBusyError,
    );
    expect(prismaMock.tournament.upsert).not.toHaveBeenCalled();
    expect(allDeletes()).toEqual([]);
    expect(fetchedUrls()).toEqual([BASE]);
  });
});

describe("rescrapePieces: 'failed'", () => {
  it("'failed' re-scrapes exactly the failed pieces", async () => {
    install();
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      { kind: 'round', key: '2' },
      { kind: 'break', key: 'open' },
    ]);
    const result = await rescrapePieces(7n, 'failed');

    expect(callsOf(prismaMock.scrapePiece.findMany)[0]!.where).toEqual({
      tournamentId: 7n,
      status: 'failed',
    });
    expect(fetchedUrls().sort()).toEqual([BASE, R2, BREAK_TAB].sort());
    expect(result.loaded).toEqual(
      expect.arrayContaining([
        { kind: 'round', key: '2' },
        { kind: 'break', key: 'open' },
      ]),
    );
    // The break is cleared by its stage, keeping won/lost rows.
    expect(callsOf(prismaMock.eliminationResult.deleteMany)).toContainEqual({
      where: { tournamentId: 7n, stage: 'Open', result: null },
    });
  });
});

describe('rescrapePieces: what a partial re-scrape must leave alone', () => {
  const failedPage = (url: string) => ({
    ok: false,
    url,
    status: 504,
    bodyPreview: '',
    elapsedMs: 1,
  });

  it('every requested page failing records the failures and reports them', async () => {
    install();
    h.fetchRound.mockImplementation(async (url: string) => failedPage(url));
    const result = await rescrapePieces(7n, [{ kind: 'round', key: '3' }]);

    expect(result).toEqual({
      tournamentId: 7n,
      loaded: [],
      failed: [{ kind: 'round', key: '3' }],
      notOnTab: [],
    });
    // Recorded, so the piece's attempts and back-off advance.
    expect(h.recordPieceOutcomes).toHaveBeenCalledTimes(1);
    expect(h.recordPieceOutcomes.mock.calls[0]![0]).toBe(7n);
    expect(h.recordPieceOutcomes.mock.calls[0]![1]).toEqual([
      expect.objectContaining({ kind: 'round', key: '3', ok: false, httpStatus: 504 }),
    ]);
    expect(prismaMock.tournament.upsert).not.toHaveBeenCalled();
    expect(allDeletes()).toEqual([]);
  });

  it('speaker piece leaves teamBreakRank untouched', async () => {
    install();
    await rescrapePieces(7n, [{ kind: 'speaker', key: '' }]);

    const upserts = callsOf(prismaMock.tournamentParticipant.upsert);
    expect(upserts.length).toBeGreaterThan(0);
    for (const u of upserts) {
      expect(u.update).toHaveProperty('teamBreakRank', undefined);
    }
  });

  it('an empty break parse deletes nothing', async () => {
    install();
    h.breakRows = [];
    await rescrapePieces(7n, [{ kind: 'break', key: 'open' }]);

    expect(prismaMock.eliminationResult.deleteMany).not.toHaveBeenCalled();
  });

  it('does not stamp the tournament current or fresh', async () => {
    install();
    await rescrapePieces(7n, [{ kind: 'round', key: '3' }]);

    const update = callsOf(prismaMock.tournament.upsert)[0]!.update;
    expect(update.parserVersion).toBeUndefined();
    expect(update.scrapedAt).toBeUndefined();
    expect(update.scrapeClaimedAt).toBeNull();
  });
});
