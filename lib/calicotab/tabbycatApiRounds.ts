import { z } from 'zod';
import { stripAttendanceTag } from './names';
import {
  breakPageKind,
  roundIdentity,
  type BreakRow,
  type ParticipantsRow,
  type RoundDebate,
} from './parseTabs';
import {
  API_REDACTED_NAME,
  apiBaseFromTournamentUrl,
  cleanName,
  getApiList,
  isHostPushback,
  type Fetcher,
} from './tabbycatApi';

/**
 * Tabbycat's REST API as a source for the pages ingest still scrapes after
 * the team and speaker tabs moved over (B8): round results, the break, and
 * the participants list.
 *
 * Same contract as tabbycatApi.ts: each page comes back either as rows in
 * the exact shape its HTML parser returns (parseRoundResults,
 * parseBreakPage, parseParticipantsList), or as a reason to scrape that
 * page as before. Nothing here throws, and nothing here is reached for a
 * page the landing-page nav did not link — the caller passes the nav's own
 * URLs, so a round whose results are unreleased is never asked about.
 *
 * Privacy: the tournament's public_features preferences win. A page the
 * tournament has switched off (public_results, public_breaking_teams,
 * public_breaking_adjs, public_participants) is not read from the API even
 * if an endpoint would answer — it falls back to HTML, which Tabbycat gates
 * the same way. Opted-out (`anonymous`) adjudicators and speakers never get
 * their names into a row: on the break and participants pages they appear as
 * API_REDACTED_NAME, exactly as the HTML lists them, so ingest sees the same
 * rows from either source; in round results they are left out, as the HTML
 * results table never names them either.
 *
 * Requests, per tournament, against what they replace:
 *   rounds:       teams/standings/rounds (1) + adjudicators (1) + rounds (1)
 *                 + one pairings call per linked round — replaces one HTML
 *                 page per linked round (two, when by-debate is missing);
 *   break:        break-categories (1) + one call per linked team category
 *                 (adjudicators reuse the adjudicators list) — replaces one
 *                 HTML page per linked break tab;
 *   participants: reuses speakers + adjudicators + teams — replaces one page.
 * So about three more requests than HTML on a typical tournament, against
 * the same per-host slot.
 */

// ── Shapes (only the fields read here) ──────────────────────────────────────

const adjudicatorSchema = z.object({
  url: z.string(),
  name: z.string().nullable(),
  anonymous: z.boolean(),
  breaking: z.boolean().optional(),
  adj_core: z.boolean().optional(),
  independent: z.boolean().optional(),
  /** Present only where the tournament shows adjudicator institutions; a URL we cannot name. */
  institution: z.string().nullish(),
});

const teamRoundStandingSchema = z.object({
  team: z.string(),
  rounds: z.array(
    z.object({
      round: z.string(),
      points: z.number().nullable(),
      win: z.boolean().nullable(),
      side: z.string().nullable(),
    }),
  ),
});

const pairingSchema = z.object({
  teams: z.array(z.object({ team: z.string(), side: z.string().nullable() })),
  adjudicators: z
    .object({
      chair: z.string().nullable(),
      panellists: z.array(z.string()),
      trainees: z.array(z.string()),
    })
    .nullable(),
});

const roundSchema = z.object({ url: z.string(), seq: z.number(), name: z.string() });

const breakCategorySchema = z.object({ url: z.string(), slug: z.string(), name: z.string() });

const breakingTeamSchema = z.object({ team: z.string(), rank: z.number().nullable() });

const teamSchema = z.object({
  url: z.string(),
  short_name: z.string(),
  speakers: z.array(z.object({ url: z.string(), name: z.string().nullable(), anonymous: z.boolean() })),
});

// A metric value is a number on most installs and a numeric string on some
// (Australs 2025's third metric); only `points` is read, through metricNumber.
const teamStandingSchema = z.object({
  team: z.string(),
  metrics: z.array(z.object({ metric: z.string(), value: z.union([z.number(), z.string()]).nullable() })),
});

function metricNumber(metrics: ApiTeamStandingLite['metrics'], key: string): number | null {
  const v = metrics.find((m) => m.metric === key)?.value;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const preferenceSchema = z.object({ identifier: z.string(), value: z.unknown() });

export type ApiAdjudicator = z.infer<typeof adjudicatorSchema>;
export type ApiTeamRoundStanding = z.infer<typeof teamRoundStandingSchema>;
export type ApiPairing = z.infer<typeof pairingSchema>;
export type ApiBreakingTeam = z.infer<typeof breakingTeamSchema>;
export type ApiRoundsTeam = z.infer<typeof teamSchema>;
export type ApiTeamStandingLite = z.infer<typeof teamStandingSchema>;

// ── Mapping ─────────────────────────────────────────────────────────────────

const seqFromUrl = (url: string): number | null => {
  const m = url.match(/\/rounds\/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
};

/**
 * The position text the HTML results table shows for a side, under the
 * tournament's side-name preference (`debate_rules__side_names`, e.g.
 * "gov-opp", "prop-opp", "aff-neg"). Null when the side or the preference is
 * one this does not know — the HTML would show something we cannot guess, and
 * a null position is what the HTML path stores for a table with no side
 * column.
 */
const SIDE_NAME_PAIRS: Record<string, [string, string]> = {
  'gov-opp': ['Government', 'Opposition'],
  'prop-opp': ['Proposition', 'Opposition'],
  'aff-neg': ['Affirmative', 'Negative'],
  'pro-con': ['Pro', 'Con'],
  'appellant-respondent': ['Appellant', 'Respondent'],
  'claimant-respondent': ['Claimant', 'Respondent'],
  'aff-opp': ['Affirmative', 'Opposition'],
  'gov-gov': ['Government', 'Government'],
};

export function sidePositionLabel(side: string | null, sideNames: string | null): string | null {
  if (!side) return null;
  const pair = SIDE_NAME_PAIRS[sideNames ?? 'aff-neg'];
  if (!pair) return null;
  const [first, second] = pair;
  switch (side) {
    case 'og': return `Opening ${first}`;
    case 'oo': return `Opening ${second}`;
    case 'cg': return `Closing ${first}`;
    case 'co': return `Closing ${second}`;
    case 'aff': return first;
    case 'neg': return second;
    default: return null;
  }
}

function adjName(a: ApiAdjudicator | undefined): string | null {
  if (!a || a.anonymous || !a.name) return null;
  const name = stripAttendanceTag(cleanName(a.name));
  return name.length >= 2 ? name : null;
}

/** The name a list page shows: the real one, or the redaction for an opted-out person. */
function listedAdjName(a: ApiAdjudicator): string | null {
  return a.anonymous ? API_REDACTED_NAME : adjName(a);
}

/**
 * One round's results in the shape parseRoundResults returns.
 *
 * Team outcomes come from teams/standings/rounds, which carries every
 * team's side, points and win for every round. Outcome semantics follow the
 * HTML reader (readTeamOutcome):
 *   - BP prelim: points 3..0, and `won` only for first place (the HTML cell
 *     says "1st"); the API's `win` is always false there.
 *   - two-team prelim and every outround: `won` from the API, no points.
 * Judges come from that round's pairings: chair, panellists, trainees, named
 * from the adjudicators list, deduplicated by name and role as the HTML
 * reader does.
 */
export function mapRoundResults(input: {
  seq: number;
  sourceUrl: string;
  navLabel: string | null | undefined;
  apiRoundName: string | null;
  teamsInDebate: number;
  sideNames: string | null;
  teams: ApiRoundsTeam[];
  roundStandings: ApiTeamRoundStanding[];
  pairings: ApiPairing[];
  adjudicators: ApiAdjudicator[];
}): RoundDebate {
  const { roundNumber, roundLabel, isOutround } = roundIdentity(
    input.sourceUrl,
    input.navLabel,
    input.apiRoundName ?? '',
  );
  const teamByUrl = new Map(input.teams.map((t) => [t.url, t]));
  // BP from the preference, or from the sides themselves where an install
  // stores the preference in a form not recognised (see bpFromPreference).
  const BP_SIDES = new Set(['og', 'oo', 'cg', 'co']);
  const isBp =
    input.teamsInDebate === 4 ||
    input.roundStandings.some((st) => st.rounds.some((r) => seqFromUrl(r.round) === input.seq && BP_SIDES.has(r.side ?? '')));

  const teamResults: RoundDebate['teamResults'] = [];
  for (const st of input.roundStandings) {
    const team = teamByUrl.get(st.team);
    if (!team) continue;
    for (const r of st.rounds) {
      if (seqFromUrl(r.round) !== input.seq) continue;
      // Drawn but no result (a bye, a team pulled after the draw: Habib 1 in
      // Australs 2022 round 3). The HTML results table has no row for it.
      if (r.points == null && r.win == null) continue;
      // Outrounds read "advancing"/"eliminated" on the page, i.e. the API's
      // win; the API gives them no points, but guard it rather than trust that.
      const bpPrelim = isBp && !isOutround && r.points != null;
      teamResults.push({
        teamName: cleanName(team.short_name),
        position: sidePositionLabel(r.side, input.sideNames),
        points: bpPrelim ? r.points : null,
        won: bpPrelim ? r.points === 3 : r.win,
      });
    }
  }

  const adjByUrl = new Map(input.adjudicators.map((a) => [a.url, a]));
  const judgeAssignments: RoundDebate['judgeAssignments'] = [];
  const seen = new Set<string>();
  const push = (url: string | null, panelRole: 'chair' | 'panel' | 'trainee') => {
    if (!url) return;
    const name = adjName(adjByUrl.get(url));
    if (!name) return;
    const key = `${name}|${panelRole}`;
    if (seen.has(key)) return;
    seen.add(key);
    judgeAssignments.push({ personName: name, panelRole });
  };
  for (const p of input.pairings) {
    if (!p.adjudicators) continue;
    push(p.adjudicators.chair, 'chair');
    for (const u of p.adjudicators.panellists) push(u, 'panel');
    for (const u of p.adjudicators.trainees) push(u, 'trainee');
  }

  return { roundNumber, roundLabel, isOutround, teamResults, judgeAssignments };
}

/**
 * One break tab in the shape parseBreakPage returns.
 *
 * Team rows: the HTML table's first column is the team's rank on the break
 * list, ties shown as "31=" (parseBreakPage reads 31), and teams with a
 * remark — "(different break)" on an ESL tab — are ranked like the rest.
 * The API's `rank` is that column (WUDC 2023-2025, SIDO, Australs). Score is
 * the team's standings points, the page's points column.
 *
 * Adjudicator rows are the adjudicators flagged `breaking`, with no rank or
 * score, as on the HTML page. Institution is null on both: the caller sends
 * any tournament that shows institutions to HTML (see fetchRestFromApi),
 * because the API only links them.
 */
export function mapBreakPage(input: {
  sourceUrl: string;
  breakingTeams?: ApiBreakingTeam[];
  teams: ApiRoundsTeam[];
  teamStandings: ApiTeamStandingLite[];
  adjudicators: ApiAdjudicator[];
}): BreakRow[] {
  const { isAdj, stage } = breakPageKind(input.sourceUrl);
  if (isAdj) {
    return input.adjudicators
      .filter((a) => a.breaking)
      .map((a) => listedAdjName(a))
      .filter((n): n is string => !!n)
      .map((entityName) => ({ rank: null, entityType: 'adjudicator', entityName, institution: null, score: null, stage }));
  }
  const teamByUrl = new Map(input.teams.map((t) => [t.url, t]));
  const pointsByTeam = new Map(input.teamStandings.map((s) => [s.team, metricNumber(s.metrics, 'points')]));
  const rows: BreakRow[] = [];
  for (const b of input.breakingTeams ?? []) {
    const team = teamByUrl.get(b.team);
    if (!team) continue;
    rows.push({
      rank: b.rank,
      entityType: 'team',
      entityName: cleanName(team.short_name),
      institution: null,
      score: pointsByTeam.get(b.team) ?? null,
      stage,
    });
  }
  return rows;
}

/**
 * Do these break ranks read the way a break table does — each team at its
 * position, or tied with the team above (1, 2, 2, 4)? IITB 2023's API skips
 * numbers (8, 10, 11) that its own page does not (8, 9, 10), and nothing in
 * the API says which the page will show, so a list that fails this goes to
 * HTML rather than store a rank the page never showed.
 */
export function breakRanksConsistent(ranks: Array<number | null>): boolean {
  let prev: number | null = null;
  for (let i = 0; i < ranks.length; i++) {
    const r = ranks[i];
    if (r == null) return false;
    if (r !== i + 1 && r !== prev) return false;
    prev = r;
  }
  return true;
}

/**
 * The participants list in the shape parseParticipantsList returns: every
 * speaker with their team, then every adjudicator with a judge tag from the
 * adj-core and independent flags (core outranks independent, as on the HTML
 * path). Opted-out participants are listed under API_REDACTED_NAME, as the
 * HTML list shows them.
 */
export function mapParticipants(input: { teams: ApiRoundsTeam[]; adjudicators: ApiAdjudicator[] }): ParticipantsRow[] {
  const rows: ParticipantsRow[] = [];
  for (const team of input.teams) {
    for (const s of team.speakers) {
      if (!s.anonymous && !s.name) continue;
      rows.push({
        name: s.anonymous || !s.name ? API_REDACTED_NAME : stripAttendanceTag(cleanName(s.name)),
        role: 'speaker',
        judgeTag: null,
        teamName: cleanName(team.short_name),
        institution: null,
      });
    }
  }
  for (const a of input.adjudicators) {
    const name = listedAdjName(a);
    if (!name) continue;
    rows.push({
      name,
      role: 'adjudicator',
      judgeTag: a.adj_core ? 'core' : a.independent ? 'invited' : 'normal',
      teamName: null,
      institution: null,
    });
  }
  return rows;
}

/**
 * Is this tournament British Parliamentary? `debate_rules__teams_in_debate`
 * read 4 on every install checked (2026-10), but Tabbycat's own choices for
 * it are "bp" / "two", so accept those spellings too. Anything else is
 * two-team, and mapRoundResults still recognises BP from the sides.
 */
export function bpFromPreference(value: unknown): boolean {
  return value === 4 || value === '4' || (typeof value === 'string' && value.toLowerCase() === 'bp');
}

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * Opt-in until the owner turns it on in production: TABBYCAT_API_ROUNDS=1
 * reads round results, the break and participants from the API. The team
 * and speaker tabs have their own switch (TABBYCAT_API_TABS, on by default).
 */
export function tabbycatApiRoundsEnabled(): boolean {
  return process.env.TABBYCAT_API_ROUNDS === '1';
}

export type PageOutcome<T> = { source: 'api'; value: T } | { source: 'html'; reason: string };

export type ApiRestResult = {
  /** Keyed by the nav's results-round URL. */
  rounds: Map<string, PageOutcome<RoundDebate>>;
  /** Keyed by the nav's break-tab URL. */
  breaks: Map<string, PageOutcome<BreakRow[]>>;
  participants: PageOutcome<ParticipantsRow[]> | null;
};

function allHtml(
  nav: { resultsRounds: string[]; breakTabs: string[]; participants: string | null },
  reason: string,
): ApiRestResult {
  return {
    rounds: new Map(nav.resultsRounds.map((u) => [u, { source: 'html', reason }])),
    breaks: new Map(nav.breakTabs.map((u) => [u, { source: 'html', reason }])),
    participants: nav.participants ? { source: 'html', reason } : null,
  };
}

/**
 * Ask the API for the round results, break tabs and participants list the
 * nav links. Requests run one after another, like fetchTabsFromApi. Any
 * page the API cannot answer cleanly is `html`, and the caller scrapes it.
 */
export async function fetchRestFromApi(
  tournamentUrl: string,
  nav: {
    resultsRounds: string[];
    resultsRoundLabels?: Record<string, string>;
    breakTabs: string[];
    participants: string | null;
  },
  fetcher: Fetcher,
): Promise<ApiRestResult> {
  const base = apiBaseFromTournamentUrl(tournamentUrl);
  if (!base) return allHtml(nav, 'no tournament slug in URL');

  const prefs = await getApiList(fetcher, base, 'preferences', preferenceSchema);
  if (!prefs.ok) return allHtml(nav, prefs.reason);
  const pref = (key: string) => prefs.rows.find((p) => p.identifier === key)?.value;
  // Only an explicit true opens a page to the API; an absent preference is
  // an install this was not checked against.
  const open = (key: string) => pref(key) === true;
  const teamsInDebate = bpFromPreference(pref('debate_rules__teams_in_debate')) ? 4 : 2;
  const sideNames = typeof pref('debate_rules__side_names') === 'string' ? (pref('debate_rules__side_names') as string) : null;

  const result: ApiRestResult = allHtml(nav, 'not attempted');
  const wantRounds = nav.resultsRounds.length > 0 && open('public_features__public_results');
  const wantTeamBreak = nav.breakTabs.some((u) => !breakPageKind(u).isAdj) && open('public_features__public_breaking_teams');
  const wantAdjBreak = nav.breakTabs.some((u) => breakPageKind(u).isAdj) && open('public_features__public_breaking_adjs');
  const wantParticipants = !!nav.participants && open('public_features__public_participants');
  for (const u of nav.resultsRounds) if (!wantRounds) result.rounds.set(u, { source: 'html', reason: 'public_results not set' });
  for (const u of nav.breakTabs) {
    const adj = breakPageKind(u).isAdj;
    if (adj ? !wantAdjBreak : !wantTeamBreak) result.breaks.set(u, { source: 'html', reason: 'public break not set' });
  }
  if (nav.participants && !wantParticipants) result.participants = { source: 'html', reason: 'public_participants not set' };
  if (!wantRounds && !wantTeamBreak && !wantAdjBreak && !wantParticipants) return result;

  const teams = await getApiList(fetcher, base, 'teams', teamSchema);
  if (!teams.ok) return allHtml(nav, teams.reason);
  const adjudicators = await getApiList(fetcher, base, 'adjudicators', adjudicatorSchema);
  if (!adjudicators.ok) return allHtml(nav, adjudicators.reason);

  // Where the tournament shows institutions, the HTML participants list and
  // break tabs carry them as codes ("CUS", "LSE", "RVCE"), but the API only
  // links each to /institutions, which needs a token, and a team's code
  // cannot be read off a custom team name ("Debating Divas" is NLSIU). Reading
  // those pages from the API would drop every institution (WUDC 2025: 172
  // judges; ILNU 2023: every breaking team), so they stay on HTML. The
  // tournament's own display preferences decide, with an adjudicator
  // institution link as a backstop for installs without them. Round results
  // never show institutions and are unaffected.
  const adjInstitutionsShown =
    pref('ui_options__show_adjudicator_institutions') !== false || adjudicators.rows.some((a) => !!a.institution);
  const teamInstitutionsShown = pref('ui_options__show_team_institutions') !== false;
  const institutionReason = 'institutions are shown, and the API cannot name them';
  if (wantParticipants && nav.participants && (adjInstitutionsShown || teamInstitutionsShown)) {
    result.participants = { source: 'html', reason: institutionReason };
  }
  for (const u of nav.breakTabs) {
    if (breakPageKind(u).isAdj ? adjInstitutionsShown : teamInstitutionsShown) {
      result.breaks.set(u, { source: 'html', reason: institutionReason });
    }
  }
  const readAdjBreak = wantAdjBreak && !adjInstitutionsShown;
  const readTeamBreak = wantTeamBreak && !teamInstitutionsShown;
  const readParticipants = wantParticipants && !adjInstitutionsShown && !teamInstitutionsShown;

  // Push-back (429/503, or no answer): the host wants fewer requests. Stop
  // asking the API for anything else and leave the rest to the HTML path,
  // whose retries and learned backoff are built for it — as fetchTabsFromApi
  // does. Without this a rate-limited host got one more call per linked round.
  let pushedBack = false;
  const PUSHBACK = 'host pushing back; API not asked';
  const get = async <S extends z.ZodTypeAny>(path: string, schema: S) => {
    const got = await getApiList(fetcher, base, path, schema);
    if (!got.ok && isHostPushback(got)) pushedBack = true;
    return got;
  };

  if (wantRounds) {
    const standings = await get('teams/standings/rounds', teamRoundStandingSchema);
    const rounds = standings.ok ? await get('rounds', roundSchema) : standings;
    if (!standings.ok || !rounds.ok) {
      const reason = !standings.ok ? standings.reason : !rounds.ok ? rounds.reason : '';
      for (const u of nav.resultsRounds) result.rounds.set(u, { source: 'html', reason });
    } else {
      for (const u of nav.resultsRounds) {
        const seq = Number(u.match(/\/results\/round\/(\d+)/)?.[1] ?? NaN);
        const apiRound = rounds.rows.find((r) => r.seq === seq);
        if (!Number.isFinite(seq) || !apiRound) {
          result.rounds.set(u, { source: 'html', reason: `round ${seq}: not in API` });
          continue;
        }
        if (pushedBack) {
          result.rounds.set(u, { source: 'html', reason: PUSHBACK });
          continue;
        }
        const pairings = await get(`rounds/${seq}/pairings`, pairingSchema);
        if (!pairings.ok) {
          result.rounds.set(u, { source: 'html', reason: pairings.reason });
          continue;
        }
        // Every drawn team must have an entry for this round (a bye's entry
        // with no result counts). A team missing outright means the results
        // cover only part of the draw, and a missing row reads downstream as
        // "did not debate" — not as unknown — so the page goes to HTML.
        const covered = new Set(
          standings.rows.filter((st) => st.rounds.some((r) => seqFromUrl(r.round) === seq)).map((st) => st.team),
        );
        const uncovered = pairings.rows.flatMap((p) => p.teams).filter((t) => !covered.has(t.team)).length;
        if (uncovered > 0) {
          result.rounds.set(u, { source: 'html', reason: `round ${seq}: ${uncovered} drawn teams have no result entry` });
          continue;
        }
        const debate = mapRoundResults({
          seq,
          sourceUrl: u,
          navLabel: nav.resultsRoundLabels?.[u],
          apiRoundName: apiRound.name,
          teamsInDebate,
          sideNames,
          teams: teams.rows,
          roundStandings: standings.rows,
          pairings: pairings.rows,
          adjudicators: adjudicators.rows,
        });
        result.rounds.set(
          u,
          debate.teamResults.length > 0
            ? { source: 'api', value: debate }
            : { source: 'html', reason: `round ${seq}: no results` },
        );
      }
    }
  }

  if (readTeamBreak || readAdjBreak) {
    const teamStandings = readTeamBreak && !pushedBack ? await get('teams/standings', teamStandingSchema) : null;
    const categories = readTeamBreak && !pushedBack ? await get('break-categories', breakCategorySchema) : null;
    for (const u of nav.breakTabs) {
      const kind = breakPageKind(u);
      if (kind.isAdj) {
        if (!readAdjBreak) continue;
        const rows = mapBreakPage({ sourceUrl: u, teams: teams.rows, teamStandings: [], adjudicators: adjudicators.rows });
        result.breaks.set(u, rows.length > 0 ? { source: 'api', value: rows } : { source: 'html', reason: 'no breaking adjudicators' });
        continue;
      }
      if (!readTeamBreak) continue;
      if (pushedBack || !teamStandings?.ok || !categories?.ok) {
        const reason = pushedBack
          ? PUSHBACK
          : teamStandings && !teamStandings.ok
            ? teamStandings.reason
            : categories && !categories.ok
              ? categories.reason
              : 'no standings';
        result.breaks.set(u, { source: 'html', reason });
        continue;
      }
      const category = categories.rows.find((c) => c.slug === kind.slug);
      if (!category) {
        result.breaks.set(u, { source: 'html', reason: `break category ${kind.slug}: not in API` });
        continue;
      }
      // Read the id off the end rather than parse the URL: a relative or odd
      // url must cost this tab its API read, not throw out of the ingest.
      const categoryId = category.url.match(/\/break-categories\/(\d+)\/?$/)?.[1];
      if (!categoryId) {
        result.breaks.set(u, { source: 'html', reason: `break category ${kind.slug}: unreadable url` });
        continue;
      }
      const breaking = await get(`break-categories/${categoryId}/break`, breakingTeamSchema);
      if (!breaking.ok) {
        result.breaks.set(u, { source: 'html', reason: breaking.reason });
        continue;
      }
      if (!breakRanksConsistent(breaking.rows.map((b) => b.rank))) {
        result.breaks.set(u, { source: 'html', reason: `break ${kind.slug}: ranks skip numbers` });
        continue;
      }
      const rows = mapBreakPage({
        sourceUrl: u,
        breakingTeams: breaking.rows,
        teams: teams.rows,
        teamStandings: teamStandings.rows,
        adjudicators: adjudicators.rows,
      });
      result.breaks.set(u, rows.length > 0 ? { source: 'api', value: rows } : { source: 'html', reason: `break ${kind.slug}: no rows` });
    }
  }

  if (readParticipants) {
    const rows = mapParticipants({ teams: teams.rows, adjudicators: adjudicators.rows });
    result.participants = rows.length > 0 ? { source: 'api', value: rows } : { source: 'html', reason: 'participants: no rows' };
  }
  return result;
}
