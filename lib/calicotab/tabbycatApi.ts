import type { SpeakerTabRow, TeamTabRow } from './parseTabs';

/**
 * Tabbycat's own REST API (`/api/v1/`, v2.8+) as a source for the team and
 * speaker tabs, in place of scraping the Vue table blobs out of the
 * `/tab/team/` and `/tab/speaker/` HTML.
 *
 * Why bother when the HTML path works: the scraper is pinned to markup that
 * Tabbycat changes between releases (the 2.11 move from ESL/EFL RANK columns
 * to a categories column silently nulled every ESL rank in a 625-tournament
 * sweep — see SpeakerTabRow.categories). The API is versioned JSON with an
 * OpenAPI schema, and three standings calls carry what two HTML pages plus
 * their popovers do, including per-round speaker positions the speaker tab
 * never renders.
 *
 * This module is deliberately NOT wired into ingest yet. It produces the
 * same TeamTabRow / SpeakerTabRow shapes as parseTeamTab / parseSpeakerTab
 * so that tests/__tabbycatApi.live.test.ts can diff the two on live
 * tournaments; switching ingest over is a separate, measured change.
 *
 * Privacy: the API applies the tournament's own release settings — a
 * standings endpoint for an unreleased tab answers 403/404, and a speaker
 * who opted out comes back with `anonymous: true` and a null name. Both are
 * honoured here exactly as the HTML path honours them: an unavailable
 * endpoint is reported as such (the caller falls back to HTML, which will
 * be private too), and anonymous speakers keep Tabbycat's own redaction
 * label so findRedactedOwnerRow treats them identically.
 */

// ── Raw API shapes (only the fields read here) ──────────────────────────────

export type ApiSpeaker = {
  url: string;
  name: string | null;
  team?: string;
  categories: string[];
  anonymous: boolean;
};

export type ApiTeam = {
  url: string;
  reference: string | null;
  short_name: string;
  long_name: string;
  speakers: ApiSpeaker[];
};

export type ApiMetric = { metric: string; value: number | null };

export type ApiTeamStanding = { rank: number | null; tied: boolean; metrics: ApiMetric[]; team: string };

/** `speaker` is null for an opted-out speaker: the API unlinks the row. */
export type ApiSpeakerStanding = { rank: number | null; tied: boolean; metrics: ApiMetric[]; speaker: string | null };

export type ApiSpeakerRoundStanding = {
  speaker: string;
  rounds: Array<{
    round: string;
    speeches: Array<{ score: number | null; position: number | null; ghost: boolean }>;
  }>;
};

export type ApiRound = { url: string; seq: number; abbreviation: string; stage: string };

export type ApiSpeakerCategory = { url: string; name: string; public: boolean };

// ── URL handling ────────────────────────────────────────────────────────────

/**
 * `https://host/<slug>/anything` → `https://host/api/v1/tournaments/<slug>`.
 * Private URLs, tab pages and landing pages all share the first path
 * segment as the tournament slug. Null when there is no slug to take.
 */
export function apiBaseFromTournamentUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const slug = parsed.pathname.split('/').filter(Boolean)[0];
  if (!slug || slug === 'api') return null;
  return `${parsed.protocol}//${parsed.host}/api/v1/tournaments/${slug}`;
}

// ── Mapping ─────────────────────────────────────────────────────────────────

/** What the HTML speaker tab renders for an opted-out speaker. */
export const API_REDACTED_NAME = '<em>Redacted</em>';

// The HTML tab collapses runs of whitespace (a tab character inside one
// registered name was the only name mismatch on WUDC 2024); match it.
function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function metric(metrics: ApiMetric[], key: string): number | null {
  const found = metrics.find((m) => m.metric === key);
  return typeof found?.value === 'number' ? found.value : null;
}

/**
 * The HTML tabs display two decimals, and that is what every stored score
 * came from. Panel-averaged formats (Australs, most two-team circuits) have
 * thirds — 78.333… on the API, 78.33 on the tab — so round to match, or a
 * re-ingest through the API would rewrite every such score and trip the
 * regression guard for nothing.
 */
function round2(n: number | null | undefined): number | null {
  return n == null ? null : Math.round(n * 100) / 100;
}

/**
 * `long_name` is "<institution> <reference>" ("Amherst College GD" / "GD").
 * The institutions endpoint needs an API token on calicotab, so this is the
 * only public place the full institution name appears. Null when the long
 * name doesn't end in the reference (unaffiliated or renamed teams) rather
 * than guessing at a split.
 */
export function institutionFromTeam(team: Pick<ApiTeam, 'long_name' | 'reference'>): string | null {
  const ref = team.reference?.trim();
  const long = team.long_name?.trim();
  if (!ref || !long || !long.endsWith(` ${ref}`)) return null;
  const institution = long.slice(0, -ref.length - 1).trim();
  return institution || null;
}

function speakerDisplayName(s: ApiSpeaker): string {
  if (s.anonymous || !s.name) return API_REDACTED_NAME;
  return cleanName(s.name);
}

/**
 * parseTeamTab fills totalPoints from the points column, or — on two-team
 * formats, which rank on wins and have no points column — from the team
 * speaker-score column (teamTabFromVue's ptsCol fallback). Mirror that
 * (Australs 2022: speaks_sum 2185.166667 → 2185.17).
 */
function teamTotal(metrics: ApiMetric[]): number | null {
  const points = metric(metrics, 'points');
  if (points != null) return points;
  return round2(metric(metrics, 'speaks_sum'));
}

export function mapTeamStandings(teams: ApiTeam[], standings: ApiTeamStanding[]): TeamTabRow[] {
  const byUrl = new Map(teams.map((t) => [t.url, t]));
  const rows: TeamTabRow[] = [];
  for (const st of standings) {
    const team = byUrl.get(st.team);
    if (!team) continue;
    rows.push({
      rank: st.rank,
      teamName: cleanName(team.short_name),
      institution: institutionFromTeam(team),
      speakers: team.speakers.map(speakerDisplayName),
      wins: metric(st.metrics, 'wins'),
      totalPoints: teamTotal(st.metrics),
      firsts: metric(st.metrics, 'firsts'),
      seconds: metric(st.metrics, 'seconds'),
    });
  }
  return rows;
}

export function mapSpeakerStandings(input: {
  speakers: ApiSpeaker[];
  teams: ApiTeam[];
  standings: ApiSpeakerStanding[];
  roundStandings: ApiSpeakerRoundStanding[];
  rounds: ApiRound[];
  categories: ApiSpeakerCategory[];
}): SpeakerTabRow[] {
  const speakerByUrl = new Map(input.speakers.map((s) => [s.url, s]));
  const teamByUrl = new Map(input.teams.map((t) => [t.url, t]));
  const roundByUrl = new Map(input.rounds.map((r) => [r.url, r]));
  const roundsBySpeaker = new Map(input.roundStandings.map((r) => [r.speaker, r.rounds]));
  // Only categories the tournament publishes. A private category (an
  // equity-only "Novice" bracket, say) is tagging the public tab never shows.
  const publicCategory = new Map(input.categories.filter((c) => c.public).map((c) => [c.url, c.name]));

  // The HTML tab has one column per preliminary round, in order, with an
  // empty cell where the speaker did not speak; outrounds are not on it.
  // The API lists only rounds actually spoken, outrounds included.
  const prelims = input.rounds.filter((r) => r.stage === 'P').sort((a, b) => a.seq - b.seq);
  const prelimUrls = new Set(prelims.map((r) => r.url));

  const scoresFor = (speakerUrl: string): SpeakerTabRow['roundScores'] => {
    const byRound = new Map<string, number | null>();
    for (const r of roundsBySpeaker.get(speakerUrl) ?? []) {
      if (!prelimUrls.has(r.round) || !roundByUrl.has(r.round)) continue;
      // An iron-person round has two speeches, one flagged `ghost` — the
      // extra speech that does not count towards the speaker's total. The
      // HTML cell shows the counted one (checked on WUDC 2024, where the
      // two differ by a point), so prefer the non-ghost speech.
      const speech = r.speeches.find((s) => !s.ghost) ?? r.speeches[0];
      byRound.set(r.round, round2(speech?.score));
    }
    return prelims.map((r) => ({ roundLabel: r.abbreviation, score: byRound.get(r.url) ?? null, positionLabel: null }));
  };
  const publicCategoriesOf = (s: ApiSpeaker) =>
    s.categories.map((c) => publicCategory.get(c)).filter((c): c is string => !!c);

  // Opted-out speakers: the standings row is unlinked (`speaker: null`) but
  // the per-round endpoint still lists them under their URL. The HTML tab
  // shows such a row as "Redacted" with its scores and categories and no
  // team, so recover the scores by the one anonymous speaker whose prelim
  // scores sum to the row's total — and only when exactly one does. The
  // team is never attached: that link is what the speaker opted out of.
  const anonymous = input.speakers.filter((s) => s.anonymous).map((s) => ({ s, scores: scoresFor(s.url) }));
  const claimed = new Set<string>();
  const anonymousMatch = (total: number | null) => {
    if (total == null) return null;
    // Within 0.1, not exact: the per-round scores are rounded to two
    // decimals, and nine rounded thirds drift from the rounded total.
    const hits = anonymous.filter(
      (a) => !claimed.has(a.s.url) && Math.abs(a.scores.reduce((sum, r) => sum + (r.score ?? 0), 0) - total) < 0.1,
    );
    if (hits.length !== 1) return null;
    claimed.add(hits[0].s.url);
    return hits[0];
  };

  const rows: SpeakerTabRow[] = [];
  for (const st of input.standings) {
    const totalScore = round2(metric(st.metrics, 'total'));
    if (st.speaker == null) {
      const match = anonymousMatch(totalScore);
      rows.push({
        rank: st.rank,
        rankEsl: null,
        rankEfl: null,
        categories: match ? publicCategoriesOf(match.s) : [],
        speakerName: API_REDACTED_NAME,
        teamName: null,
        institution: null,
        totalScore,
        roundScores: match ? match.scores : prelims.map((r) => ({ roundLabel: r.abbreviation, score: null, positionLabel: null })),
      });
      continue;
    }
    const speaker = speakerByUrl.get(st.speaker);
    if (!speaker) continue;
    const team = speaker.team ? teamByUrl.get(speaker.team) : undefined;
    rows.push({
      rank: st.rank,
      rankEsl: null,
      rankEfl: null,
      categories: publicCategoriesOf(speaker),
      speakerName: speakerDisplayName(speaker),
      teamName: team ? cleanName(team.short_name) : null,
      institution: team ? institutionFromTeam(team) : null,
      totalScore,
      roundScores: scoresFor(st.speaker),
    });
  }
  return rows;
}

// ── Fetching ────────────────────────────────────────────────────────────────

const API_HEADERS: Record<string, string> = {
  // Same browser fingerprint as fetch.ts: calicotab sits behind Cloudflare,
  // which 403s non-browser user agents on the HTML paths and the API alike.
  'User-Agent':
    process.env.TABBYCAT_USER_AGENT ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

/**
 * Ingest reads the team and speaker tabs from the API by default (owner
 * decision, 2026-10-20). TABBYCAT_API_TABS=0 is the kill switch back to
 * HTML-only.
 *
 * Deliberately no PARSER_VERSION bump (same decision): cached tournaments
 * keep their HTML-derived rows, and only new or re-ingested ones pick up what
 * the API adds (institutions, swing-team scores).
 */
export function tabbycatApiTabsEnabled(): boolean {
  return process.env.TABBYCAT_API_TABS !== '0';
}

export type ApiTabsResult =
  | { kind: 'ok'; teams: TeamTabRow[]; speakers: SpeakerTabRow[] }
  | { kind: 'unavailable'; reason: string };

type Fetcher = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

const defaultFetcher: Fetcher = (url) => fetch(url, { headers: API_HEADERS });

/**
 * Fetch both tabs from the API. Requests run one after another — the same
 * politeness the HTML path keeps per host — and any non-200 (API disabled,
 * tab unreleased, older Tabbycat with no /api) returns `unavailable` so the
 * caller can fall back to HTML.
 */
export async function fetchTabsFromApi(tournamentUrl: string, fetcher: Fetcher = defaultFetcher): Promise<ApiTabsResult> {
  const base = apiBaseFromTournamentUrl(tournamentUrl);
  if (!base) return { kind: 'unavailable', reason: 'no tournament slug in URL' };

  const paths = [
    'teams',
    'speakers',
    'rounds',
    'speaker-categories',
    'teams/standings',
    'speakers/standings',
    'speakers/standings/rounds',
  ] as const;
  const out: Partial<Record<(typeof paths)[number], unknown>> = {};
  for (const path of paths) {
    let res: Awaited<ReturnType<Fetcher>>;
    try {
      res = await fetcher(`${base}/${path}`);
    } catch (err) {
      return { kind: 'unavailable', reason: `${path}: ${(err as Error).message}` };
    }
    if (res.status !== 200) return { kind: 'unavailable', reason: `${path}: HTTP ${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // A 200 HTML page (Cloudflare challenge, or a pre-2.8 install routing
      // /api to its 404 template) is not an API.
      return { kind: 'unavailable', reason: `${path}: not JSON` };
    }
    if (!Array.isArray(body)) return { kind: 'unavailable', reason: `${path}: not a list` };
    out[path] = body;
  }

  const teams = out.teams as ApiTeam[];
  return {
    kind: 'ok',
    teams: mapTeamStandings(teams, out['teams/standings'] as ApiTeamStanding[]),
    speakers: mapSpeakerStandings({
      speakers: out.speakers as ApiSpeaker[],
      teams,
      standings: out['speakers/standings'] as ApiSpeakerStanding[],
      roundStandings: out['speakers/standings/rounds'] as ApiSpeakerRoundStanding[],
      rounds: out.rounds as ApiRound[],
      categories: out['speaker-categories'] as ApiSpeakerCategory[],
    }),
  };
}
