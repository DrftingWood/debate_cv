import type {
  CvData,
  CvSpeakerRow,
  CvJudgeRow,
  CvTaggedMotion,
} from '@/lib/cv/buildCvData';

/**
 * Row builders for tests that exercise pure functions over CvData
 * (computeCvAnalytics, exportFields, the export route). The row types are
 * wide; these fill every field with a quiet default so each test only
 * spells out the fields its assertion is actually about.
 */

export function makeSpeakerRow(overrides: Partial<CvSpeakerRow> = {}): CvSpeakerRow {
  return {
    tournamentId: 1n,
    tournamentName: 'Test Open',
    year: 2025,
    format: 'British Parliamentary',
    region: null,
    totalTeams: 40,
    sourceUrl: 'https://example.calicotab.com/t/',
    myName: 'Test Person',
    teammates: ['Partner One'],
    teamName: 'Test A',
    teamRank: null,
    teamPoints: null,
    teamWins: null,
    speakerAvgScore: null,
    prelimsSpoken: 0,
    speakerRankOpen: null,
    speakerRankEsl: null,
    speakerRankEfl: null,
    teamBreakRank: null,
    eliminationReached: null,
    eliminationReachedByCategory: null,
    broke: false,
    wonTournament: null,
    hasOpenReport: false,
    roundScores: [],
    teamRoundResults: [],
    ...overrides,
  };
}

export function makeJudgeRow(overrides: Partial<CvJudgeRow> = {}): CvJudgeRow {
  return {
    tournamentId: 2n,
    tournamentName: 'Test IV',
    year: 2025,
    format: 'British Parliamentary',
    region: null,
    totalTeams: 24,
    sourceUrl: 'https://example.calicotab.com/t2/',
    myName: 'Test Person',
    judgeTypeTag: null,
    inroundsJudged: null,
    inroundsChaired: null,
    lastOutroundChaired: null,
    lastOutroundJudged: null,
    broke: false,
    hasOpenReport: false,
    ...overrides,
  };
}

/**
 * Motion row with quiet defaults. Tests that only care about tags can pass
 * `{ motionType: 'THW' }` without spelling out the text/label/seq columns
 * the display surfaces need.
 */
export function makeMotion(overrides: Partial<CvTaggedMotion> = {}): CvTaggedMotion {
  const roundNumber = overrides.roundNumber ?? 1;
  return {
    tournamentId: 1n,
    roundNumber,
    roundLabel: roundNumber == null ? 'Grand Final' : `Round ${roundNumber}`,
    seq: 0,
    text: 'THW test the motion pipeline.',
    infoSlide: null,
    motionType: null,
    topic: null,
    ...overrides,
  };
}

export function makeCvData(overrides: Partial<CvData> = {}): CvData {
  return {
    user: { name: 'Test Person', email: 'test@example.com', image: null },
    myDisplayName: 'Test Person',
    speakerRows: [],
    judgeRows: [],
    taggedMotions: [],
    fieldStats: [],
    unmatchedTournaments: [],
    summary: { totalTournaments: 0, breaks: 0, totalRoundsChaired: 0 },
    highlights: {
      championships: [],
      topBreaks: [],
      bestSpeakerRank: null,
      bestSpeakerAverage: null,
      outroundsChaired: 0,
      adjCoreCount: 0,
      majorEvents: [],
      activeYears: null,
    },
    ...overrides,
  };
}
