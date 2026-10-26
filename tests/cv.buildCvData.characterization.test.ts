import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { buildCvData } from '@/lib/cv/buildCvData';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';

/**
 * Characterization tests for buildCvData: they pin what the function returns
 * TODAY for a small, made-up record, so that splitting the ~940-line
 * function into modules (docs/OPUS_TASKS.md Q1 phase 3) can be checked
 * against an unchanged result. They are not a statement that every value
 * below is right; where something looked odd it is recorded in the PR, not
 * changed here.
 *
 * Deliberately NOT asserted, because another change is reworking them
 * concurrently (team-rank placement, top breaks, field placement):
 *   - speakerRows[].teamRank
 *   - highlights.topBreaks and highlights.bestSpeakerRank
 *   - fieldStats[].betterThanUser
 * TODO: pin those once that work has landed.
 *
 * The database is the shared hand-rolled prisma mock. buildCvData calls the
 * same model method several times with different filters, so each mock
 * dispatches on the `where` it receives — the same shapes the real queries use.
 *
 * The record:
 *   T1 "Oxford IV 2025" — spoke (two claimed aliases: a rich row and a thin
 *      one), won the Grand Final, on the Open break; one teammate.
 *   T2 "EUDC 2024"      — judged only (adj core), chaired a quarter, paneled a
 *      semi; has an open error report.
 *   T3 "Novice Cup"     — no year, no team; speaker total only, so the average
 *      comes from the prelim count found in the speaker-round fallback.
 *   T4 "Unmatched Open" — ingested, but the user has no participation there.
 */

const USER = 'user-1';
const ADA = { id: 10n, displayName: 'Ada Lovelace', normalizedName: normalizePersonName('Ada Lovelace') };
const ADA_ALIAS = { id: 11n, displayName: 'Ada K. Lovelace', normalizedName: normalizePersonName('Ada K. Lovelace') };

const T1 = {
  id: 1n,
  name: 'Oxford IV 2025',
  year: 2025,
  format: 'British Parliamentary',
  region: 'Europe',
  totalTeams: 40,
  sourceUrlRaw: 'https://oxiv.calicotab.com/oxiv2025/privateurls/abc123/',
  prelimRoundCount: 5,
};
const T2 = {
  id: 2n,
  name: 'EUDC 2024',
  year: 2024,
  format: 'British Parliamentary',
  region: null,
  totalTeams: 200,
  sourceUrlRaw: 'https://eudc2024.calicotab.com/eudc/',
  prelimRoundCount: 9,
};
const T3 = {
  id: 3n,
  name: 'Novice Cup',
  year: null,
  format: 'Asian Parliamentary',
  region: null,
  totalTeams: 12,
  sourceUrlRaw: 'https://novice.calicotab.com/nc/privateurls/zzz/',
  prelimRoundCount: null,
};
const T4 = {
  id: 4n,
  name: 'Unmatched Open',
  year: 2023,
  format: null,
  region: null,
  totalTeams: null,
  sourceUrlRaw: 'https://unmatched.calicotab.com/uo/privateurls/qqq/',
  prelimRoundCount: null,
};

type ParticipationFixture = {
  eliminationReached: string | null;
  lastOutroundChaired: string | null;
  lastOutroundPaneled: string | null;
  [field: string]: unknown;
};

function participation(over: Record<string, unknown>): ParticipationFixture {
  return {
    personId: ADA.id,
    teamName: null,
    speakerScoreTotal: null,
    eliminationReached: null,
    teamBreakRank: null,
    speakerRankOpen: null,
    speakerRankOpenDerived: null,
    speakerRankEsl: null,
    speakerRankEfl: null,
    speakerCategories: [],
    judgeTypeTag: null,
    chairedPrelimRounds: null,
    lastOutroundChaired: null,
    lastOutroundPaneled: null,
    roles: [],
    speakerRoundScores: [],
    ...over,
  };
}

const MY_PARTICIPATIONS = [
  participation({
    tournamentId: 1n,
    teamName: 'Oxford A',
    speakerScoreTotal: 390,
    eliminationReached: 'Grand Final',
    teamBreakRank: 2,
    speakerRankOpenDerived: 3,
    speakerCategories: ['ESL'],
    roles: [{ role: 'speaker' }],
    // Unordered on purpose: the row output sorts by round.
    speakerRoundScores: [
      { roundNumber: 3, positionLabel: 'MO', score: 79 },
      { roundNumber: 1, positionLabel: 'PM', score: 77 },
      { roundNumber: 2, positionLabel: 'LO', score: 78 },
      { roundNumber: 5, positionLabel: 'MG', score: 76 },
      { roundNumber: 4, positionLabel: 'DPM', score: 80 },
    ],
  }),
  // A thinner duplicate under the alias: loses the "richest row" pick, but
  // its signals still merge (deepest outround / best break rank).
  participation({
    tournamentId: 1n,
    personId: ADA_ALIAS.id,
    eliminationReached: 'Semifinals',
    roles: [{ role: 'speaker' }],
  }),
  participation({
    tournamentId: 2n,
    personId: ADA_ALIAS.id,
    judgeTypeTag: 'core',
    chairedPrelimRounds: 3,
    lastOutroundChaired: 'Quarterfinals',
    lastOutroundPaneled: 'Semifinals',
    roles: [{ role: 'judge' }],
  }),
  participation({
    tournamentId: 3n,
    speakerScoreTotal: 150,
    roles: [{ role: 'speaker' }],
  }),
];

const MOTIONS = [
  { tournamentId: 1n, roundNumber: 1, roundLabel: 'Round 1', seq: 0, text: 'THW ban zoos', infoSlide: null, motionType: 'THW', topic: 'Environment' },
  { tournamentId: 1n, roundNumber: null, roundLabel: 'Grand Final', seq: 5, text: 'THR the rise of AI', infoSlide: 'Info', motionType: null, topic: null },
];

type Where = Record<string, unknown>;
const argsWhere = (args: unknown): Where => ((args as { where?: Where })?.where ?? {});

function installFixture() {
  prismaMock.user.findUnique.mockResolvedValue({ name: 'Ada (Google)', email: 'ada@example.com', image: null });

  prismaMock.discoveredUrl.findMany.mockResolvedValue([
    // Two URLs for T1: the later-sorting one carries the claimed name, the
    // earlier-dated one does not.
    { url: 'https://oxiv.calicotab.com/oxiv2025/privateurls/bbb/', tournamentId: 1n, messageDate: new Date('2025-02-10T09:00:00Z'), registrationName: 'Ada Lovelace', tournament: T1 },
    { url: 'https://oxiv.calicotab.com/oxiv2025/privateurls/aaa/', tournamentId: 1n, messageDate: new Date('2025-02-01T09:00:00Z'), registrationName: 'Someone Else', tournament: T1 },
    { url: 'https://eudc2024.calicotab.com/eudc/privateurls/ccc/', tournamentId: 2n, messageDate: null, registrationName: '  Ada K. Lovelace  ', tournament: T2 },
    { url: 'https://novice.calicotab.com/nc/privateurls/zzz/', tournamentId: 3n, messageDate: null, registrationName: null, tournament: T3 },
    { url: 'https://unmatched.calicotab.com/uo/privateurls/qqq/', tournamentId: 4n, messageDate: new Date('2023-05-05T00:00:00Z'), registrationName: null, tournament: T4 },
  ]);

  prismaMock.person.findMany.mockResolvedValue([ADA, ADA_ALIAS]);

  prismaMock.tournamentParticipant.findMany.mockImplementation(async (args: unknown) => {
    const w = argsWhere(args);
    if (w.person) return MY_PARTICIPATIONS;
    if (w.OR) {
      // Teammates of the user's own teams (T1 Oxford A): the user's own row
      // comes back too and must be filtered out as claimed.
      return [
        { tournamentId: 1n, teamName: 'Oxford A', personId: ADA.id, person: { displayName: 'Ada Lovelace', suppressedAt: null }, speakerScoreTotal: 390, speakerRoundScores: [] },
        { tournamentId: 1n, teamName: 'Oxford A', personId: 20n, person: { displayName: 'Grace Hopper', suppressedAt: null }, speakerScoreTotal: 400, speakerRoundScores: [{ roundNumber: 1, positionLabel: 'DPM', score: 80 }] },
      ];
    }
    if (w.speakerScoreTotal) {
      // The field: every speaker total published per tournament.
      return [
        { tournamentId: 1n, speakerScoreTotal: 390 },
        { tournamentId: 1n, speakerScoreTotal: 400 },
        { tournamentId: 1n, speakerScoreTotal: 350 },
        { tournamentId: 1n, speakerScoreTotal: 360 },
        { tournamentId: 3n, speakerScoreTotal: 150 },
        { tournamentId: 3n, speakerScoreTotal: 160 },
        { tournamentId: 3n, speakerScoreTotal: null },
      ];
    }
    throw new Error(`unexpected tournamentParticipant.findMany: ${JSON.stringify(Object.keys(w))}`);
  });

  prismaMock.tournament.findMany.mockResolvedValue([T1, T2, T3, T4].map((t) => ({ id: t.id, prelimRoundCount: t.prelimRoundCount })));

  // T1: five full prelims and a small outround; nothing for the others.
  prismaMock.teamResult.groupBy.mockResolvedValue([
    ...[1, 2, 3, 4, 5].map((roundNumber) => ({ tournamentId: 1n, roundNumber, _count: { _all: 20 } })),
    { tournamentId: 1n, roundNumber: 6, _count: { _all: 4 } },
  ]);
  // Last-resort prelim count from speaker round columns: only T3 needs it.
  prismaMock.$queryRaw.mockResolvedValue([{ tournamentId: 3n, maxRound: 2 }]);

  prismaMock.teamResult.findMany.mockImplementation(async (args: unknown) => {
    const w = argsWhere(args);
    if (w.roundNumber === 0) {
      return [
        { tournamentId: 1n, teamName: 'Oxford A', rank: null, wins: null, points: 12, firsts: 3, seconds: 1 },
        { tournamentId: 1n, teamName: 'Cambridge A', rank: null, wins: null, points: 13, firsts: 4, seconds: 1 },
        { tournamentId: 1n, teamName: 'Durham A', rank: null, wins: null, points: 9, firsts: 1, seconds: 2 },
      ];
    }
    return [
      { tournamentId: 1n, teamName: 'Oxford A', roundNumber: 2, position: 'OG', wins: 1, points: 3 },
      { tournamentId: 1n, teamName: 'Oxford A', roundNumber: 1, position: 'CO', wins: 0, points: 1 },
      { tournamentId: 1n, teamName: 'Oxford A', roundNumber: 3, position: null, wins: null, points: null },
    ];
  });

  prismaMock.judgeAssignment.findMany.mockResolvedValue([
    { tournamentId: 2n, personId: ADA_ALIAS.id, stage: 'Round 1', panelRole: 'chair', roundNumber: 1 },
    { tournamentId: 2n, personId: ADA_ALIAS.id, stage: 'Round 2', panelRole: 'panellist', roundNumber: 2 },
    { tournamentId: 2n, personId: ADA_ALIAS.id, stage: 'Round 2', panelRole: 'panellist', roundNumber: 2 },
    { tournamentId: 2n, personId: ADA_ALIAS.id, stage: 'Round 4', panelRole: 'chair', roundNumber: null },
    { tournamentId: 2n, personId: ADA_ALIAS.id, stage: 'Semifinals', panelRole: 'panellist', roundNumber: null },
    // Someone else's seat on the same panel: never counted.
    { tournamentId: 2n, personId: 99n, stage: 'Round 3', panelRole: 'chair', roundNumber: 3 },
  ]);

  prismaMock.eliminationResult.findMany.mockImplementation(async (args: unknown) => {
    const w = argsWhere(args);
    if (w.entityType === 'adjudicator') {
      return [{ tournamentId: 2n, entityName: 'Ada K. Lovelace', stage: 'Open' }];
    }
    if (w.result) {
      return [
        { tournamentId: 1n, entityName: 'Oxford A', stage: 'Grand Final', result: 'won' },
        { tournamentId: 1n, entityName: 'Oxford A', stage: 'Semifinals', result: 'won' },
        { tournamentId: 1n, entityName: 'Cambridge A', stage: 'Grand Final', result: 'lost' },
      ];
    }
    if (w.stage === 'Open') {
      return [
        { tournamentId: 1n, entityName: 'Oxford A', stage: 'Open' },
        { tournamentId: 1n, entityName: 'Cambridge A', stage: 'Open' },
      ];
    }
    // EUDC outround stages (T2 only; no speaker row there, so unused).
    return [];
  });

  prismaMock.cvErrorReport.findMany.mockResolvedValue([{ tournamentIds: ['2', '999'] }]);
  prismaMock.motion.findMany.mockResolvedValue(MOTIONS);
}

beforeEach(() => {
  resetPrismaMock();
  installFixture();
});

describe('buildCvData characterization: top-level shape', () => {
  it('returns every top-level key with the summary for this record', async () => {
    const cv = await buildCvData(USER);
    expect(Object.keys(cv).sort()).toEqual(
      ['fieldStats', 'highlights', 'judgeRows', 'myDisplayName', 'speakerRows', 'summary', 'taggedMotions', 'unmatchedTournaments', 'user'].sort(),
    );
    expect(cv.user).toEqual({ name: 'Ada (Google)', email: 'ada@example.com', image: null });
    // First claimed person's display name, ahead of the Google account name.
    expect(cv.myDisplayName).toBe('Ada Lovelace');
    expect(cv.summary).toEqual({ totalTournaments: 4, breaks: 2, totalRoundsChaired: 3 });
  });

  it('orders speaker rows by year descending with undated rows last', async () => {
    const cv = await buildCvData(USER);
    expect(cv.speakerRows.map((r) => r.tournamentName)).toEqual(['Oxford IV 2025', 'Novice Cup']);
    expect(cv.judgeRows.map((r) => r.tournamentName)).toEqual(['EUDC 2024']);
  });

  it('passes motions through unchanged', async () => {
    const cv = await buildCvData(USER);
    expect(cv.taggedMotions).toEqual(MOTIONS);
  });

  it('lists a tournament with no participation of the user as unmatched, with a public URL', async () => {
    const cv = await buildCvData(USER);
    expect(cv.unmatchedTournaments).toEqual([
      { id: 4n, name: 'Unmatched Open', year: 2023, format: null, sourceUrlRaw: 'https://unmatched.calicotab.com/uo/' },
    ]);
  });
});

describe('buildCvData characterization: the speaker row (T1)', () => {
  it('pins every field except teamRank', async () => {
    const cv = await buildCvData(USER);
    const { teamRank: _teamRank, ...row } = cv.speakerRows[0]!; // TODO: pin teamRank after the placement rework
    expect(row).toEqual({
      tournamentId: 1n,
      tournamentName: 'Oxford IV 2025',
      // Earliest email for the tournament, even from a URL whose name is not the user's.
      emailDate: '2025-02-01',
      year: 2025,
      format: 'British Parliamentary',
      region: 'Europe',
      totalTeams: 40,
      // The private token is stripped.
      sourceUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      myName: 'Ada Lovelace',
      teammates: ['Grace Hopper'],
      teammateDetails: [
        { key: 'p20', name: 'Grace Hopper', speakerScoreTotal: 400, roundScores: [{ roundNumber: 1, positionLabel: 'DPM', score: 80 }] },
      ],
      teamName: 'Oxford A',
      teamPoints: '12',
      teamWins: null,
      teamFirsts: 3,
      teamSeconds: 1,
      // 390 / 5 scored rounds.
      speakerAvgScore: '78.0',
      prelimsSpoken: 5,
      prelimRoundCount: 5,
      // Parser rank absent → the ingest-time derived rank.
      speakerRankOpen: 3,
      speakerRankEsl: null,
      speakerRankEfl: null,
      speakerCategories: ['ESL'],
      // Merged across both claimed participations.
      teamBreakRank: 2,
      eliminationReached: 'Grand Final',
      eliminationReachedByCategory: null,
      broke: true,
      openBreak: { teams: 2, userOnBreak: true, linePoints: 12, lineWins: null },
      wonTournament: true,
      hasOpenReport: false,
      roundScores: [
        { roundNumber: 1, positionLabel: 'PM', score: 77 },
        { roundNumber: 2, positionLabel: 'LO', score: 78 },
        { roundNumber: 3, positionLabel: 'MO', score: 79 },
        { roundNumber: 4, positionLabel: 'DPM', score: 80 },
        { roundNumber: 5, positionLabel: 'MG', score: 76 },
      ],
      teamRoundResults: [
        { roundNumber: 1, position: 'CO', won: false, points: 1 },
        { roundNumber: 2, position: 'OG', won: true, points: 3 },
        { roundNumber: 3, position: null, won: null, points: null },
      ],
    });
  });

  it('a lost Grand Final reads wonTournament false; a won Semifinal alone does not make a champion', async () => {
    prismaMock.eliminationResult.findMany.mockImplementation(async (args: unknown) => {
      const w = argsWhere(args);
      if (w.result) return [{ tournamentId: 1n, entityName: 'Oxford A', stage: 'Grand Final', result: 'lost' }];
      return [];
    });
    let cv = await buildCvData(USER);
    expect(cv.speakerRows[0]!.wonTournament).toBe(false);
    expect(cv.highlights.championships).toEqual([]);

    MY_PARTICIPATIONS[0]!.eliminationReached = 'Semifinals';
    try {
      prismaMock.eliminationResult.findMany.mockImplementation(async (args: unknown) =>
        argsWhere(args).result ? [{ tournamentId: 1n, entityName: 'Oxford A', stage: 'Semifinals', result: 'won' }] : [],
      );
      cv = await buildCvData(USER);
      // The thin alias row also says Semifinals, so the merged deepest is Semifinals.
      expect(cv.speakerRows[0]!.eliminationReached).toBe('Semifinals');
      expect(cv.speakerRows[0]!.wonTournament).toBeNull();
    } finally {
      MY_PARTICIPATIONS[0]!.eliminationReached = 'Grand Final';
    }
  });

  it('masks a withdrawn teammate by name but keeps their figures', async () => {
    prismaMock.tournamentParticipant.findMany.mockImplementation(async (args: unknown) => {
      const w = argsWhere(args);
      if (w.person) return MY_PARTICIPATIONS;
      if (w.OR) {
        return [{ tournamentId: 1n, teamName: 'Oxford A', personId: 20n, person: { displayName: 'Grace Hopper', suppressedAt: new Date() }, speakerScoreTotal: 400, speakerRoundScores: [] }];
      }
      return [];
    });
    const cv = await buildCvData(USER);
    expect(cv.speakerRows[0]!.teammates).toEqual(['[name withdrawn]']);
    expect(cv.speakerRows[0]!.teammateDetails).toEqual([
      { key: 'p20', name: '[name withdrawn]', speakerScoreTotal: 400, roundScores: [] },
    ]);
  });
});

describe('buildCvData characterization: the total-only speaker row (T3)', () => {
  it('averages the total over the prelim count from the speaker-round fallback', async () => {
    const cv = await buildCvData(USER);
    const { teamRank: _teamRank, ...row } = cv.speakerRows[1]!;
    expect(row).toMatchObject({
      tournamentId: 3n,
      tournamentName: 'Novice Cup',
      year: null,
      emailDate: null,
      sourceUrl: 'https://novice.calicotab.com/nc/',
      // No registration name on the URL: falls back to myDisplayName.
      myName: 'Ada Lovelace',
      teammates: [],
      teammateDetails: [],
      teamName: null,
      teamPoints: null,
      speakerAvgScore: '75.0',
      prelimsSpoken: 0,
      prelimRoundCount: 2,
      speakerRankOpen: null,
      teamBreakRank: null,
      eliminationReached: null,
      broke: false,
      openBreak: null,
      wonTournament: null,
      roundScores: [],
      teamRoundResults: [],
    });
  });
});

describe('buildCvData characterization: the judge row (T2)', () => {
  it('pins every field', async () => {
    const cv = await buildCvData(USER);
    expect(cv.judgeRows[0]).toEqual({
      tournamentId: 2n,
      tournamentName: 'EUDC 2024',
      year: 2024,
      format: 'British Parliamentary',
      region: null,
      totalTeams: 200,
      sourceUrl: 'https://eudc2024.calicotab.com/eudc/',
      // The URL's registration name, trimmed, because it is a claimed alias.
      myName: 'Ada K. Lovelace',
      judgeTypeTag: 'core',
      // Distinct inround (stage, round) pairs: Round 1, Round 2, Round 4.
      inroundsJudged: 3,
      inroundsChaired: 3,
      // Round 4 has no roundNumber; its number is read from the stage label.
      judgedRoundNumbers: [1, 2, 4],
      judgedOutroundStages: ['Semifinals'],
      lastOutroundChaired: 'Quarterfinals',
      // Deeper of chaired and paneled.
      lastOutroundJudged: 'Semifinals',
      broke: true,
      hasOpenReport: true,
    });
  });

  it('a judge with no outrounds still counts as broke when on the adjudicator break', async () => {
    const judge = MY_PARTICIPATIONS[2]!;
    const saved = { c: judge.lastOutroundChaired, p: judge.lastOutroundPaneled };
    judge.lastOutroundChaired = null;
    judge.lastOutroundPaneled = null;
    try {
      const cv = await buildCvData(USER);
      expect(cv.judgeRows[0]!.lastOutroundJudged).toBeNull();
      expect(cv.judgeRows[0]!.broke).toBe(true);
      expect(cv.highlights.outroundsChaired).toBe(0);
    } finally {
      judge.lastOutroundChaired = saved.c;
      judge.lastOutroundPaneled = saved.p;
    }
  });
});

describe('buildCvData characterization: highlights (except the placement fields)', () => {
  it('pins championships, best average, chairs, adj core, majors and active years', async () => {
    const cv = await buildCvData(USER);
    // The placement fields (deepestBreaks, topTeamFinishes, bestTeamFinish, bestSpeakerRank)
    // are pinned in tests/cv.teamPlacement.test.ts since PR #167 reworked them.
    const {
      deepestBreaks: _deepestBreaks,
      topTeamFinishes: _topTeamFinishes,
      bestTeamFinish: _bestTeamFinish,
      bestSpeakerRank: _bestSpeakerRank,
      ...rest
    } = cv.highlights;
    expect(rest).toEqual({
      championships: [{ tournamentName: 'Oxford IV 2025', year: 2025 }],
      bestSpeakerAverage: { tournamentName: 'Oxford IV 2025', year: 2025, score: 78 },
      outroundsChaired: 1,
      adjCoreCount: 1,
      majorEvents: [{ tournamentName: 'EUDC 2024', year: 2024 }],
      activeYears: { from: 2024, to: 2025 },
    });
  });
});

describe('buildCvData characterization: field summary', () => {
  it('summarises each tournament field in score units (betterThanUser not pinned)', async () => {
    const cv = await buildCvData(USER);
    // TODO: pin betterThanUser after the field-placement rework.
    const stats = cv.fieldStats.map(({ betterThanUser: _b, ...s }) => s);
    expect(stats).toHaveLength(2);
    const t1 = stats.find((s) => s.tournamentId === 1n)!;
    // Totals 350, 360, 390, 400 over 5 prelims.
    expect(t1.speakerCount).toBe(4);
    expect(t1.fieldMeanAvg).toBeCloseTo(75, 10);
    expect(t1.fieldStdevAvg).toBeCloseTo(Math.sqrt(425) / 5, 10);
    expect(t1.fieldMedianAvg).toBeCloseTo(75, 10);
    expect(t1.fieldP90Avg).toBeCloseTo(79.4, 10);
    expect(t1.userScoredRounds).toBe(5);
    expect(t1.prelimRoundCount).toBe(5);

    const t3 = stats.find((s) => s.tournamentId === 3n)!;
    // A null total is skipped; 150 and 160 over 2 prelims.
    expect(t3.speakerCount).toBe(2);
    expect(t3.fieldMeanAvg).toBeCloseTo(77.5, 10);
    expect(t3.fieldMedianAvg).toBeCloseTo(77.5, 10);
    expect(t3.userScoredRounds).toBe(0);
    expect(t3.prelimRoundCount).toBe(2);
  });

  it('includeFieldStats: false skips the field query and returns no field stats', async () => {
    const cv = await buildCvData(USER, { includeFieldStats: false });
    expect(cv.fieldStats).toEqual([]);
    const fieldQueries = prismaMock.tournamentParticipant.findMany.mock.calls.filter(
      ([args]) => !!argsWhere(args).speakerScoreTotal,
    );
    expect(fieldQueries).toHaveLength(0);
    // Everything else is unchanged.
    expect(cv.speakerRows).toHaveLength(2);
  });
});

describe('buildCvData characterization: queries', () => {
  it('reads only finished, linked URLs and only the user’s claimed participations', async () => {
    await buildCvData(USER);
    expect(prismaMock.discoveredUrl.findMany).toHaveBeenCalledWith({
      where: { userId: USER, tournamentId: { not: null }, ingestedAt: { not: null } },
      include: { tournament: true },
    });
    const mine = prismaMock.tournamentParticipant.findMany.mock.calls.find(([args]) => !!argsWhere(args).person)!;
    expect(argsWhere(mine[0])).toEqual({
      tournamentId: { in: [1n, 2n, 3n, 4n] },
      person: { claimedByUserId: USER },
    });
  });

  it('a user with nothing ingested gets an empty CV and no per-tournament queries', async () => {
    resetPrismaMock();
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    prismaMock.person.findMany.mockResolvedValue([]);
    const cv = await buildCvData(USER);
    expect(cv).toEqual({
      user: null,
      myDisplayName: 'You',
      speakerRows: [],
      judgeRows: [],
      taggedMotions: [],
      fieldStats: [],
      unmatchedTournaments: [],
      summary: { totalTournaments: 0, breaks: 0, totalRoundsChaired: 0 },
      highlights: {
        championships: [],
        deepestBreaks: [],
        topTeamFinishes: [],
        bestTeamFinish: null,
        bestSpeakerRank: null,
        bestSpeakerAverage: null,
        outroundsChaired: 0,
        adjCoreCount: 0,
        majorEvents: [],
        activeYears: null,
      },
    });
    expect(prismaMock.tournamentParticipant.findMany).not.toHaveBeenCalled();
    expect(prismaMock.teamResult.findMany).not.toHaveBeenCalled();
    expect(prismaMock.eliminationResult.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});
