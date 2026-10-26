import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Characterization tests for ingestPrivateUrl (lib/calicotab/ingest.ts): they
 * pin what one ingest writes for a small made-up tournament, and which cache
 * / skip decision it takes, so that splitting ingest.ts (docs/OPUS_TASKS.md
 * Q1 phase 3) can be checked against unchanged behaviour. They describe the
 * code as it is, not as it should be; anything that looked odd is recorded in
 * the PR rather than changed.
 *
 * The seams mocked are the I/O ones only: the database (the shared prisma
 * mock), the network (lib/calicotab/fetch), the HTML parsers (each returns a
 * fixed parsed shape, so no HTML is involved), provenance writes and Sentry.
 * Everything between — fingerprinting, the freshness and regression checks,
 * person matching, primary-team choice, round numbering, break resolution,
 * the transaction body — is the real code.
 *
 * Tabbycat's REST API is switched off (TABBYCAT_API_TABS=0) so every tab
 * comes through the HTML path; the API has its own suites.
 */

const BASE = 'https://oxiv.calicotab.com/oxiv2025/';
const PRIVATE_URL = `${BASE}privateurls/abc123/`;
const R1 = `${BASE}results/round/1/`;
const R2 = `${BASE}results/round/2/`;
const GF = `${BASE}results/round/3/`;
const TEAM_TAB = `${BASE}tab/team/`;
const SPEAKER_TAB = `${BASE}tab/speaker/`;
const MOTIONS_TAB = `${BASE}motions/`;
const BREAK_TAB = `${BASE}break/teams/open/`;
const PARTICIPANTS = `${BASE}participants/list/`;

const h = vi.hoisted(() => ({
  fetchHtml: vi.fn(),
  fetchRound: vi.fn(),
  recordParserRun: vi.fn(),
  captureMessage: vi.fn(),
  // Per-test replacement for the speaker tab parse (null: the default rows).
  speakerTab: null as unknown[] | null,
}));

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));
vi.mock('@sentry/nextjs', () => ({ captureMessage: h.captureMessage, captureException: vi.fn() }));
vi.mock('@/lib/calicotab/provenance', () => ({
  recordParserRun: h.recordParserRun,
  collectRegistrationWarnings: () => [],
}));
vi.mock('@/lib/calicotab/fetch', () => ({
  FETCH_MIN_INTERVAL_MS: 0,
  fetchHtmlWithProvenance: h.fetchHtml,
  fetchRoundWithProvenance: h.fetchRound,
  isCdnRateLimit: () => false,
  isWithheldByTournament: (r: { status: number; cdnBlocked?: boolean }) =>
    r.status === 404 || (r.status === 403 && r.cdnBlocked === false),
  withApiSnapshots: <T,>(f: T) => f,
}));

const SNAPSHOT = {
  sourceUrl: PRIVATE_URL,
  tournamentName: 'Oxford IV 2025',
  navigation: {
    home: BASE,
    teamTab: TEAM_TAB,
    speakerTab: SPEAKER_TAB,
    motionsTab: MOTIONS_TAB,
    resultsRounds: [R1, R2, GF],
    resultsRoundLabels: { [R1]: 'Round 1', [R2]: 'Round 2', [GF]: 'Grand Final' },
    breakTabs: [BREAK_TAB],
    participants: PARTICIPANTS,
    institutions: null,
    meta: { discovered: ['teamTab', 'speakerTab', 'resultsRounds'], constructed: [] as string[] },
  },
  registration: {
    personName: 'Ada Lovelace',
    teamName: 'Oxford A',
    speakers: ['Ada Lovelace', 'Grace Hopper'],
    institution: 'Oxford',
  },
};

vi.mock('@/lib/calicotab/parseNav', () => ({
  parsePrivateUrlPage: () => structuredClone(SNAPSHOT),
  extractAdjudicatorRounds: () => [],
  extractSpeakerRounds: () => [],
}));

const ROUNDS: Record<string, unknown> = {
  [R1]: {
    roundLabel: 'Round 1',
    isOutround: false,
    roundNumber: 1,
    teamResults: [
      { teamName: 'Oxford A', position: 'OG', points: 3, won: true },
      { teamName: 'Cambridge A', position: 'OO', points: 0, won: false },
    ],
    judgeAssignments: [{ personName: 'Judge Judy', panelRole: 'chair' }],
  },
  [R2]: {
    roundLabel: 'Round 2',
    isOutround: false,
    roundNumber: 2,
    teamResults: [
      { teamName: 'Oxford A', position: 'CO', points: 2, won: null },
      { teamName: 'Cambridge A', position: 'CG', points: 1, won: null },
    ],
    judgeAssignments: [{ personName: 'Judge Judy', panelRole: 'chair' }],
  },
  [GF]: {
    roundLabel: 'Grand Final',
    isOutround: true,
    roundNumber: null,
    teamResults: [
      { teamName: 'Oxford A', position: 'OG', points: null, won: true },
      { teamName: 'Cambridge A', position: 'OO', points: null, won: false },
    ],
    judgeAssignments: [],
  },
};

vi.mock('@/lib/calicotab/parseTabs', () => ({
  parseTeamTab: () => [
    { rank: 1, teamName: 'Oxford A', institution: 'Oxford', speakers: ['Ada Lovelace', 'Grace Hopper'], wins: null, totalPoints: 5, firsts: 1, seconds: 1 },
    { rank: 2, teamName: 'Cambridge A', institution: 'Cambridge', speakers: ['Alan Turing', 'Speaker 1'], wins: null, totalPoints: 1, firsts: 0, seconds: 0 },
  ],
  parseSpeakerTab: () => h.speakerTab ? structuredClone(h.speakerTab) : [
    {
      rank: 1, rankEsl: null, rankEfl: null, categories: ['ESL'],
      speakerName: 'Grace Hopper', teamName: 'Oxford A', institution: 'Oxford', totalScore: 160,
      roundScores: [
        { roundLabel: 'R1', score: 80, positionLabel: 'DPM' },
        { roundLabel: 'R2', score: 80, positionLabel: 'MO' },
      ],
    },
    {
      rank: 2, rankEsl: null, rankEfl: null, categories: [],
      speakerName: 'Ada Lovelace', teamName: 'Oxford A', institution: 'Oxford', totalScore: 155,
      roundScores: [
        { roundLabel: 'R1', score: 77, positionLabel: 'PM' },
        { roundLabel: 'R2', score: 78, positionLabel: 'LO' },
        { roundLabel: 'Avg', score: 77.5, positionLabel: 'average' },
      ],
    },
    {
      rank: 3, rankEsl: null, rankEfl: null, categories: [],
      speakerName: 'Alan Turing', teamName: 'Cambridge A', institution: 'Cambridge', totalScore: 150,
      roundScores: [
        { roundLabel: 'R1', score: 75, positionLabel: 'LO' },
        { roundLabel: 'R2', score: null, positionLabel: null },
      ],
    },
    // A stand-in, not a person: never attributed.
    {
      rank: 4, rankEsl: null, rankEfl: null, categories: [],
      speakerName: 'Speaker 1', teamName: 'Cambridge A', institution: null, totalScore: 140,
      roundScores: [],
    },
  ],
  parseRoundResults: (_html: string, url: string) => structuredClone(ROUNDS[url]),
  parseBreakPage: () => [
    { rank: 1, entityType: 'team', entityName: 'Oxford A', institution: 'Oxford', score: 5, stage: 'Open' },
    { rank: 2, entityType: 'team', entityName: 'Cambridge A', institution: 'Cambridge', score: 1, stage: 'Open' },
  ],
  parseParticipantsList: (html: string) =>
    html.includes('participants')
      ? [
          { name: 'Ada Lovelace', role: 'speaker', judgeTag: null, teamName: 'Oxford A', institution: 'Oxford' },
          { name: 'Judge Judy', role: 'adjudicator', judgeTag: 'invited', teamName: null, institution: null },
        ]
      : [],
  diagnoseVueData: () => 'diagnosis',
}));

vi.mock('@/lib/calicotab/parseMotions', () => ({
  parseMotionsTab: () => [
    { roundNumber: 1, roundLabel: 'Round 1', text: 'THW ban zoos', infoSlide: null, seq: 0 },
    { roundNumber: null, roundLabel: 'Grand Final', text: 'THR the rise of AI', infoSlide: 'Info', seq: 1 },
  ],
}));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { ingestPrivateUrl } from '@/lib/calicotab/ingest';
import { computeFingerprint, normalizePersonName } from '@/lib/calicotab/fingerprint';
import { PARSER_VERSION } from '@/lib/calicotab/version';

const USER = 'user-1';
const FINGERPRINT = computeFingerprint({
  host: 'oxiv.calicotab.com',
  tournamentSlug: 'oxiv2025',
  tournamentName: 'Oxford IV 2025',
  year: 2025,
});

// Person ids handed out by the pre-commit upsert, by normalised name.
const PERSON_IDS: Record<string, bigint> = {
  [normalizePersonName('Ada Lovelace')]: 101n,
  [normalizePersonName('Alan Turing')]: 102n,
  [normalizePersonName('Grace Hopper')]: 103n,
  [normalizePersonName('Judge Judy')]: 104n,
};

type Existing = {
  id: bigint;
  fingerprint: string;
  scrapedAt: Date;
  parserVersion: string | null;
  totalTeams: number | null;
  totalParticipants: number | null;
  year: number | null;
};

function existingTournament(over: Partial<Existing> = {}): Existing {
  return {
    id: 7n,
    fingerprint: FINGERPRINT,
    scrapedAt: new Date('2025-03-01T00:00:00Z'),
    parserVersion: PARSER_VERSION,
    totalTeams: 2,
    totalParticipants: 4,
    year: 2025,
    ...over,
  };
}

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

/**
 * Wire the database for one scenario. `stored` describes what the database
 * already holds for an existing tournament: how many distinct prelim rounds,
 * and whether the team / speaker tabs are on record.
 */
function install(opts: {
  existing?: Existing | null;
  stored?: { rounds: number; teamTab: boolean; speakerTab: boolean };
  claimed?: boolean;
} = {}) {
  const existing = opts.existing ?? null;
  const stored = opts.stored ?? { rounds: 3, teamTab: true, speakerTab: true };
  let participantId = 500n;

  h.fetchHtml.mockImplementation(async (url: string) => okPage(url));
  h.fetchRound.mockImplementation(async (url: string) => okPage(url));
  h.recordParserRun.mockResolvedValue(undefined);

  prismaMock.discoveredUrl.findFirst.mockResolvedValue({ messageDate: new Date('2025-02-01T00:00:00Z') });
  prismaMock.discoveredUrl.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.tournament.findUnique.mockResolvedValue(existing);
  prismaMock.tournament.findMany.mockResolvedValue([]);
  prismaMock.tournament.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.tournament.upsert.mockImplementation(async () => ({ id: existing?.id ?? 1n }));
  prismaMock.teamResult.findMany.mockResolvedValue(
    Array.from({ length: stored.rounds }, (_, i) => ({ roundNumber: i + 1 })),
  );
  prismaMock.teamResult.findFirst.mockResolvedValue(stored.teamTab ? { id: 1n } : null);
  prismaMock.tournamentParticipant.findFirst.mockResolvedValue(stored.speakerTab ? { id: 1n } : null);
  prismaMock.tournamentParticipant.count.mockResolvedValue(0);
  prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);
  prismaMock.tournamentParticipant.upsert.mockImplementation(async () => ({ id: participantId++ }));
  prismaMock.judgeAssignment.findMany.mockResolvedValue([]);
  prismaMock.person.findMany.mockResolvedValue([]);
  prismaMock.person.findFirst.mockResolvedValue(opts.claimed === false ? null : { id: 101n });
  prismaMock.parserRun.findFirst.mockResolvedValue({ parserVersion: PARSER_VERSION });

  prismaMock.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('"claimedByUserId")')) {
      // linkRegistrationPerson's claim-aware upsert.
      const claim = values[2] as string | null;
      return [{ id: PERSON_IDS[values[1] as string] ?? 999n, claimedByUserId: claim }];
    }
    if (sql.includes('INSERT INTO "Person"')) {
      // preCommitPersons
      const id = PERSON_IDS[values[1] as string];
      return id ? [{ id }] : [];
    }
    return [];
  });
  prismaMock.$executeRaw.mockResolvedValue(0);
}

const callsOf = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => c[0] as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any

let savedApiTabs: string | undefined;
let savedApiRounds: string | undefined;
beforeAll(() => {
  savedApiTabs = process.env.TABBYCAT_API_TABS;
  savedApiRounds = process.env.TABBYCAT_API_ROUNDS;
  process.env.TABBYCAT_API_TABS = '0';
  delete process.env.TABBYCAT_API_ROUNDS;
});
afterAll(() => {
  if (savedApiTabs === undefined) delete process.env.TABBYCAT_API_TABS;
  else process.env.TABBYCAT_API_TABS = savedApiTabs;
  if (savedApiRounds !== undefined) process.env.TABBYCAT_API_ROUNDS = savedApiRounds;
});

beforeEach(() => {
  resetPrismaMock();
  h.fetchHtml.mockReset();
  h.fetchRound.mockReset();
  h.recordParserRun.mockReset();
  h.captureMessage.mockReset();
  h.speakerTab = null;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── What one first-time ingest writes ──────────────────────────────────────

describe('ingestPrivateUrl: first ingest of a tournament (no stored row)', () => {
  it('returns an uncached result with the tab counts', async () => {
    install();
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result).toEqual({
      tournamentId: 1n,
      fingerprint: FINGERPRINT,
      cached: false,
      claimedPersonId: 101n,
      claimedPersonName: 'Ada Lovelace',
      parserVersion: PARSER_VERSION,
      totalTeams: 2,
      // Merged participants list (Ada + Judge Judy), not the 4 speaker rows.
      totalParticipants: 2,
      warnings: [],
    });
  });

  it('fetches the landing page, every linked tab and every results round', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(h.fetchHtml.mock.calls.map((c) => c[0]).sort()).toEqual(
      [PRIVATE_URL, TEAM_TAB, SPEAKER_TAB, PARTICIPANTS, MOTIONS_TAB, BREAK_TAB].sort(),
    );
    expect(h.fetchRound.mock.calls.map((c) => c[0])).toEqual([R1, R2, GF]);
    // No scrape claim to take without a stored row.
    expect(prismaMock.tournament.updateMany).not.toHaveBeenCalled();
  });

  it('upserts the tournament by fingerprint, storing only the public URL', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(prismaMock.tournament.upsert).toHaveBeenCalledTimes(1);
    const args = callsOf(prismaMock.tournament.upsert)[0]!;
    expect(args.where).toEqual({ fingerprint: FINGERPRINT });
    expect(args.create).toEqual({
      name: 'Oxford IV 2025',
      format: expect.anything(),
      year: 2025,
      totalParticipants: 2,
      totalTeams: 2,
      // Two parsed prelims; the Grand Final is an outround.
      prelimRoundCount: 2,
      sourceUrlRaw: BASE,
      fingerprint: FINGERPRINT,
      parserVersion: PARSER_VERSION,
    });
    expect(args.update).toMatchObject({
      name: 'Oxford IV 2025',
      year: 2025,
      totalParticipants: 2,
      totalTeams: 2,
      prelimRoundCount: 2,
      sourceUrlRaw: BASE,
      scrapedAt: expect.any(Date),
      parserVersion: PARSER_VERSION,
      scrapeClaimedAt: null,
    });
    expect(args.create.format).toBe(args.update.format);
  });

  it('takes the per-fingerprint advisory lock inside the transaction, with the live timeout', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    const lockCall = prismaMock.$executeRaw.mock.calls.find((c) => (c[0] as string[]).join('').includes('pg_advisory_xact_lock'));
    expect(lockCall?.[1]).toBe(BigInt(`0x${FINGERPRINT.slice(0, 15)}`));
    const txWithOptions = prismaMock.$transaction.mock.calls.find((c) => typeof c[0] === 'function' && c[1]);
    expect(txWithOptions?.[1]).toEqual({ maxWait: 10000, timeout: 45_000 });
  });

  it('does not run the tournament-wide refresh for a brand-new tournament', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(prismaMock.eliminationResult.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.teamResult.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.tournamentParticipant.deleteMany).not.toHaveBeenCalled();
  });

  it('writes team standings (round 0) and prelim team results, but no outround rows', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    const rows = callsOf(prismaMock.teamResult.upsert).map((a) => a.create);
    expect(rows).toEqual([
      { tournamentId: 1n, teamName: 'Oxford A', roundNumber: 0, rank: 1, wins: null, points: 5, firsts: 1, seconds: 1 },
      { tournamentId: 1n, teamName: 'Cambridge A', roundNumber: 0, rank: 2, wins: null, points: 1, firsts: 0, seconds: 0 },
      { tournamentId: 1n, teamName: 'Oxford A', roundNumber: 1, points: 3, wins: 1, position: 'OG' },
      { tournamentId: 1n, teamName: 'Cambridge A', roundNumber: 1, points: 0, wins: 0, position: 'OO' },
      { tournamentId: 1n, teamName: 'Oxford A', roundNumber: 2, points: 2, wins: null, position: 'CO' },
      { tournamentId: 1n, teamName: 'Cambridge A', roundNumber: 2, points: 1, wins: null, position: 'CG' },
    ]);
  });

  it('writes outround win/loss and break-tab rows as EliminationResults', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    const rows = callsOf(prismaMock.eliminationResult.upsert);
    expect(rows.map((a) => a.create)).toEqual([
      { tournamentId: 1n, stage: 'Grand Final', entityType: 'team', entityName: 'Oxford A', result: 'won' },
      { tournamentId: 1n, stage: 'Grand Final', entityType: 'team', entityName: 'Cambridge A', result: 'lost' },
      { tournamentId: 1n, stage: 'Open', entityType: 'team', entityName: 'Oxford A' },
      { tournamentId: 1n, stage: 'Open', entityType: 'team', entityName: 'Cambridge A' },
    ]);
    // Break rows never overwrite a won/lost result on the same key.
    expect(rows[2]!.update).toEqual({});
    expect(rows[0]!.update).toEqual({ result: 'won' });
  });

  it('upserts motions keyed on (round label, seq) and deletes only motions absent from the parse', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(callsOf(prismaMock.motion.upsert).map((a) => a.create)).toEqual([
      { tournamentId: 1n, roundNumber: 1, roundLabel: 'Round 1', seq: 0, text: 'THW ban zoos', infoSlide: null },
      { tournamentId: 1n, roundNumber: null, roundLabel: 'Grand Final', seq: 1, text: 'THR the rise of AI', infoSlide: 'Info' },
    ]);
    expect(prismaMock.motion.deleteMany).toHaveBeenCalledWith({
      where: {
        tournamentId: 1n,
        NOT: { OR: [{ roundLabel: 'Round 1', seq: 0 }, { roundLabel: 'Grand Final', seq: 1 }] },
      },
    });
  });

  it('pre-commits every real person (sorted by normalised name) and skips the stand-in', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    const precommitted = prismaMock.$queryRaw.mock.calls
      .filter((c) => (c[0] as string[]).join('?').includes('INSERT INTO "Person"') && !(c[0] as string[]).join('?').includes('"claimedByUserId")'))
      .map((c) => c[2]);
    expect(precommitted).toEqual(['ada lovelace', 'alan turing', 'grace hopper', 'judge judy'].map(normalizePersonName));
  });

  it('writes a participant per matched speaker and per adjudicator, with their roles', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    const creates = callsOf(prismaMock.tournamentParticipant.upsert).map((a) => a.create);
    expect(creates).toEqual([
      { tournamentId: 1n, personId: 103n, teamName: 'Oxford A', speakerScoreTotal: 160, speakerRankOpen: 1, speakerRankEsl: null, speakerRankEfl: null, speakerCategories: ['ESL'], teamBreakRank: 1 },
      { tournamentId: 1n, personId: 101n, teamName: 'Oxford A', speakerScoreTotal: 155, speakerRankOpen: 2, speakerRankEsl: null, speakerRankEfl: null, speakerCategories: [], teamBreakRank: 1 },
      { tournamentId: 1n, personId: 102n, teamName: 'Cambridge A', speakerScoreTotal: 150, speakerRankOpen: 3, speakerRankEsl: null, speakerRankEfl: null, speakerCategories: [], teamBreakRank: 2 },
      // Adjudicator roster from the participants list.
      { tournamentId: 1n, personId: 104n, teamName: null, judgeTypeTag: 'invited' },
      // linkRegistrationPerson after the transaction.
      { tournamentId: 1n, personId: 101n },
    ]);
    const roles = callsOf(prismaMock.participantRole.upsert).map((a) => a.create);
    expect(roles).toEqual([
      { tournamentParticipantId: 500n, role: 'speaker' },
      { tournamentParticipantId: 501n, role: 'speaker' },
      { tournamentParticipantId: 502n, role: 'speaker' },
      { tournamentParticipantId: 503n, role: 'judge' },
    ]);
    // The derived-rank ROW_NUMBER update runs once, scoped to this tournament.
    const derived = prismaMock.$executeRaw.mock.calls.filter((c) => (c[0] as string[]).join('').includes('speakerRankOpenDerived'));
    expect(derived).toHaveLength(1);
    expect(derived[0]![1]).toBe(1n);
  });

  it('bulk-writes speaker round scores after the transaction, mapping score columns to rounds', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(prismaMock.speakerRoundScore.deleteMany).toHaveBeenCalledWith({
      where: { tournamentParticipantId: { in: [500n, 501n, 502n] } },
    });
    expect(prismaMock.speakerRoundScore.createMany).toHaveBeenCalledWith({
      data: [
        { tournamentParticipantId: 500n, roundNumber: 1, positionLabel: 'DPM', score: 80 },
        { tournamentParticipantId: 500n, roundNumber: 2, positionLabel: 'MO', score: 80 },
        { tournamentParticipantId: 501n, roundNumber: 1, positionLabel: 'PM', score: 77 },
        { tournamentParticipantId: 501n, roundNumber: 2, positionLabel: 'LO', score: 78 },
        // The average column is stored as round 0.
        { tournamentParticipantId: 501n, roundNumber: 0, positionLabel: 'average', score: 77.5 },
        { tournamentParticipantId: 502n, roundNumber: 1, positionLabel: 'LO', score: 75 },
        // A blank cell is still written, with an empty position label.
        // Intended: every score consumer filters score != null (see the
        // comment at the write in ingest.ts), so it never counts as a speech.
        { tournamentParticipantId: 502n, roundNumber: 2, positionLabel: '', score: null },
      ],
      skipDuplicates: true,
    });
  });

  it('links the registration person, claims only a confirmed alias, and marks the URL ingested', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(prismaMock.person.findFirst).toHaveBeenCalledWith({
      where: { claimedByUserId: USER, normalizedName: normalizePersonName('Ada Lovelace') },
      select: { id: true },
    });
    const updates = callsOf(prismaMock.discoveredUrl.updateMany);
    expect(updates).toEqual([
      { where: { userId: USER, url: { in: [PRIVATE_URL] } }, data: { registrationPersonId: 101n, registrationName: 'Ada Lovelace' } },
      { where: { userId: USER, url: { in: [PRIVATE_URL] } }, data: { tournamentId: 1n, ingestedAt: expect.any(Date) } },
    ]);
    // Speaker registration with no Debates-card outrounds: eliminationReached cleared.
    expect(prismaMock.tournamentParticipant.update).toHaveBeenCalledWith({
      where: { tournamentId_personId: { tournamentId: 1n, personId: 101n } },
      data: { eliminationReached: null },
    });
    // A speaker registration skips the round-results panel search.
    expect(prismaMock.judgeAssignment.createMany).not.toHaveBeenCalled();
  });

  it('an unconfirmed name is linked but not claimed', async () => {
    install({ claimed: false });
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result.claimedPersonId).toBeNull();
    expect(result.claimedPersonName).toBeNull();
  });

  it('records one pipeline ParserRun for the landing document with every warning', async () => {
    install();
    await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(h.recordParserRun).toHaveBeenCalledTimes(1);
    expect(h.recordParserRun.mock.calls[0]![0]).toMatchObject({
      sourceDocumentId: `doc:${PRIVATE_URL}`,
      parserName: 'parseNav',
      success: true,
      warnings: [],
    });
  });
});

// ─── Freshness and skip decisions on a stored tournament ───────────────────

describe('ingestPrivateUrl: cache decisions for a stored tournament', () => {
  it('serves a fresh, complete, current-version tournament from the cache without fetching tabs', async () => {
    const existing = existingTournament();
    install({ existing });
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result).toEqual({
      tournamentId: 7n,
      fingerprint: FINGERPRINT,
      cached: true,
      claimedPersonId: 101n,
      claimedPersonName: 'Ada Lovelace',
      parserVersion: PARSER_VERSION,
      totalTeams: 2,
      totalParticipants: 4,
      warnings: [],
    });
    expect(h.fetchHtml.mock.calls.map((c) => c[0])).toEqual([PRIVATE_URL]);
    expect(h.fetchRound).not.toHaveBeenCalled();
    expect(prismaMock.tournament.upsert).not.toHaveBeenCalled();
    expect(prismaMock.tournament.updateMany).not.toHaveBeenCalled();
    // Stored-rounds check counts distinct prelim rounds.
    expect(prismaMock.teamResult.findMany).toHaveBeenCalledWith({
      where: { tournamentId: 7n, roundNumber: { gt: 0 } },
      select: { roundNumber: true },
      distinct: ['roundNumber'],
    });
    expect(callsOf(prismaMock.discoveredUrl.updateMany).at(-1)).toEqual({
      where: { userId: USER, url: { in: [PRIVATE_URL] } },
      data: { tournamentId: 7n, ingestedAt: expect.any(Date) },
    });
    expect(h.recordParserRun).toHaveBeenCalledWith(expect.objectContaining({ parserName: 'parseNav', success: true }));
  });

  it('a stored row with no parserVersion falls back to the landing document’s latest ParserRun', async () => {
    install({ existing: existingTournament({ parserVersion: null }) });
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result.cached).toBe(true);
    expect(prismaMock.parserRun.findFirst).toHaveBeenCalledWith({
      where: { sourceDocumentId: `doc:${PRIVATE_URL}`, success: true },
      orderBy: { createdAt: 'desc' },
      select: { parserVersion: true },
    });
  });

  // Every case below must re-scrape: cached false, the tournament upserted,
  // and (with a stored row) the scrape claim taken first.
  const misses: Array<[string, Parameters<typeof install>[0], { force?: boolean }]> = [
    ['force: true', { existing: existingTournament() }, { force: true }],
    ['Re-ingest all’s epoch scrapedAt (storedTournamentFresh false)', { existing: existingTournament({ scrapedAt: new Date(0) }) }, {}],
    ['an older parserVersion on the row', { existing: existingTournament({ parserVersion: '19990101.0' }) }, {}],
    ['no parserVersion and an older latest ParserRun', { existing: existingTournament({ parserVersion: null }) }, {}],
    ['nav lists more results rounds than are stored', { existing: existingTournament(), stored: { rounds: 2, teamTab: true, speakerTab: true } }, {}],
    ['team tab linked but no round-0 standings stored (releasedTabMissing)', { existing: existingTournament(), stored: { rounds: 3, teamTab: false, speakerTab: true } }, {}],
    ['speaker tab linked but no speaker totals stored (releasedTabMissing)', { existing: existingTournament(), stored: { rounds: 3, teamTab: true, speakerTab: false } }, {}],
  ];

  it.each(misses)('re-scrapes on %s', async (label, scenario, options) => {
    install(scenario);
    if (label.startsWith('no parserVersion')) {
      prismaMock.parserRun.findFirst.mockResolvedValue({ parserVersion: '19990101.0' });
    }
    const result = await ingestPrivateUrl(PRIVATE_URL, USER, options);
    expect(result.cached).toBe(false);
    expect(result.tournamentId).toBe(7n);
    expect(prismaMock.tournament.upsert).toHaveBeenCalledTimes(1);
    expect(h.fetchRound).toHaveBeenCalledTimes(3);
    // The scrape claim on the stored row, taken before fetching tabs.
    expect(callsOf(prismaMock.tournament.updateMany)[0]).toMatchObject({
      where: { id: 7n },
      data: { scrapeClaimedAt: expect.any(Date) },
    });
  });

  it('a re-scrape of a stored tournament with no fetch warnings runs the tournament-wide refresh', async () => {
    install({ existing: existingTournament({ scrapedAt: new Date(0) }) });
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([{ id: 900n, personId: 101n }]);
    prismaMock.judgeAssignment.findMany.mockResolvedValue([{ personId: 104n }]);
    await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(prismaMock.eliminationResult.deleteMany).toHaveBeenCalledWith({ where: { tournamentId: 7n } });
    expect(prismaMock.teamResult.deleteMany).toHaveBeenCalledWith({ where: { tournamentId: 7n } });
    expect(prismaMock.speakerRoundScore.deleteMany).toHaveBeenCalledWith({ where: { tournamentParticipantId: { in: [900n] } } });
    expect(prismaMock.participantRole.deleteMany).toHaveBeenCalledWith({ where: { tournamentParticipantId: { in: [900n] } } });
    // Unclaimed participants go, except people with private judging history.
    expect(prismaMock.tournamentParticipant.deleteMany).toHaveBeenCalledWith({
      where: { tournamentId: 7n, person: { claimedByUserId: null }, personId: { notIn: [104n] } },
    });
  });

  it('the regression guard serves the stored row when a re-scrape would halve the teams', async () => {
    install({ existing: existingTournament({ scrapedAt: new Date(0), totalTeams: 40, totalParticipants: 4 }) });
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result).toMatchObject({
      tournamentId: 7n,
      cached: true,
      totalTeams: 40,
      warnings: ['regression-guard: overwrite blocked'],
    });
    expect(prismaMock.tournament.upsert).not.toHaveBeenCalled();
    expect(h.captureMessage).toHaveBeenCalledWith(
      // Ranks count people a rank would be written for: the three real
      // speakers, not the "Speaker 1" stand-in, whose row is never written
      // (it used to read 0→4).
      'Regression guard: re-ingest would drop data — teams 40→2, participants 4→2, ranks 0→3',
      expect.objectContaining({ level: 'warning' }),
    );
    // The URL is still linked and marked ingested.
    expect(callsOf(prismaMock.discoveredUrl.updateMany).at(-1)).toMatchObject({
      data: { tournamentId: 7n, ingestedAt: expect.any(Date) },
    });
  });

  it('force: true bypasses the regression guard', async () => {
    install({ existing: existingTournament({ totalTeams: 40 }) });
    const result = await ingestPrivateUrl(PRIVATE_URL, USER, { force: true });
    expect(result.cached).toBe(false);
    expect(prismaMock.tournament.upsert).toHaveBeenCalledTimes(1);
  });

  it('a failed tab fetch aborts before writing and releases the scrape claim', async () => {
    install({ existing: existingTournament({ scrapedAt: new Date(0) }) });
    h.fetchHtml.mockImplementation(async (url: string) =>
      url === SPEAKER_TAB
        ? { ok: false, url, status: 503, bodyPreview: '', elapsedMs: 1 }
        : okPage(url),
    );
    await expect(ingestPrivateUrl(PRIVATE_URL, USER)).rejects.toThrow(
      'Aborting ingest: 1 tab fetch(es) failed — fetch: speakerTab HTTP 503',
    );
    expect(prismaMock.tournament.upsert).not.toHaveBeenCalled();
    expect(callsOf(prismaMock.tournament.updateMany).at(-1)).toEqual({
      where: { id: 7n },
      data: { scrapeClaimedAt: null },
    });
    // The failure is still recorded on the landing ParserRun.
    expect(h.recordParserRun.mock.calls[0]![0]).toMatchObject({ success: false, warnings: ['fetch: speakerTab HTTP 503'] });
  });

  it('a withheld participants page is optional on a first ingest and does not abort', async () => {
    install();
    h.fetchHtml.mockImplementation(async (url: string) =>
      url === PARTICIPANTS
        ? { ok: false, url, status: 403, cdnBlocked: false, bodyPreview: '', elapsedMs: 1 }
        : okPage(url),
    );
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result.cached).toBe(false);
    expect(result.warnings).toEqual(['optional: participants HTTP 403 (not public for this tournament)']);
    // Without the participants list the count falls back to the speaker rows.
    expect(result.totalParticipants).toBe(4);
  });

  it('refuses a URL that is not a private URL before touching the network', async () => {
    install();
    await expect(ingestPrivateUrl(`${BASE}tab/team/`, USER)).rejects.toThrow('refusing to fetch non-private URL');
    expect(h.fetchHtml).not.toHaveBeenCalled();
  });
});

// ─── Regression tests for the oddities phase 2 pinned (fixed afterwards) ───

describe('ingestPrivateUrl: regression guard compares like with like', () => {
  const guardMsg = (s: string) => expect.stringContaining(s);

  it('a stand-in rank does not prop up the new rank count', async () => {
    // Seven ranked participants stored; the parse has three real ranked
    // speakers plus "Speaker 1". Counting the stand-in (4 >= 3.5) let the
    // overwrite through; three people is a real drop.
    install({ existing: existingTournament({ scrapedAt: new Date(0) }) });
    prismaMock.tournamentParticipant.count.mockResolvedValue(7);
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result.cached).toBe(true);
    expect(result.warnings).toContain('regression-guard: overwrite blocked');
    expect(h.captureMessage).toHaveBeenCalledWith(guardMsg('ranks 7→3'), expect.anything());
  });

  it('a stand-in somebody has claimed is written, so its rank does count', async () => {
    install({ existing: existingTournament({ scrapedAt: new Date(0) }) });
    prismaMock.tournamentParticipant.count.mockResolvedValue(7);
    prismaMock.person.findMany.mockResolvedValue([{ normalizedName: normalizePersonName('Speaker 1') }]);
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result.cached).toBe(false);
    expect(h.captureMessage).not.toHaveBeenCalled();
  });

  it('an iron-man’s two rows count as one ranked person', async () => {
    install({ existing: existingTournament({ scrapedAt: new Date(0) }) });
    prismaMock.tournamentParticipant.count.mockResolvedValue(6);
    const row = (name: string, team: string, rank: number) => ({
      rank, rankEsl: null, rankEfl: null, categories: [], speakerName: name, teamName: team,
      institution: null, totalScore: 150, roundScores: [{ roundLabel: 'R1', score: 75, positionLabel: 'PM' }],
    });
    // Two people over three rows: 2 < 3, blocked. Counted per row it was 3 >= 3.
    h.speakerTab = [row('Ada Lovelace', 'Oxford A', 1), row('Ada Lovelace', 'Cambridge A', 2), row('Grace Hopper', 'Oxford A', 3)];
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result.cached).toBe(true);
    expect(h.captureMessage).toHaveBeenCalledWith(guardMsg('ranks 6→2'), expect.anything());
  });

  it('an empty participants list does not compare speaker rows with a stored list count', async () => {
    // Stored 40 came from the participants list (speakers and judges). This
    // time the page loads but yields no rows, so the new figure is the 4
    // speaker rows: a different source, not a drop. Teams and ranks are
    // intact; proceed. (A withheld page on a stored tournament aborts before
    // the guard — see fetchTab — so an empty parse is how this arises.)
    install({ existing: existingTournament({ scrapedAt: new Date(0), totalParticipants: 40 }) });
    h.fetchHtml.mockImplementation(async (url: string) =>
      url === PARTICIPANTS ? { ...okPage(url), html: '<html>no rows</html>' } : okPage(url),
    );
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result.cached).toBe(false);
    expect(result.totalParticipants).toBe(4);
    expect(prismaMock.tournament.upsert).toHaveBeenCalledTimes(1);
  });

  it('a participants list that loads but collapses is still blocked', async () => {
    install({ existing: existingTournament({ scrapedAt: new Date(0), totalParticipants: 40 }) });
    const result = await ingestPrivateUrl(PRIVATE_URL, USER);
    expect(result.cached).toBe(true);
    expect(h.captureMessage).toHaveBeenCalledWith(guardMsg('participants 40→2'), expect.anything());
  });
});

describe('ingestPrivateUrl: an iron-man’s teamBreakRank', () => {
  it('create and update both carry the primary team’s break rank', async () => {
    install();
    // Grace's first row is a one-round substitution for Cambridge A (break
    // rank 2); her primary team is Oxford A (two scored rounds, rank 1). The
    // create used to take the row's own team (2) while teamName said Oxford A.
    h.speakerTab = [
      {
        rank: 1, rankEsl: null, rankEfl: null, categories: [], speakerName: 'Grace Hopper', teamName: 'Cambridge A',
        institution: null, totalScore: 80,
        roundScores: [{ roundLabel: 'R1', score: 80, positionLabel: 'PM' }, { roundLabel: 'R2', score: null, positionLabel: null }],
      },
      {
        rank: 1, rankEsl: null, rankEfl: null, categories: [], speakerName: 'Grace Hopper', teamName: 'Oxford A',
        institution: null, totalScore: 160,
        roundScores: [{ roundLabel: 'R1', score: 80, positionLabel: 'PM' }, { roundLabel: 'R2', score: 80, positionLabel: 'MO' }],
      },
    ];
    await ingestPrivateUrl(PRIVATE_URL, USER);
    const grace = callsOf(prismaMock.tournamentParticipant.upsert).filter((a) => a.create.personId === 103n);
    expect(grace).toHaveLength(2);
    for (const call of grace) {
      expect(call.create).toMatchObject({ teamName: 'Oxford A', teamBreakRank: 1 });
      expect(call.update).toMatchObject({ teamName: 'Oxford A', teamBreakRank: 1 });
    }
  });
});
