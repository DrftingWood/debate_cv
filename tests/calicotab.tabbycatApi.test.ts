import { describe, it, expect } from 'vitest';
import {
  API_REDACTED_NAME,
  apiBaseFromTournamentUrl,
  fetchTabsFromApi,
  institutionFromTeam,
  mapSpeakerStandings,
  mapTeamStandings,
  type ApiRound,
  type ApiSpeaker,
  type ApiTeam,
} from '@/lib/calicotab/tabbycatApi';

const B = 'https://t.calicotab.com/api/v1/tournaments/open';

const alice: ApiSpeaker = { url: `${B}/speakers/1`, name: 'Alice\tAdams', team: `${B}/teams/10`, categories: [`${B}/speaker-categories/7`, `${B}/speaker-categories/8`], anonymous: false };
const anon: ApiSpeaker = { url: `${B}/speakers/2`, name: null, team: `${B}/teams/10`, categories: [], anonymous: true };
const team: ApiTeam = { url: `${B}/teams/10`, reference: 'A', short_name: 'Oxford A', long_name: 'University of Oxford A', speakers: [alice, anon] };
const rounds: ApiRound[] = [
  { url: `${B}/rounds/2`, seq: 2, abbreviation: 'R2', stage: 'P' },
  { url: `${B}/rounds/1`, seq: 1, abbreviation: 'R1', stage: 'P' },
];

describe('apiBaseFromTournamentUrl', () => {
  it('takes the slug from private URLs and tab pages alike', () => {
    expect(apiBaseFromTournamentUrl('https://t.calicotab.com/open/privateurls/abc123/')).toBe(B);
    expect(apiBaseFromTournamentUrl('https://t.calicotab.com/open/tab/speaker/')).toBe(B);
  });
  it('returns null with no slug or an unparseable URL', () => {
    expect(apiBaseFromTournamentUrl('https://t.calicotab.com/')).toBeNull();
    expect(apiBaseFromTournamentUrl('not a url')).toBeNull();
  });
});

describe('institutionFromTeam', () => {
  it('strips the team reference from the long name', () => {
    expect(institutionFromTeam(team)).toBe('University of Oxford');
  });
  it('refuses to guess when the long name does not end in the reference', () => {
    expect(institutionFromTeam({ long_name: 'Swing Team', reference: 'Z' })).toBeNull();
    expect(institutionFromTeam({ long_name: 'Oxford A', reference: null })).toBeNull();
  });
});

describe('mapTeamStandings', () => {
  it('reads BP metrics and keeps the redaction label for opted-out speakers', () => {
    const rows = mapTeamStandings([team], [
      { rank: 3, tied: false, team: team.url, metrics: [{ metric: 'points', value: 15 }, { metric: 'firsts', value: 2 }, { metric: 'seconds', value: 4 }] },
      { rank: 4, tied: false, team: `${B}/teams/999`, metrics: [] },
    ]);
    expect(rows).toEqual([
      { rank: 3, teamName: 'Oxford A', institution: 'University of Oxford', speakers: ['Alice Adams', API_REDACTED_NAME], wins: null, totalPoints: 15, firsts: 2, seconds: 4 },
    ]);
  });
});

describe('mapSpeakerStandings', () => {
  it('orders round scores by round sequence, keeps the counted (non-ghost) speech, and drops private categories', () => {
    const rows = mapSpeakerStandings({
      speakers: [alice],
      teams: [team],
      rounds,
      categories: [
        { url: `${B}/speaker-categories/7`, name: 'ESL', public: true },
        { url: `${B}/speaker-categories/8`, name: 'Equity bracket', public: false },
      ],
      standings: [{ rank: 1, tied: false, speaker: alice.url, metrics: [{ metric: 'total', value: 152 }] }],
      roundStandings: [{
        speaker: alice.url,
        rounds: [
          { round: `${B}/rounds/2`, speeches: [{ score: 74, position: 2, ghost: true }, { score: 75, position: 4, ghost: false }] },
          { round: `${B}/rounds/1`, speeches: [{ score: 77, position: 1, ghost: false }] },
        ],
      }],
    });
    expect(rows).toEqual([{
      rank: 1, rankEsl: null, rankEfl: null, categories: ['ESL'],
      speakerName: 'Alice Adams', teamName: 'Oxford A', institution: 'University of Oxford', totalScore: 152,
      roundScores: [
        { roundLabel: 'R1', score: 77, positionLabel: null },
        { roundLabel: 'R2', score: 75, positionLabel: null },
      ],
    }]);
  });
});

describe('mapSpeakerStandings — columns and opted-out speakers', () => {
  const outround: ApiRound = { url: `${B}/rounds/9`, seq: 9, abbreviation: 'GF', stage: 'E' };
  const hidden: ApiSpeaker = { url: `${B}/speakers/3`, name: null, team: `${B}/teams/10`, categories: [`${B}/speaker-categories/7`], anonymous: true };

  it('emits every prelim as a column, empty where unspoken, and no outrounds', () => {
    const [row] = mapSpeakerStandings({
      speakers: [alice], teams: [team], rounds: [...rounds, outround], categories: [],
      standings: [{ rank: 1, tied: false, speaker: alice.url, metrics: [{ metric: 'total', value: 75 }] }],
      roundStandings: [{ speaker: alice.url, rounds: [
        { round: `${B}/rounds/2`, speeches: [{ score: 75, position: 1, ghost: false }] },
        { round: outround.url, speeches: [{ score: 80, position: 1, ghost: false }] },
      ] }],
    });
    expect(row.roundScores.map((r) => [r.roundLabel, r.score])).toEqual([['R1', null], ['R2', 75]]);
  });

  it('recovers an unlinked row by a unique score total, without its team', () => {
    const [row] = mapSpeakerStandings({
      speakers: [hidden], teams: [team], rounds,
      categories: [{ url: `${B}/speaker-categories/7`, name: 'ESL', public: true }],
      standings: [{ rank: 9, tied: false, speaker: null, metrics: [{ metric: 'total', value: 150 }] }],
      roundStandings: [{ speaker: hidden.url, rounds: [
        { round: `${B}/rounds/1`, speeches: [{ score: 76, position: 1, ghost: false }] },
        { round: `${B}/rounds/2`, speeches: [{ score: 74, position: 1, ghost: false }] },
      ] }],
    });
    expect(row).toMatchObject({ speakerName: API_REDACTED_NAME, teamName: null, institution: null, categories: ['ESL'], totalScore: 150 });
    expect(row.roundScores.map((r) => r.score)).toEqual([76, 74]);
  });

  it('leaves scores empty when two hidden speakers share the total', () => {
    const twin: ApiSpeaker = { ...hidden, url: `${B}/speakers/4` };
    const speech = (round: string, score: number) => ({ round, speeches: [{ score, position: 1, ghost: false }] });
    const [row] = mapSpeakerStandings({
      speakers: [hidden, twin], teams: [team], rounds, categories: [],
      standings: [{ rank: 9, tied: true, speaker: null, metrics: [{ metric: 'total', value: 150 }] }],
      roundStandings: [
        { speaker: hidden.url, rounds: [speech(`${B}/rounds/1`, 75), speech(`${B}/rounds/2`, 75)] },
        { speaker: twin.url, rounds: [speech(`${B}/rounds/1`, 76), speech(`${B}/rounds/2`, 74)] },
      ],
    });
    expect(row.roundScores.map((r) => r.score)).toEqual([null, null]);
    expect(row.categories).toEqual([]);
  });
});

describe('fetchTabsFromApi', () => {
  it('reports unavailable on the first non-200 so the caller can fall back to HTML', async () => {
    const seen: string[] = [];
    const res = await fetchTabsFromApi('https://t.calicotab.com/open/privateurls/x/', async (url) => {
      seen.push(url);
      return { status: url.endsWith('/teams') ? 200 : 403, json: async () => [] };
    });
    expect(res).toEqual({ kind: 'unavailable', reason: 'speakers: HTTP 403' });
    expect(seen).toEqual([`${B}/teams`, `${B}/speakers`]);
  });
  it('treats a 200 that is not JSON as no API', async () => {
    const res = await fetchTabsFromApi('https://t.calicotab.com/open/', async () => ({
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    }));
    expect(res).toEqual({ kind: 'unavailable', reason: 'teams: not JSON' });
  });
});
