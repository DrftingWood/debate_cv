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
 * It produces the same TeamTabRow / SpeakerTabRow shapes as parseTeamTab /
 * parseSpeakerTab, so ingest can take either (tests/__tabbycatApi.live.test.ts
 * diffs the two on live tournaments). Ingest asks here first and falls back
 * to the HTML tabs — see chooseTabSources for the exact rules.
 *
 * Privacy: the tournament's own release settings win over both sources.
 * Tabbycat publishes its preferences at `/preferences` without a token, and
 * when they say a tab is not released (`tab_release__*_tab_released: false`)
 * the result is `private` and ingest does not fetch that tab's HTML either —
 * nav.ts can construct a tab URL the landing page never linked, and the
 * point is not to scrape around the organisers' decision. A tab released
 * only to the top N (`*_tab_limit`) is left to the HTML page, which shows
 * exactly that cut. Speakers who opted out come back with `anonymous: true`
 * and keep Tabbycat's own redaction label, so findRedactedOwnerRow treats
 * them identically on both paths.
 */
import { z } from 'zod';

// ── Raw API shapes (only the fields read here; schemas under Validation) ────

export type ApiSpeaker = z.infer<typeof apiSpeakerSchema>;
export type ApiTeam = z.infer<typeof apiTeamSchema>;
export type ApiMetric = z.infer<typeof metricSchema>;
export type ApiTeamStanding = z.infer<typeof apiTeamStandingSchema>;
/** `speaker` is null for an opted-out speaker: the API unlinks the row. */
export type ApiSpeakerStanding = z.infer<typeof apiSpeakerStandingSchema>;
export type ApiSpeakerRoundStanding = z.infer<typeof apiSpeakerRoundStandingSchema>;
export type ApiRound = z.infer<typeof apiRoundSchema>;
export type ApiSpeakerCategory = z.infer<typeof apiSpeakerCategorySchema>;

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
export function cleanName(name: string): string {
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
      // two differ by a point), so prefer the non-ghost speech. A round whose
      // speeches are ALL ghosts (a lone ghost, or both halves of an
      // iron-person pair) counts for nothing: the HTML cell is empty and the
      // published total excludes it, so it stays null rather than falling
      // back to speeches[0] (WUDC 2024 had three such speakers).
      const speech = r.speeches.find((s) => !s.ghost);
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

// ── Validation ──────────────────────────────────────────────────────────────
//
// Every list is checked against the fields mapping reads before any of it is
// used. A Tabbycat release that renames a field, a proxy that answers with a
// JSON error object, or a half-written response must cost one HTML fallback,
// not a thrown TypeError halfway through an ingest — and never a row with a
// silently missing `anonymous` flag, which is what keeps opted-out names off
// the CV. Fields the mapping never reads are not required, so an unrelated
// schema change does not knock a tournament off the API.

const metricSchema = z.object({ metric: z.string(), value: z.number().nullable() });

export const apiSpeakerSchema = z.object({
  url: z.string(),
  name: z.string().nullable(),
  team: z.string().nullish(),
  categories: z.array(z.string()),
  anonymous: z.boolean(),
});

const apiTeamSchema = z.object({
  url: z.string(),
  reference: z.string().nullable(),
  short_name: z.string(),
  long_name: z.string(),
  speakers: z.array(apiSpeakerSchema),
});

const apiTeamStandingSchema = z.object({
  rank: z.number().nullable(),
  tied: z.boolean().optional(),
  metrics: z.array(metricSchema),
  team: z.string(),
});

const apiSpeakerStandingSchema = z.object({
  rank: z.number().nullable(),
  tied: z.boolean().optional(),
  metrics: z.array(metricSchema),
  speaker: z.string().nullable(),
});

const apiSpeakerRoundStandingSchema = z.object({
  speaker: z.string(),
  rounds: z.array(
    z.object({
      round: z.string(),
      speeches: z.array(z.object({ score: z.number().nullable(), position: z.number().nullable().optional(), ghost: z.boolean() })),
    }),
  ),
});

const apiRoundSchema = z.object({ url: z.string(), seq: z.number(), abbreviation: z.string(), stage: z.string() });

const apiSpeakerCategorySchema = z.object({ url: z.string(), name: z.string(), public: z.boolean() });

const apiPreferenceSchema = z.object({ identifier: z.string(), value: z.unknown() });

const ENDPOINTS = {
  preferences: apiPreferenceSchema,
  teams: apiTeamSchema,
  speakers: apiSpeakerSchema,
  rounds: apiRoundSchema,
  'speaker-categories': apiSpeakerCategorySchema,
  'teams/standings': apiTeamStandingSchema,
  'speakers/standings': apiSpeakerStandingSchema,
  'speakers/standings/rounds': apiSpeakerRoundStandingSchema,
} as const;
type Endpoint = keyof typeof ENDPOINTS;
type EndpointRow<E extends Endpoint> = z.infer<(typeof ENDPOINTS)[E]>;

// ── Release settings ────────────────────────────────────────────────────────

/**
 * What the tournament's own preferences say about one tab:
 * - `released`: public in full;
 * - `private`: not released — neither source may be read;
 * - `limited`: released to the top N only. The standings endpoints ignore
 *   the limit (a top-3 speaker tab answered all 142 rows on mace.calicotab
 *   in 2026-10), so only the HTML page shows the public cut;
 * - `unknown`: preferences not readable on this install.
 */
export type TabRelease = 'released' | 'private' | 'limited' | 'unknown';

export function tabReleaseFromPreferences(
  prefs: ReadonlyArray<{ identifier: string; value?: unknown }>,
): { teams: TabRelease; speakers: TabRelease } {
  const value = (key: string) => prefs.find((p) => p.identifier === key)?.value;
  const release = (tab: 'team' | 'speaker'): TabRelease => {
    const released = value(`tab_release__${tab}_tab_released`);
    if (released === false) return 'private';
    if (released !== true) return 'unknown';
    const limit = value(`tab_release__${tab}_tab_limit`);
    return typeof limit === 'number' && limit > 0 ? 'limited' : 'released';
  };
  return { teams: release('team'), speakers: release('speaker') };
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

/** Same per-request ceiling as fetch.ts: a hung host must not eat the 60s function budget. */
export const API_TIMEOUT_MS = 15_000;

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

/**
 * Where one tab's rows come from:
 * - `api`: use these rows, skip the HTML page;
 * - `html`: the API could not answer (absent, disabled, refused, malformed,
 *   or a limited tab) — scrape the HTML page as before;
 * - `private`: the tournament has not released this tab. Read nothing.
 */
export type TabOutcome<Row> =
  | { source: 'api'; rows: Row[] }
  | { source: 'html'; reason: string }
  | { source: 'private'; reason: string };

export type ApiTabsResult = { teams: TabOutcome<TeamTabRow>; speakers: TabOutcome<SpeakerTabRow> };

export function htmlOnly(reason: string): ApiTabsResult {
  return { teams: { source: 'html', reason }, speakers: { source: 'html', reason } };
}

/**
 * Which HTML tab pages ingest should still fetch, given the API's answer.
 * The nav URL is only ever used when the API sent us back to HTML — never
 * when it answered, and never for a tab the tournament keeps private (nav
 * can construct a tab URL the landing page did not link).
 */
export function htmlTabsToFetch(
  result: ApiTabsResult,
  nav: { teamTab: string | null; speakerTab: string | null },
): { teamTab: string | null; speakerTab: string | null } {
  return {
    teamTab: result.teams.source === 'html' ? nav.teamTab : null,
    speakerTab: result.speakers.source === 'html' ? nav.speakerTab : null,
  };
}

/**
 * Warnings for tabs the tournament itself says are not released.
 *
 * A `private` tab reads neither the API nor the HTML page, so a tournament
 * whose participants page still loads would ingest with zero team and speaker
 * rows and nothing to say why — the HTML path used to 403, abort and retry.
 * Naming it in fetchWarnings puts it on the ParserRun (shown by /cv/verify)
 * and, deliberately, stops a re-ingest of an already-populated tournament
 * from running the tournament-wide refresh against empty rows. The prefix is
 * not `fetch:`, so it never fails the job: an unreleased tab is a fact about
 * the tournament, not a fault to retry three times.
 */
export function unreleasedTabWarnings(result: ApiTabsResult): string[] {
  const warnings: string[] = [];
  if (result.teams.source === 'private') warnings.push(`tabs: ${result.teams.reason}`);
  if (result.speakers.source === 'private') warnings.push(`tabs: ${result.speakers.reason}`);
  return warnings;
}

export type Fetcher = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

const defaultFetcher: Fetcher = (url) =>
  fetch(url, { headers: API_HEADERS, signal: AbortSignal.timeout(API_TIMEOUT_MS) });

/**
 * 429/503, or no answer at all (timeout, connection error): the host wants
 * fewer requests, not different ones. Retrying the API here would only
 * compete with the HTML fallback for the same per-host slot.
 */
export function isHostPushback(got: { status: number | null }): boolean {
  return got.status === null || got.status === 429 || got.status === 503;
}

export type Got<T> = { ok: true; rows: T[] } | { ok: false; status: number | null; reason: string };

async function getList<E extends Endpoint>(fetcher: Fetcher, base: string, path: E): Promise<Got<EndpointRow<E>>> {
  return getApiList(fetcher, base, path, ENDPOINTS[path]) as Promise<Got<EndpointRow<E>>>;
}

/**
 * One list endpoint, validated against `schema`. Shared with
 * tabbycatApiRounds.ts so both modules fail the same way: every problem is a
 * reason string for the HTML fallback, never a throw.
 */
export async function getApiList<S extends z.ZodTypeAny>(
  fetcher: Fetcher,
  base: string,
  path: string,
  schema: S,
): Promise<Got<z.infer<S>>> {
  let res: Awaited<ReturnType<Fetcher>>;
  try {
    res = await fetcher(`${base}/${path}`);
  } catch (err) {
    return { ok: false, status: null, reason: `${path}: ${(err as Error).message}` };
  }
  if (res.status !== 200) return { ok: false, status: res.status, reason: `${path}: HTTP ${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // A 200 HTML page (Cloudflare challenge, or a pre-2.8 install routing
    // /api to its 404 template) is not an API.
    return { ok: false, status: 200, reason: `${path}: not JSON` };
  }
  if (!Array.isArray(body)) return { ok: false, status: 200, reason: `${path}: not a list` };
  const parsed = z.array(schema).safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, status: 200, reason: `${path}: malformed at [${issue.path.join('.')}] — ${issue.message}` };
  }
  return { ok: true, rows: parsed.data as z.infer<S>[] };
}

/**
 * Ask the API for both tabs. Requests run one after another — the same
 * politeness the HTML path keeps per host.
 *
 * Order matters: `/preferences` comes first, so a tournament that keeps its
 * tabs private costs one request and yields `private` before any standings
 * are touched. Everything else that goes wrong — no slug, no /api (pre-2.8
 * or not Tabbycat), 401/403/404, a timeout, non-JSON, a body that fails
 * validation, an empty tab — is `html`: the caller scrapes exactly as it did
 * before the API existed. On calicotab an unreleased standings endpoint also
 * answers 401, so even where preferences are unreadable the fallback can only
 * reach an HTML tab the nav links, which Tabbycat gates the same way.
 */
export async function fetchTabsFromApi(tournamentUrl: string, fetcher: Fetcher = defaultFetcher): Promise<ApiTabsResult> {
  const base = apiBaseFromTournamentUrl(tournamentUrl);
  if (!base) return htmlOnly('no tournament slug in URL');

  const prefs = await getList(fetcher, base, 'preferences');
  // A 404, a non-JSON 200 or a network failure/timeout here means "no API
  // on this host" or "host not answering", not "preferences hidden": nothing
  // further will answer either, and each try can cost API_TIMEOUT_MS of the
  // function budget, so stop. A 401/403 only hides the preferences — go on.
  if (!prefs.ok && (prefs.status === null || prefs.status === 404 || prefs.reason.endsWith('not JSON'))) {
    return htmlOnly(prefs.reason);
  }
  const release = prefs.ok ? tabReleaseFromPreferences(prefs.rows) : { teams: 'unknown' as const, speakers: 'unknown' as const };

  const gate = (r: TabRelease, tab: string): TabOutcome<never> | null => {
    if (r === 'private') return { source: 'private', reason: `${tab} tab not released` };
    if (r === 'limited') return { source: 'html', reason: `${tab} tab released to top N only` };
    return null;
  };
  let teams: TabOutcome<TeamTabRow> | null = gate(release.teams, 'team');
  let speakers: TabOutcome<SpeakerTabRow> | null = gate(release.speakers, 'speaker');
  if (teams && speakers) return { teams, speakers };

  const teamList = await getList(fetcher, base, 'teams');
  if (!teamList.ok) {
    return { teams: teams ?? { source: 'html', reason: teamList.reason }, speakers: speakers ?? { source: 'html', reason: teamList.reason } };
  }

  if (!teams) {
    const standings = await getList(fetcher, base, 'teams/standings');
    if (!standings.ok) {
      teams = { source: 'html', reason: standings.reason };
      // The host is pushing back or not answering: the speaker tab would be
      // five more requests into the same wall. Leave both to the HTML path,
      // whose retries and learned backoff are built for exactly this.
      if (isHostPushback(standings)) return { teams, speakers: speakers ?? { source: 'html', reason: standings.reason } };
    } else {
      const rows = mapTeamStandings(teamList.rows, standings.rows);
      teams = rows.length > 0 ? { source: 'api', rows } : { source: 'html', reason: 'teams/standings: no rows' };
    }
  }

  if (!speakers) {
    speakers = await fetchSpeakerTab(fetcher, base, teamList.rows);
  }
  return { teams, speakers };
}

async function fetchSpeakerTab(fetcher: Fetcher, base: string, teams: ApiTeam[]): Promise<TabOutcome<SpeakerTabRow>> {
  const speakerList = await getList(fetcher, base, 'speakers');
  if (!speakerList.ok) return { source: 'html', reason: speakerList.reason };
  const rounds = await getList(fetcher, base, 'rounds');
  if (!rounds.ok) return { source: 'html', reason: rounds.reason };
  const categories = await getList(fetcher, base, 'speaker-categories');
  if (!categories.ok) return { source: 'html', reason: categories.reason };
  const standings = await getList(fetcher, base, 'speakers/standings');
  if (!standings.ok) return { source: 'html', reason: standings.reason };
  const roundStandings = await getList(fetcher, base, 'speakers/standings/rounds');
  if (!roundStandings.ok) return { source: 'html', reason: roundStandings.reason };
  const rows = mapSpeakerStandings({
    speakers: speakerList.rows,
    teams,
    standings: standings.rows,
    roundStandings: roundStandings.rows,
    rounds: rounds.rows,
    categories: categories.rows,
  });
  return rows.length > 0 ? { source: 'api', rows } : { source: 'html', reason: 'speakers/standings: no rows' };
}
