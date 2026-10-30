import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import { speakingSeries } from '@/lib/cv/careerChart';
import { summarizeBreaks } from '@/lib/cv/headerMetrics';

/**
 * The one fictional record behind every sample surface: the landing hero's
 * annotated preview and /sample (owner review 2026-10-29: the two showed
 * different people, and /sample still drew the pre-redesign Record by
 * hand). It is shaped as real CvData rows, so /sample renders it through
 * the same components as a public CV and cannot drift from the product.
 *
 * Every name, tournament and figure is invented. Hosts end in
 * `.example.calicotab.com`, which resolves nowhere.
 */

export const SAMPLE_NAME = 'Maya Rao';

let nextId = 1n;
function speaking(
  o: Partial<CvSpeakerRow> & Pick<CvSpeakerRow, 'tournamentName' | 'year'>,
): CvSpeakerRow {
  const id = nextId++;
  const slug = o.tournamentName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return {
    tournamentId: id,
    format: 'British Parliamentary',
    region: null,
    totalTeams: 60,
    sourceUrl: `https://${slug}.example.calicotab.com/`,
    myName: SAMPLE_NAME,
    teammates: ['Lena Fischer'],
    teammateDetails: [],
    teamName: 'Riverside A',
    teamRank: null,
    teamPoints: null,
    teamWins: null,
    speakerAvgScore: null,
    prelimsSpoken: 0,
    prelimRoundCount: null,
    emailDate: null,
    speakerRankOpen: null,
    speakerRankEsl: null,
    speakerRankEfl: null,
    speakerCategories: [],
    teamFirsts: null,
    teamSeconds: null,
    teamBreakRank: null,
    eliminationReached: null,
    eliminationReachedByCategory: null,
    openBreak: null,
    broke: false,
    wonTournament: null,
    hasOpenReport: false,
    partlyLoaded: false,
    roundScores: [],
    teamRoundResults: [],
    ...o,
  };
}

function judging(o: Partial<CvJudgeRow> & Pick<CvJudgeRow, 'tournamentName' | 'year'>): CvJudgeRow {
  const id = nextId++;
  const slug = o.tournamentName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return {
    tournamentId: id,
    format: 'British Parliamentary',
    region: null,
    totalTeams: 48,
    sourceUrl: `https://${slug}.example.calicotab.com/`,
    myName: SAMPLE_NAME,
    judgeTypeTag: 'normal',
    inroundsJudged: 5,
    inroundsChaired: 3,
    judgedRoundNumbers: [],
    judgedOutroundStages: [],
    lastOutroundChaired: null,
    lastOutroundJudged: null,
    broke: false,
    hasOpenReport: false,
    partlyLoaded: false,
    ...o,
  };
}

const broke = (stage: string, rank: number, of: number, extra: Partial<CvSpeakerRow> = {}) => ({
  broke: true,
  eliminationReached: stage,
  teamRank: rank,
  totalTeams: of,
  ...extra,
});

export const SAMPLE_SPEAKER_ROWS: CvSpeakerRow[] = [
  speaking({
    tournamentName: 'Riverside Open 2026',
    year: 2026,
    ...broke('Quarterfinals', 6, 40),
    speakerAvgScore: '76.1',
    prelimsSpoken: 5,
    speakerRankOpen: 14,
  }),
  speaking({
    tournamentName: 'Harbour Cup 2026',
    year: 2026,
    teamRank: 22,
    totalTeams: 36,
    speakerAvgScore: '74.0',
    prelimsSpoken: 5,
    speakerRankOpen: 41,
  }),
  speaking({
    tournamentName: 'World Universities Debating Championship 2025',
    year: 2025,
    ...broke('Octofinals', 31, 230),
    speakerAvgScore: '75.2',
    prelimsSpoken: 9,
    speakerRankOpen: 88,
    teammates: ['Sam Okonjo'],
  }),
  speaking({
    tournamentName: 'Hart House IV 2025',
    year: 2025,
    ...broke('Grand Final', 2, 48, { wonTournament: true }),
    speakerAvgScore: '77.4',
    prelimsSpoken: 5,
    speakerRankOpen: 6,
  }),
  speaking({
    tournamentName: 'Metro Open 2025',
    year: 2025,
    ...broke('Semifinals', 4, 52),
    speakerAvgScore: '76.6',
    prelimsSpoken: 6,
    speakerRankOpen: 9,
  }),
  speaking({
    tournamentName: 'Lakeside IV 2025',
    year: 2025,
    teamRank: 19,
    totalTeams: 44,
    speakerAvgScore: '74.5',
    prelimsSpoken: 5,
    speakerRankOpen: 33,
  }),
  speaking({
    tournamentName: 'Australs 2024',
    year: 2024,
    format: 'Australs',
    ...broke('Quarterfinals', 11, 94),
    speakerAvgScore: '75.8',
    prelimsSpoken: 8,
    speakerRankOpen: 22,
    teammates: ['Anika Sharma', 'Lena Fischer'],
  }),
  speaking({
    tournamentName: 'Cambridge IV 2024',
    year: 2024,
    ...broke('Grand Final', 3, 120),
    speakerAvgScore: '76.3',
    prelimsSpoken: 6,
    speakerRankOpen: 15,
  }),
  speaking({
    tournamentName: 'Oxford IV 2024',
    year: 2024,
    teamRank: 41,
    totalTeams: 110,
    speakerAvgScore: '74.8',
    prelimsSpoken: 6,
    speakerRankOpen: 52,
  }),
  speaking({
    tournamentName: 'Northern Novice 2023',
    year: 2023,
    ...broke('Grand Final', 1, 32, { wonTournament: true }),
    speakerAvgScore: '75.9',
    prelimsSpoken: 5,
    speakerRankOpen: 2,
  }),
  speaking({
    tournamentName: 'Autumn Open 2023',
    year: 2023,
    teamRank: 28,
    totalTeams: 40,
    speakerAvgScore: '72.6',
    prelimsSpoken: 5,
    speakerRankOpen: 61,
  }),
];

export const SAMPLE_JUDGE_ROWS: CvJudgeRow[] = [
  judging({
    tournamentName: 'Spring Schools 2026',
    year: 2026,
    broke: true,
    lastOutroundJudged: 'Semifinals',
    lastOutroundChaired: 'Semifinals',
    judgedOutroundStages: ['Quarterfinals', 'Semifinals'],
  }),
  judging({
    tournamentName: 'City Novice 2025',
    year: 2025,
    broke: true,
    lastOutroundJudged: 'Grand Final',
    judgedOutroundStages: ['Semifinals', 'Grand Final'],
  }),
  judging({ tournamentName: 'Valley IV 2024', year: 2024, inroundsChaired: 1 }),
];

const breaks = summarizeBreaks(SAMPLE_SPEAKER_ROWS, SAMPLE_JUDGE_ROWS);

/** The header figures, as buildCvData's summary carries them. */
export const SAMPLE_SUMMARY = {
  tournamentsSpoken: breaks.tournamentsSpoken,
  speakingBreaks: breaks.speaking,
  tournamentsJudged: breaks.tournamentsJudged,
  judgingBreaks: breaks.judging,
};

/** The landing hero's chart: the same record, drawn compact. */
export const SAMPLE_SPEAKING_SERIES = speakingSeries(SAMPLE_SPEAKER_ROWS);
