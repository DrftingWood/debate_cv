import { describe, expect, test } from 'vitest';
import {
  bpFromPreference,
  breakRanksConsistent,
  fetchRestFromApi,
  mapBreakPage,
  mapParticipants,
  mapRoundResults,
  sidePositionLabel,
  type ApiAdjudicator,
  type ApiRoundsTeam,
} from '@/lib/calicotab/tabbycatApiRounds';
import { API_REDACTED_NAME } from '@/lib/calicotab/tabbycatApi';

const API = 'https://t.calicotab.com/api/v1/tournaments/t';
const T = 'https://t.calicotab.com/t/';
const team = (id: number, short_name: string, speakers: ApiRoundsTeam['speakers'] = []): ApiRoundsTeam => ({
  url: `${API}/teams/${id}`,
  short_name,
  speakers,
});
const adj = (id: number, name: string | null, extra: Partial<ApiAdjudicator> = {}): ApiAdjudicator => ({
  url: `${API}/adjudicators/${id}`,
  name,
  anonymous: false,
  ...extra,
});
const round = (seq: number) => `${API}/rounds/${seq}`;

describe('sidePositionLabel', () => {
  test('BP sides under the tournament side names', () => {
    expect(sidePositionLabel('co', 'gov-opp')).toBe('Closing Opposition');
    expect(sidePositionLabel('og', 'prop-opp')).toBe('Opening Proposition');
  });
  test('two-team sides', () => {
    expect(sidePositionLabel('aff', 'aff-neg')).toBe('Affirmative');
    expect(sidePositionLabel('neg', 'prop-opp')).toBe('Opposition');
  });
  test('an unknown side or side-name set is null, never a guess', () => {
    expect(sidePositionLabel('xx', 'gov-opp')).toBeNull();
    expect(sidePositionLabel('og', 'mystery')).toBeNull();
    expect(sidePositionLabel(null, 'gov-opp')).toBeNull();
  });
});

describe('mapRoundResults', () => {
  const teams = [team(1, 'Alpha A'), team(2, 'Beta B')];
  const base = {
    navLabel: undefined,
    apiRoundName: 'Round 1',
    teamsInDebate: 4,
    sideNames: 'gov-opp',
    teams,
    pairings: [],
    adjudicators: [],
  };

  test('BP prelim: points, and won only for first place (the API says win:false)', () => {
    const r = mapRoundResults({
      ...base,
      seq: 1,
      sourceUrl: `${T}results/round/1/`,
      roundStandings: [
        { team: teams[0].url, rounds: [{ round: round(1), points: 3, win: false, side: 'og' }] },
        { team: teams[1].url, rounds: [{ round: round(1), points: 2, win: false, side: 'co' }] },
      ],
    });
    expect(r.teamResults).toEqual([
      { teamName: 'Alpha A', position: 'Opening Government', points: 3, won: true },
      { teamName: 'Beta B', position: 'Closing Opposition', points: 2, won: false },
    ]);
    expect(r).toMatchObject({ roundNumber: 1, roundLabel: 'Round 1', isOutround: false });
  });

  test('outround: won from the API, no points; label from the nav, outround from the label', () => {
    const r = mapRoundResults({
      ...base,
      seq: 10,
      sourceUrl: `${T}results/round/10/`,
      navLabel: 'Grand Final',
      apiRoundName: 'Grand Final',
      roundStandings: [
        { team: teams[0].url, rounds: [{ round: round(10), points: null, win: true, side: 'cg' }] },
        { team: teams[1].url, rounds: [{ round: round(10), points: null, win: false, side: 'oo' }] },
      ],
    });
    expect(r.teamResults.map((t) => [t.teamName, t.points, t.won])).toEqual([
      ['Alpha A', null, true],
      ['Beta B', null, false],
    ]);
    expect(r).toMatchObject({ roundLabel: 'Grand Final', isOutround: true });
  });

  test('two-team prelim: won from the API, no points', () => {
    const r = mapRoundResults({
      ...base,
      teamsInDebate: 2,
      sideNames: 'aff-neg',
      seq: 2,
      sourceUrl: `${T}results/round/2/`,
      roundStandings: [{ team: teams[0].url, rounds: [{ round: round(2), points: 1, win: true, side: 'aff' }] }],
    });
    expect(r.teamResults).toEqual([{ teamName: 'Alpha A', position: 'Affirmative', points: null, won: true }]);
  });

  test('a drawn team with no result (a bye) has no row, as on the HTML table', () => {
    const r = mapRoundResults({
      ...base,
      teamsInDebate: 2,
      sideNames: 'aff-neg',
      seq: 3,
      sourceUrl: `${T}results/round/3/`,
      roundStandings: [
        { team: teams[0].url, rounds: [{ round: round(3), points: null, win: null, side: 'aff' }] },
        { team: teams[1].url, rounds: [{ round: round(3), points: 0, win: false, side: 'neg' }] },
      ],
    });
    expect(r.teamResults.map((t) => t.teamName)).toEqual(['Beta B']);
  });

  test('BP recognised from the sides when the preference is not 4', () => {
    const r = mapRoundResults({
      ...base,
      teamsInDebate: 2,
      seq: 1,
      sourceUrl: `${T}results/round/1/`,
      roundStandings: [{ team: teams[0].url, rounds: [{ round: round(1), points: 3, win: false, side: 'og' }] }],
    });
    expect(r.teamResults[0]).toMatchObject({ points: 3, won: true });
    expect(bpFromPreference('bp')).toBe(true);
    expect(bpFromPreference('4')).toBe(true);
    expect(bpFromPreference('two')).toBe(false);
  });

  test('BP outround: won from the API even if points were sent, never from first place', () => {
    const r = mapRoundResults({
      ...base,
      seq: 12,
      sourceUrl: `${T}results/round/12/`,
      navLabel: 'Semifinals',
      roundStandings: [
        { team: teams[0].url, rounds: [{ round: round(12), points: 2, win: true, side: 'og' }] },
        { team: teams[1].url, rounds: [{ round: round(12), points: 3, win: false, side: 'oo' }] },
      ],
    });
    expect(r.teamResults.map((t) => [t.teamName, t.points, t.won])).toEqual([
      ['Alpha A', null, true],
      ['Beta B', null, false],
    ]);
  });

  test("only this round's entries are taken", () => {
    const r = mapRoundResults({
      ...base,
      seq: 2,
      sourceUrl: `${T}results/round/2/`,
      roundStandings: [{ team: teams[0].url, rounds: [{ round: round(1), points: 3, win: false, side: 'og' }] }],
    });
    expect(r.teamResults).toEqual([]);
  });

  test('judges: chair, panel and trainee; opted-out judges are not named; duplicates collapse', () => {
    const r = mapRoundResults({
      ...base,
      seq: 1,
      sourceUrl: `${T}results/round/1/`,
      roundStandings: [],
      adjudicators: [adj(1, 'Cara Chair'), adj(2, 'Pat Panel'), adj(3, 'Tia Trainee'), adj(4, 'Hidden', { anonymous: true })],
      pairings: [
        {
          teams: [],
          adjudicators: { chair: `${API}/adjudicators/1`, panellists: [`${API}/adjudicators/2`, `${API}/adjudicators/4`], trainees: [`${API}/adjudicators/3`] },
        },
        { teams: [], adjudicators: { chair: `${API}/adjudicators/1`, panellists: [], trainees: [] } },
        { teams: [], adjudicators: null },
      ],
    });
    expect(r.judgeAssignments).toEqual([
      { personName: 'Cara Chair', panelRole: 'chair' },
      { personName: 'Pat Panel', panelRole: 'panel' },
      { personName: 'Tia Trainee', panelRole: 'trainee' },
    ]);
  });
});

describe('mapBreakPage', () => {
  const teams = [team(1, 'Alpha A'), team(2, 'Beta B')];
  test('team break: rank from the break list, score from team points, stage from the URL', () => {
    const rows = mapBreakPage({
      sourceUrl: `${T}break/teams/esl/`,
      breakingTeams: [{ team: teams[1].url, rank: 1 }, { team: teams[0].url, rank: 2 }],
      teams,
      teamStandings: [
        { team: teams[0].url, metrics: [{ metric: 'points', value: 17 }] },
        { team: teams[1].url, metrics: [{ metric: 'points', value: 19 }] },
      ],
      adjudicators: [],
    });
    expect(rows).toEqual([
      { rank: 1, entityType: 'team', entityName: 'Beta B', institution: null, score: 19, stage: 'ESL' },
      { rank: 2, entityType: 'team', entityName: 'Alpha A', institution: null, score: 17, stage: 'ESL' },
    ]);
  });

  test('break rank is the API rank, ties and remarked teams included', () => {
    const three = [...teams, team(3, 'Gamma C')];
    const rows = mapBreakPage({
      sourceUrl: `${T}break/teams/esl/`,
      breakingTeams: [
        { team: three[0].url, rank: 1 },
        { team: three[1].url, rank: 1 },
        { team: three[2].url, rank: 3 },
      ],
      teams: three,
      teamStandings: [{ team: three[2].url, metrics: [{ metric: 'points', value: '15' }] }],
      adjudicators: [],
    });
    expect(rows.map((r) => [r.entityName, r.rank, r.score])).toEqual([
      ['Alpha A', 1, null],
      ['Beta B', 1, null],
      ['Gamma C', 3, 15],
    ]);
  });

  test('break ranks that skip numbers are not trusted (IITB 2023)', () => {
    expect(breakRanksConsistent([1, 2, 2, 4, 5])).toBe(true);
    expect(breakRanksConsistent([1, 2, 3, 5])).toBe(false);
    expect(breakRanksConsistent([1, null])).toBe(false);
    expect(breakRanksConsistent([])).toBe(true);
  });

  test('adjudicator break: breaking judges, an opted-out one as the redaction', () => {
    const rows = mapBreakPage({
      sourceUrl: `${T}break/adjudicators/`,
      teams: [],
      teamStandings: [],
      adjudicators: [adj(1, 'Ann Adj', { breaking: true }), adj(2, 'Not Breaking'), adj(3, 'Real Name', { breaking: true, anonymous: true })],
    });
    expect(rows.map((r) => r.entityName)).toEqual(['Ann Adj', API_REDACTED_NAME]);
    expect(rows.every((r) => r.stage === 'Adjudicators' && r.rank === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('Real Name');
  });
});

describe('mapParticipants', () => {
  test('speakers with their team, adjudicators tagged core > invited > normal, opt-outs redacted', () => {
    const rows = mapParticipants({
      teams: [
        team(1, 'Alpha A', [
          { url: 's1', name: 'Sam Speaker', anonymous: false },
          { url: 's2', name: 'Secret Speaker', anonymous: true },
        ]),
      ],
      adjudicators: [
        adj(1, 'Core Person', { adj_core: true, independent: true }),
        adj(2, 'Invited Person', { independent: true }),
        adj(3, 'Normal Person'),
        adj(4, 'Secret Judge', { anonymous: true }),
      ],
    });
    expect(rows).toEqual([
      { name: 'Sam Speaker', role: 'speaker', judgeTag: null, teamName: 'Alpha A', institution: null },
      { name: API_REDACTED_NAME, role: 'speaker', judgeTag: null, teamName: 'Alpha A', institution: null },
      { name: 'Core Person', role: 'adjudicator', judgeTag: 'core', teamName: null, institution: null },
      { name: 'Invited Person', role: 'adjudicator', judgeTag: 'invited', teamName: null, institution: null },
      { name: 'Normal Person', role: 'adjudicator', judgeTag: 'normal', teamName: null, institution: null },
      { name: API_REDACTED_NAME, role: 'adjudicator', judgeTag: 'normal', teamName: null, institution: null },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/Secret/);
  });
});

describe('fetchRestFromApi', () => {
  const nav = {
    resultsRounds: [`${T}results/round/1/`],
    resultsRoundLabels: { [`${T}results/round/1/`]: 'Round 1' },
    breakTabs: [`${T}break/teams/open/`, `${T}break/adjudicators/`],
    participants: `${T}participants/list/`,
  };
  const prefs = (overrides: Record<string, unknown>) =>
    Object.entries({
      'debate_rules__teams_in_debate': 4,
      'debate_rules__side_names': 'gov-opp',
      'public_features__public_results': true,
      'public_features__public_breaking_teams': true,
      'public_features__public_breaking_adjs': true,
      'public_features__public_participants': true,
      'ui_options__show_team_institutions': false,
      'ui_options__show_adjudicator_institutions': false,
      ...overrides,
    }).map(([identifier, value]) => ({ identifier, value }));

  function fakeApi(body: Record<string, unknown>) {
    const asked: string[] = [];
    const fetcher = async (url: string) => {
      const path = url.slice(API.length + 1);
      asked.push(path);
      const hit = body[path];
      return hit === undefined
        ? { status: 404, json: async () => ({}) }
        : { status: 200, json: async () => hit };
    };
    return { asked, fetcher };
  }

  const teams = [team(1, 'Alpha A', [{ url: 's1', name: 'Sam Speaker', anonymous: false }])];
  const full = {
    teams,
    adjudicators: [adj(1, 'Cara Chair', { breaking: true })],
    'teams/standings/rounds': [{ team: teams[0].url, rounds: [{ round: round(1), points: 3, win: false, side: 'og' }] }],
    rounds: [{ url: round(1), seq: 1, name: 'Round 1' }],
    'rounds/1/pairings': [{ teams: [], adjudicators: { chair: `${API}/adjudicators/1`, panellists: [], trainees: [] } }],
    'teams/standings': [{ team: teams[0].url, metrics: [{ metric: 'points', value: 3 }] }],
    'break-categories': [{ url: `${API}/break-categories/9`, slug: 'open', name: 'Open' }],
    'break-categories/9/break': [{ team: teams[0].url, rank: 1 }],
  };

  test('every linked page comes from the API when the tournament makes it public', async () => {
    const { fetcher } = fakeApi({ preferences: prefs({}), ...full });
    const r = await fetchRestFromApi(T, nav, fetcher);
    expect(r.rounds.get(nav.resultsRounds[0])?.source).toBe('api');
    expect(r.breaks.get(nav.breakTabs[0])?.source).toBe('api');
    expect(r.breaks.get(nav.breakTabs[1])?.source).toBe('api');
    expect(r.participants?.source).toBe('api');
  });

  test('a page the tournament keeps private is not read from the API', async () => {
    const { fetcher, asked } = fakeApi({
      preferences: prefs({ 'public_features__public_results': false, 'public_features__public_participants': false }),
      ...full,
    });
    const r = await fetchRestFromApi(T, nav, fetcher);
    expect(r.rounds.get(nav.resultsRounds[0])?.source).toBe('html');
    expect(r.participants?.source).toBe('html');
    expect(asked).not.toContain('teams/standings/rounds');
    expect(asked.some((p) => p.includes('pairings'))).toBe(false);
  });

  test('an absent preference is not consent', async () => {
    const { fetcher } = fakeApi({ preferences: [], ...full });
    const r = await fetchRestFromApi(T, nav, fetcher);
    expect([...r.rounds.values(), ...r.breaks.values(), r.participants].every((x) => x?.source === 'html')).toBe(true);
  });

  test('only rounds the nav links are asked for', async () => {
    const { fetcher, asked } = fakeApi({ preferences: prefs({}), ...full, 'rounds/2/pairings': [] });
    await fetchRestFromApi(T, nav, fetcher);
    expect(asked.filter((p) => p.includes('pairings'))).toEqual(['rounds/1/pairings']);
  });

  test('no API on the host: every page falls back to HTML', async () => {
    const { fetcher } = fakeApi({});
    const r = await fetchRestFromApi(T, nav, fetcher);
    expect(r.rounds.get(nav.resultsRounds[0])).toMatchObject({ source: 'html' });
    expect(r.participants).toMatchObject({ source: 'html' });
  });

  test('judge institutions shown: participants and the adjudicator break stay on HTML', async () => {
    const { fetcher } = fakeApi({
      preferences: prefs({}),
      ...full,
      adjudicators: [adj(1, 'Cara Chair', { breaking: true, institution: `${API}/institutions/7` })],
    });
    const r = await fetchRestFromApi(T, nav, fetcher);
    expect(r.participants?.source).toBe('html');
    expect(r.breaks.get(nav.breakTabs[1])?.source).toBe('html');
    expect(r.breaks.get(nav.breakTabs[0])?.source).toBe('api');
    expect(r.rounds.get(nav.resultsRounds[0])?.source).toBe('api');
  });

  test('team institutions shown: team breaks and participants stay on HTML', async () => {
    const { fetcher } = fakeApi({ preferences: prefs({ 'ui_options__show_team_institutions': true }), ...full });
    const r = await fetchRestFromApi(T, nav, fetcher);
    expect(r.breaks.get(nav.breakTabs[0])?.source).toBe('html');
    expect(r.participants?.source).toBe('html');
    expect(r.breaks.get(nav.breakTabs[1])?.source).toBe('api');
    expect(r.rounds.get(nav.resultsRounds[0])?.source).toBe('api');
  });

  test('a round whose results miss a drawn team goes to HTML', async () => {
    const two = [...teams, team(2, 'Beta B')];
    const { fetcher } = fakeApi({
      preferences: prefs({}),
      ...full,
      teams: two,
      'rounds/1/pairings': [{ teams: [{ team: two[0].url, side: 'og' }, { team: two[1].url, side: 'oo' }], adjudicators: null }],
    });
    const r = await fetchRestFromApi(T, nav, fetcher);
    expect(r.rounds.get(nav.resultsRounds[0])).toMatchObject({ source: 'html' });
  });

  test('host push-back stops the API: later rounds are not asked for', async () => {
    const nav3 = {
      ...nav,
      resultsRounds: [1, 2, 3].map((n) => `${T}results/round/${n}/`),
      resultsRoundLabels: {},
    };
    const asked: string[] = [];
    const body: Record<string, unknown> = {
      preferences: prefs({}),
      ...full,
      rounds: [1, 2, 3].map((n) => ({ url: round(n), seq: n, name: `Round ${n}` })),
    };
    const fetcher = async (url: string) => {
      const path = url.slice(API.length + 1);
      asked.push(path);
      if (path === 'rounds/1/pairings') return { status: 429, json: async () => ({}) };
      const hit = body[path];
      return hit === undefined ? { status: 404, json: async () => ({}) } : { status: 200, json: async () => hit };
    };
    const r = await fetchRestFromApi(T, nav3, fetcher);
    expect(asked.filter((p) => p.includes('pairings'))).toEqual(['rounds/1/pairings']);
    expect(asked).not.toContain('break-categories');
    expect([...r.rounds.values()].every((x) => x.source === 'html')).toBe(true);
    expect(r.breaks.get(nav.breakTabs[0])?.source).toBe('html');
  });

  test('an unreadable break-category url costs that tab, never the ingest', async () => {
    const { fetcher } = fakeApi({
      preferences: prefs({}),
      ...full,
      'break-categories': [{ url: 'not a url', slug: 'open', name: 'Open' }],
    });
    const r = await fetchRestFromApi(T, nav, fetcher);
    expect(r.breaks.get(nav.breakTabs[0])).toMatchObject({ source: 'html' });
  });

  test('one failing endpoint costs only its own page', async () => {
    const { fetcher } = fakeApi({ preferences: prefs({}), ...full, 'break-categories/9/break': undefined });
    const r = await fetchRestFromApi(T, nav, fetcher);
    expect(r.breaks.get(nav.breakTabs[0])?.source).toBe('html');
    expect(r.rounds.get(nav.resultsRounds[0])?.source).toBe('api');
    expect(r.participants?.source).toBe('api');
  });
});
