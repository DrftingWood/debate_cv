import { describe, it, expect } from 'vitest';
import {
  API_REDACTED_NAME,
  apiBaseFromTournamentUrl,
  fetchTabsFromApi,
  htmlOnly,
  htmlTabsToFetch,
  tabReleaseFromPreferences,
  institutionFromTeam,
  mapSpeakerStandings,
  mapTeamStandings,
  type ApiRound,
  type ApiSpeaker,
  type ApiTeam,
  type Fetcher,
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

describe('tabbycatApiTabsEnabled', () => {
  it('is on unless TABBYCAT_API_TABS is exactly "0"', async () => {
    const { tabbycatApiTabsEnabled } = await import('@/lib/calicotab/tabbycatApi');
    const prev = process.env.TABBYCAT_API_TABS;
    try {
      delete process.env.TABBYCAT_API_TABS;
      expect(tabbycatApiTabsEnabled()).toBe(true);
      process.env.TABBYCAT_API_TABS = '1';
      expect(tabbycatApiTabsEnabled()).toBe(true);
      process.env.TABBYCAT_API_TABS = '0';
      expect(tabbycatApiTabsEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TABBYCAT_API_TABS;
      else process.env.TABBYCAT_API_TABS = prev;
    }
  });
});

// ── fetchTabsFromApi against a mocked host ──────────────────────────────────
//
// No network: every request goes through a Fetcher that answers from a
// path → response table, and records what was asked for so the tests can
// prove what was NOT fetched (standings for a private tab, anything after a
// 404 on a host with no API).

const PRIVATE_URL = 'https://t.calicotab.com/open/privateurls/abc123/';
const NAV = { teamTab: 'https://t.calicotab.com/open/tab/team/', speakerTab: 'https://t.calicotab.com/open/tab/speaker/' };

type Answer = { status: number; body?: unknown; notJson?: boolean };

function released(team: boolean | undefined, speaker: boolean | undefined, limits: { team?: number; speaker?: number } = {}) {
  const prefs: Array<{ identifier: string; value: unknown }> = [
    { identifier: 'public_features__public_results', value: true },
    { identifier: 'tab_release__team_tab_limit', value: limits.team ?? 0 },
    { identifier: 'tab_release__speaker_tab_limit', value: limits.speaker ?? 0 },
  ];
  if (team !== undefined) prefs.push({ identifier: 'tab_release__team_tab_released', value: team });
  if (speaker !== undefined) prefs.push({ identifier: 'tab_release__speaker_tab_released', value: speaker });
  return prefs;
}

function fullHost(overrides: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    preferences: { status: 200, body: released(true, true) },
    teams: { status: 200, body: [team] },
    'teams/standings': { status: 200, body: [{ rank: 1, tied: false, team: team.url, metrics: [{ metric: 'points', value: 6 }] }] },
    speakers: { status: 200, body: [alice, anon] },
    rounds: { status: 200, body: rounds },
    'speaker-categories': { status: 200, body: [] },
    'speakers/standings': { status: 200, body: [{ rank: 1, tied: false, speaker: alice.url, metrics: [{ metric: 'total', value: 152 }] }] },
    'speakers/standings/rounds': {
      status: 200,
      body: [{ speaker: alice.url, rounds: [
        { round: `${B}/rounds/1`, speeches: [{ score: 77, position: 1, ghost: false }] },
        { round: `${B}/rounds/2`, speeches: [{ score: 75, position: 1, ghost: false }] },
      ] }],
    },
    ...overrides,
  };
}

function mockHost(answers: Record<string, Answer>) {
  const seen: string[] = [];
  const fetcher: Fetcher = async (url) => {
    const path = url.startsWith(`${B}/`) ? url.slice(B.length + 1) : url;
    seen.push(path);
    const a = answers[path] ?? { status: 404, body: { detail: 'Not found.' } };
    return {
      status: a.status,
      json: async () => {
        if (a.notJson) throw new SyntaxError('Unexpected token <');
        return a.body;
      },
    };
  };
  return { fetcher, seen };
}

describe('fetchTabsFromApi — API success', () => {
  it('maps both tabs from the API and skips both HTML pages', async () => {
    const { fetcher, seen } = mockHost(fullHost());
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res.teams).toEqual({ source: 'api', rows: [expect.objectContaining({ teamName: 'Oxford A', totalPoints: 6 })] });
    expect(res.speakers.source).toBe('api');
    if (res.speakers.source !== 'api') return;
    expect(res.speakers.rows[0]).toMatchObject({ speakerName: 'Alice Adams', totalScore: 152 });
    expect(res.speakers.rows[0].roundScores.map((r) => r.score)).toEqual([77, 75]);
    // Preferences first, so a private tournament never reaches standings.
    expect(seen[0]).toBe('preferences');
    expect(htmlTabsToFetch(res, NAV)).toEqual({ teamTab: null, speakerTab: null });
  });

  it('carries on when preferences are hidden (401) and the standings answer', async () => {
    const { fetcher } = mockHost(fullHost({ preferences: { status: 401, body: { detail: 'Authentication credentials were not provided.' } } }));
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res.teams.source).toBe('api');
    expect(res.speakers.source).toBe('api');
  });
});

describe('fetchTabsFromApi — API unavailable → HTML fallback', () => {
  it('falls back on a 404 and stops asking (no API on this install)', async () => {
    const { fetcher, seen } = mockHost({});
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res).toEqual(htmlOnly('preferences: HTTP 404'));
    expect(seen).toEqual(['preferences']);
    expect(htmlTabsToFetch(res, NAV)).toEqual(NAV);
  });

  it('falls back when a 200 is an HTML page, not JSON (pre-2.8, Cloudflare challenge)', async () => {
    const { fetcher, seen } = mockHost({ preferences: { status: 200, notJson: true } });
    expect(await fetchTabsFromApi(PRIVATE_URL, fetcher)).toEqual(htmlOnly('preferences: not JSON'));
    expect(seen).toEqual(['preferences']);
  });

  it.each([401, 403, 404])('falls back per tab when standings answer %i with no release setting to go on', async (status) => {
    const { fetcher } = mockHost(fullHost({
      preferences: { status: 403, body: { detail: 'Forbidden' } },
      'speakers/standings': { status, body: { detail: 'nope' } },
    }));
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res.teams.source).toBe('api');
    expect(res.speakers).toEqual({ source: 'html', reason: `speakers/standings: HTTP ${status}` });
    expect(htmlTabsToFetch(res, NAV)).toEqual({ teamTab: null, speakerTab: NAV.speakerTab });
  });

  it('falls back on a network error or timeout', async () => {
    const res = await fetchTabsFromApi(PRIVATE_URL, async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    expect(res.teams).toEqual({ source: 'html', reason: 'preferences: The operation was aborted due to timeout' });
    expect(res.speakers.source).toBe('html');
  });

  it.each([429, 503])('stops asking the API after a %i and leaves both tabs to HTML', async (status) => {
    const { fetcher, seen } = mockHost(fullHost({ 'teams/standings': { status, body: { detail: 'slow down' } } }));
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res).toEqual(htmlOnly(`teams/standings: HTTP ${status}`));
    expect(seen).toEqual(['preferences', 'teams', 'teams/standings']);
  });

  it('falls back without a request when the URL has no tournament slug', async () => {
    const { fetcher, seen } = mockHost(fullHost());
    expect(await fetchTabsFromApi('https://t.calicotab.com/', fetcher)).toEqual(htmlOnly('no tournament slug in URL'));
    expect(seen).toEqual([]);
  });

  it('leaves a tab limited to the top N to the HTML page (the API returns every row)', async () => {
    const { fetcher, seen } = mockHost(fullHost({ preferences: { status: 200, body: released(true, true, { speaker: 3 }) } }));
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res.teams.source).toBe('api');
    expect(res.speakers).toEqual({ source: 'html', reason: 'speaker tab released to top N only' });
    expect(seen).not.toContain('speakers/standings');
  });

  it('the kill-switch result sends both tabs to HTML', () => {
    expect(htmlTabsToFetch(htmlOnly('TABBYCAT_API_TABS=0'), NAV)).toEqual(NAV);
  });
});

describe('fetchTabsFromApi — private or unreleased tabs are not scraped', () => {
  it('reads nothing past preferences when neither tab is released', async () => {
    const { fetcher, seen } = mockHost(fullHost({ preferences: { status: 200, body: released(false, false) } }));
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res).toEqual({
      teams: { source: 'private', reason: 'team tab not released' },
      speakers: { source: 'private', reason: 'speaker tab not released' },
    });
    expect(seen).toEqual(['preferences']);
    // Even with nav URLs in hand (linked or constructed), no HTML tab fetch.
    expect(htmlTabsToFetch(res, NAV)).toEqual({ teamTab: null, speakerTab: null });
  });

  it('keeps a released tab and withholds the unreleased one', async () => {
    const { fetcher, seen } = mockHost(fullHost({ preferences: { status: 200, body: released(true, false) } }));
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res.teams.source).toBe('api');
    expect(res.speakers).toEqual({ source: 'private', reason: 'speaker tab not released' });
    expect(seen).not.toContain('speakers');
    expect(seen).not.toContain('speakers/standings');
    expect(seen).not.toContain('speakers/standings/rounds');
    expect(htmlTabsToFetch(res, NAV)).toEqual({ teamTab: null, speakerTab: null });
  });

  it('a private tab stays private even when the rest of the API fails', async () => {
    const { fetcher } = mockHost(fullHost({
      preferences: { status: 200, body: released(false, true) },
      teams: { status: 500, body: {} },
    }));
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res.teams.source).toBe('private');
    expect(res.speakers).toEqual({ source: 'html', reason: 'teams: HTTP 500' });
    expect(htmlTabsToFetch(res, NAV)).toEqual({ teamTab: null, speakerTab: NAV.speakerTab });
  });
});

describe('fetchTabsFromApi — malformed API data', () => {
  it('falls back when a list arrives as an object (error envelope, pagination)', async () => {
    const { fetcher } = mockHost(fullHost({ teams: { status: 200, body: { count: 1, next: null, results: [team] } } }));
    expect(await fetchTabsFromApi(PRIVATE_URL, fetcher)).toEqual(htmlOnly('teams: not a list'));
  });

  it('falls back when a row has the wrong shape for a field the mapping reads', async () => {
    const { fetcher } = mockHost(fullHost({
      'teams/standings': { status: 200, body: [{ rank: 1, team: team.url, metrics: 'points=6' }] },
    }));
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res.teams.source).toBe('html');
    if (res.teams.source === 'html') expect(res.teams.reason).toMatch(/^teams\/standings: malformed at \[0\.metrics\]/);
    expect(res.speakers.source).toBe('api');
  });

  it('refuses speakers without an anonymous flag rather than risk printing an opted-out name', async () => {
    const { anonymous: _drop, ...noFlag } = alice;
    const { fetcher } = mockHost(fullHost({ speakers: { status: 200, body: [noFlag] } }));
    const res = await fetchTabsFromApi(PRIVATE_URL, fetcher);
    expect(res.speakers.source).toBe('html');
    if (res.speakers.source === 'html') expect(res.speakers.reason).toMatch(/^speakers: malformed at \[0\.anonymous\]/);
  });

  it('falls back when scores arrive as strings', async () => {
    const { fetcher } = mockHost(fullHost({
      'speakers/standings': { status: 200, body: [{ rank: 1, speaker: alice.url, metrics: [{ metric: 'total', value: '152' }] }] },
    }));
    expect((await fetchTabsFromApi(PRIVATE_URL, fetcher)).speakers.source).toBe('html');
  });

  it('falls back when standings point at teams the team list does not have', async () => {
    const { fetcher } = mockHost(fullHost({
      'teams/standings': { status: 200, body: [{ rank: 1, team: `${B}/teams/404`, metrics: [] }] },
    }));
    expect((await fetchTabsFromApi(PRIVATE_URL, fetcher)).teams).toEqual({ source: 'html', reason: 'teams/standings: no rows' });
  });
});

describe('tabReleaseFromPreferences', () => {
  it('reads released, private, limited and unknown', () => {
    expect(tabReleaseFromPreferences(released(true, false))).toEqual({ teams: 'released', speakers: 'private' });
    expect(tabReleaseFromPreferences(released(true, true, { team: 16 }))).toEqual({ teams: 'limited', speakers: 'released' });
    expect(tabReleaseFromPreferences(released(undefined, undefined))).toEqual({ teams: 'unknown', speakers: 'unknown' });
    // Only a literal false withholds; anything unexpected is "unknown", which
    // still goes through the API's own gate (unreleased standings answer 401).
    expect(tabReleaseFromPreferences([{ identifier: 'tab_release__team_tab_released', value: 'yes' }]).teams).toBe('unknown');
  });
});
