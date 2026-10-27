import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { isPlaceholderPersonName, isRedactedName } from '@/lib/calicotab/names';
import { extractNavigation } from '@/lib/calicotab/parseNav';
import {
  parseParticipantsList,
  parseRoundResults,
  parseSpeakerTab,
  parseTeamTab,
  type ParticipantsRow,
  type RoundDebate,
  type SpeakerTabRow,
  type TeamTabRow,
} from '@/lib/calicotab/parseTabs';
import { splitStageLabel } from '@/lib/calicotab/stageLexicon';
import { cleanName } from '@/lib/calicotab/tabbycatApi';
import {
  mapParticipants,
  type ApiAdjudicator,
  type ApiRoundsTeam,
} from '@/lib/calicotab/tabbycatApiRounds';

/**
 * Which tournaments would a phase-7 identity re-ingest actually change?
 * (docs/superpowers/specs/2026-10-27-person-identity-option-b-design.md,
 * section 10, phase 7; runbook docs/runbooks/identity-affected-tournaments.md.)
 *
 * Phase 7 changes two things ingest does with names, and only tournaments
 * where one of them bites need re-ingesting:
 *
 *   (a) a name with letters in it whose v1 key (normalizePersonName) is
 *       empty — "李明", "Иван" — is skipped by preCommitPersons, so that
 *       person has no Person and no TournamentParticipant at all;
 *   (b) two different people at one tournament whose v1 keys are equal —
 *       namesakes, or "José Silva" / "Jose Silva", or "王欣月2" / "李明2"
 *       (both "2") — become one participant: the participants list is
 *       merged by key (lib/calicotab/ingest.ts, the participantByName map)
 *       and TournamentParticipant is unique on (tournamentId, personId).
 *
 * Everything here is pure: it takes page bodies and returns counts, so the
 * offline script (scripts/find-identity-affected-tournaments.mjs) and the
 * tests share it, and nothing here can reach a database or the network. It
 * reuses the ingest parsers unchanged, so it sees the rows ingest would see.
 *
 * Counting rules:
 * - Redacted and stand-in names ("<em>Redacted</em>", "Speaker 1") are left
 *   out of (b). They share a key by design and ingest already handles them
 *   (names.ts, redactedSpeaker.ts); counting them would flag nearly every
 *   tournament.
 * - (a) needs at least one letter or digit in the raw name. Punctuation-only
 *   cells ("—", "?") are not people, and v2 drops them too.
 * - (b) pairs rows within ONE list at a time (team tab rosters, speaker tab,
 *   participants list, API participants). Each list names each person once
 *   per role, so two rows with one key in one list are two entries. Across
 *   lists the same person appears in every list, so pairing across them
 *   would count everyone. Rows identical in every field are counted once, so
 *   a parser that reads one row twice does not invent a namesake.
 *
 * ── Is a shared key one person or two? The owner's rule ──
 *
 * A person cannot speak and judge in the SAME ROUND, nor speak for two teams
 * in one round, nor sit on two panels in one round. Nothing stops one person
 * speaking in the prelims and judging the outrounds, or an organiser being
 * entered on several swing teams to fill rooms in different rounds. So two
 * entries with one key are judged by their ROUNDS:
 *
 *   overlap   — some round has both entries in it: two speaker entries both
 *               scored (or both teams drawn) in round N; a speaker entry
 *               scored in N while the key judged N; two judges with the key
 *               on round N's results. Two people. A real collision, counted.
 *   disjoint  — every pair of entries has round data and no round in common.
 *               Plausibly one person (a speaker who later judged, a swing
 *               or replacement, an organiser on several teams). Not a
 *               collision, not counted. Split into `crossRole` (a speaker
 *               and a judge entry) and same-role (only one role).
 *   unknown   — some pair cannot be decided because one side has no
 *               per-round data in the export. Reported on its own; counted
 *               only in the second, upper-bound "affected" number.
 *   duplicate — the same role with the same team and institution: one
 *               person listed twice (a second table, a split category tab).
 *
 * Where rounds come from, all from stored pages:
 *   - a speaker entry: its own speaker-tab row (rounds with a score), else a
 *     speaker-tab row with the same key and team, else the rounds its team
 *     appears in on the round-results pages (/results/round/N/);
 *   - judges: the adjudicator column of the round-results pages, by key.
 *     Those pages list names, not people, and parseRoundResults keeps one
 *     entry per name and panel role in a round, so two judges spelled
 *     identically in the same panel role in one round read as one. Two
 *     identically spelled judge entries are therefore 'unknown' unless a
 *     round shows the key twice (in two roles or two spellings).
 * Rounds are compared by `roundKey`: a prelim is its number, so the halves
 * of a split round (R1A, R1B) are one round; an outround is its stage and
 * break category ("Novice Final" is not the "Open Final").
 *
 * Two owner rules sit on top (assumptions register, ingest Q4/Q10, 2026-10-27).
 * (1) Nobody is in both an Open final and a Novice final at one tournament:
 * entries that between them reach both are an overlap although the round keys
 * differ. EUDC alone runs Open and ESL outrounds side by side and lets one
 * person be in both, so ESL pairs are left disjoint. (2) HWS-style round
 * robins put one debate before two judging panels (independent rankings and
 * speaks, aggregated). A results page that lists a team twice is read as that
 * format, and a judge repeated in such a round is not flagged as sitting on
 * two panels. This module is offline only: live ingest merging is unchanged.
 *
 * `judgeRoleDropped` flags a participants-list group where participantByName
 * (Map.set, last row wins) ends on a non-adjudicator row while an
 * adjudicator row shares the key: ingest writes no judge role for that key,
 * because the adjudicator loop only reads rows still marked adjudicator.
 * Tabbycat lists the Adjudicators table before the Speakers table, so the
 * speaker row usually wins. On an overlap group that is the collision
 * itself; on a DISJOINT speaker+judge group it is one person losing their
 * judge credit — a real ingest bug of its own (reported as
 * judgeRoleLostByOnePerson), which phase 7 fixes by keeping both roles.
 */

export type DocumentKind =
  'teamTab' | 'speakerTab' | 'participants' | 'apiTeams' | 'apiAdjudicators';

/** Pages read only for their rounds; they never make a tournament on their own. */
export type RoundPageKind = 'landing' | 'roundResults';

export type ClassifiedUrl = {
  /** Public tournament base, `https://host/slug/` (or `https://host/` when root-hosted). */
  base: string;
  host: string;
  slug: string | null;
  kind: DocumentKind | RoundPageKind;
  /** The round's sequence number, for a round-results page. */
  roundSeq?: number;
};

// Same paths extractNavigation (lib/calicotab/parseNav.ts) accepts for these tabs.
const HTML_KINDS: Array<[RegExp, DocumentKind | RoundPageKind]> = [
  [/^(.*?)\/tab\/(?:team(?:-standings)?|overall)\/?$/, 'teamTab'],
  [/^(.*?)\/tab\/speaker(?:-standings)?\/?$/, 'speakerTab'],
  [/^(.*?)\/participants\/list\/?$/, 'participants'],
  // The by-team and by-debate views carry the same results.
  [/^(.*?)\/results\/round\/\d+\/?(?:by-team\/|by-debate\/)?$/, 'roundResults'],
  [/^(\/[^/]+)?\/?$/, 'landing'],
];

/**
 * The tournament and page kind of one stored document URL, or null when it
 * is not one of the pages this check reads (break tabs, motions, other API
 * endpoints, private URLs).
 */
export function classifyDocumentUrl(url: string): ClassifiedUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const path = u.pathname;
  if (/\/privateurls\//i.test(path)) return null;
  const api = path.match(/^\/api\/v1\/tournaments\/([^/]+)\/(teams|adjudicators)\/?$/);
  if (api) {
    const [, slug = '', list] = api;
    return {
      base: `${u.origin}/${slug}/`,
      host: u.host,
      slug,
      kind: list === 'teams' ? 'apiTeams' : 'apiAdjudicators',
    };
  }
  if (/^\/api(?:\/|$)/.test(path)) return null;
  for (const [re, kind] of HTML_KINDS) {
    const m = path.match(re);
    if (!m) continue;
    const prefix = (m[1] ?? '').split('/').filter(Boolean);
    // Tabbycat tournaments live at /<slug>/...; a root-hosted install has
    // the tabs directly under /. Anything deeper is not a tab page.
    if (prefix.length > 1) return null;
    const slug = prefix[0] ?? null;
    const out: ClassifiedUrl = {
      base: slug ? `${u.origin}/${slug}/` : `${u.origin}/`,
      host: u.host,
      slug,
      kind,
    };
    if (kind === 'roundResults') out.roundSeq = Number(/\/results\/round\/(\d+)/.exec(path)?.[1]);
    return out;
  }
  return null;
}

/** One line of index.jsonl written by scripts/export-source-documents.mjs. */
export type IndexEntry = {
  id: string;
  url: string;
  status: number | null;
  fetchedAt: string | null;
  file: string;
};

export type TournamentDocuments = {
  base: string;
  host: string;
  slug: string | null;
  /** The newest successful document of each kind; what a fresh ingest would read. */
  docs: Partial<Record<DocumentKind, IndexEntry>>;
  /** The newest landing page: its nav names each results round ("Quarterfinals"). */
  landing?: IndexEntry;
  /** The newest results page of each round, in round order. */
  results: IndexEntry[];
};

/**
 * Group the export index by tournament, keeping the newest 200 document of
 * each kind. The export can hold several snapshots of one URL (one per
 * content hash), and a tab may be stored under two URL spellings
 * (/tab/team/ and /tab/team-standings/); the newest wins either way. Landing
 * and results pages are attached to a tournament that has a tab page but do
 * not make one on their own, so the tournament count is unchanged by them.
 */
export function groupByTournament(entries: Iterable<IndexEntry>): TournamentDocuments[] {
  const byBase = new Map<string, TournamentDocuments & { bySeq: Map<number, IndexEntry> }>();
  for (const e of entries) {
    if (e.status != null && e.status !== 200) continue;
    const c = classifyDocumentUrl(e.url);
    if (!c) continue;
    let t = byBase.get(c.base);
    if (!t) {
      t = { base: c.base, host: c.host, slug: c.slug, docs: {}, results: [], bySeq: new Map() };
      byBase.set(c.base, t);
    }
    if (c.kind === 'landing') {
      if (!t.landing || time(e.fetchedAt) > time(t.landing.fetchedAt)) t.landing = e;
    } else if (c.kind === 'roundResults') {
      const seq = c.roundSeq ?? 0;
      const prev = t.bySeq.get(seq);
      if (!prev || time(e.fetchedAt) > time(prev.fetchedAt)) t.bySeq.set(seq, e);
    } else {
      const prev = t.docs[c.kind];
      if (!prev || time(e.fetchedAt) > time(prev.fetchedAt)) t.docs[c.kind] = e;
    }
  }
  return [...byBase.values()]
    .filter((t) => Object.keys(t.docs).length > 0)
    .map(({ bySeq, ...t }) => ({
      ...t,
      results: [...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e),
    }))
    .sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0));
}

function time(s: string | null): number {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
}

// ── Reading the pages ───────────────────────────────────────────────────────

export type ParsedLists = {
  teamRows?: TeamTabRow[];
  speakerRows?: SpeakerTabRow[];
  participantRows?: ParticipantsRow[];
  apiParticipantRows?: ParticipantsRow[];
  /** The round-results pages, parsed as ingest parses them. */
  rounds?: RoundDebate[];
};

/**
 * Parse the bodies of one tournament's documents with the ingest parsers.
 * `read` returns a document's decompressed body. The two API lists are only
 * combined when the teams list is present, as ingest's API participants path
 * needs both (an absent adjudicators list reads as none). `roundPages` are
 * the landing page (for the nav's round labels) and the results pages; a
 * results page that fails to parse is skipped, not fatal.
 */
export function parseTournamentDocuments(
  docs: TournamentDocuments['docs'],
  read: (entry: IndexEntry) => string,
  roundPages?: { landing?: IndexEntry; results?: IndexEntry[] },
): ParsedLists {
  const out: ParsedLists = {};
  if (docs.teamTab) out.teamRows = parseTeamTab(read(docs.teamTab));
  if (docs.speakerTab) out.speakerRows = parseSpeakerTab(read(docs.speakerTab));
  if (docs.participants) out.participantRows = parseParticipantsList(read(docs.participants));
  if (docs.apiTeams) {
    const teams = jsonList(read(docs.apiTeams)).filter(isApiTeam);
    const adjudicators = docs.apiAdjudicators
      ? jsonList(read(docs.apiAdjudicators)).filter(isApiAdjudicator)
      : [];
    out.apiParticipantRows = mapParticipants({ teams, adjudicators });
  }
  if (roundPages?.results?.length)
    out.rounds = parseRoundPages(roundPages.results, roundPages.landing, read);
  return out;
}

const RESULTS_SEQ = /\/results\/round\/(\d+)/;

/**
 * The nav's link text is the round's own name ("Quarterfinals"), which ingest
 * passes to parseRoundResults too. Keyed by round number, because the stored
 * URL may be the by-team view or the other scheme. No landing page, or one
 * that fails to parse: no labels, and rounds fall back to the page heading or
 * "Round N".
 */
function roundLabels(
  landing: IndexEntry | undefined,
  read: (entry: IndexEntry) => string,
): Map<number, string> {
  const labelBySeq = new Map<number, string>();
  if (!landing) return labelBySeq;
  let labels: Record<string, string> = {};
  try {
    labels = extractNavigation(read(landing), landing.url).resultsRoundLabels;
  } catch {
    return labelBySeq;
  }
  for (const [u, label] of Object.entries(labels)) {
    const seq = Number(RESULTS_SEQ.exec(u)?.[1] ?? NaN);
    if (Number.isFinite(seq) && !labelBySeq.has(seq)) labelBySeq.set(seq, label);
  }
  return labelBySeq;
}

/** Each results page as ingest parses it; one unreadable page leaves that round out. */
function parseRoundPages(
  results: IndexEntry[],
  landing: IndexEntry | undefined,
  read: (entry: IndexEntry) => string,
): RoundDebate[] {
  const labelBySeq = roundLabels(landing, read);
  const rounds: RoundDebate[] = [];
  for (const e of results) {
    const seq = Number(RESULTS_SEQ.exec(e.url)?.[1] ?? NaN);
    try {
      rounds.push(parseRoundResults(read(e), e.url, labelBySeq.get(seq) ?? null));
    } catch {
      // An unreadable page: that round's evidence is left out.
    }
  }
  return rounds;
}

function jsonList(body: string): unknown[] {
  try {
    const v: unknown = JSON.parse(body);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isApiTeam(v: unknown): v is ApiRoundsTeam {
  return (
    isObject(v) &&
    typeof v.short_name === 'string' &&
    Array.isArray(v.speakers) &&
    v.speakers.every(
      (s) =>
        isObject(s) &&
        (s.name === null || typeof s.name === 'string') &&
        typeof s.anonymous === 'boolean',
    )
  );
}

function isApiAdjudicator(v: unknown): v is ApiAdjudicator {
  return (
    isObject(v) &&
    (v.name === null || typeof v.name === 'string') &&
    typeof v.anonymous === 'boolean'
  );
}

// ── Rounds ──────────────────────────────────────────────────────────────────

/**
 * One round, comparable across the speaker tab's column headers and the
 * results pages' labels. A prelim is "R<number>": "R3", "Round 3", "3",
 * "Ronda 3" and both halves of a split round ("R1A", "Round 1B") are one
 * round. An outround is its stage plus break category ("semifinal novice"),
 * so concurrent finals of two brackets are two rounds. `fallbackSeq` is used
 * when the label is empty.
 */
export function roundKey(
  label: string | null | undefined,
  fallbackSeq?: number | null,
): string | null {
  const text = cleanName(label ?? '');
  if (!text || /^average$/i.test(text)) return fallbackSeq != null ? `R${fallbackSeq}` : null;
  const { stage, category } = splitStageLabel(text);
  if (stage) return category ? `${stage} ${category.toLowerCase()}` : stage;
  const n = text.match(/\d+/);
  if (n) return `R${Number(n[0])}`;
  return text.toLowerCase();
}

/** Prelims in number order first, then the rest alphabetically. */
function compareRounds(a: string, b: string): number {
  const na = /^R(\d+)$/.exec(a);
  const nb = /^R(\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedRounds(s: Iterable<string>): string[] {
  return [...s].sort(compareRounds);
}

/** "R1-R5" for a run, else a comma list, so the evidence column stays short. */
function formatRounds(rounds: Iterable<string>): string {
  const list = sortedRounds(rounds);
  const nums = list.map((r) => /^R(\d+)$/.exec(r)?.[1]).map((n) => (n ? Number(n) : null));
  if (
    list.length > 2 &&
    nums.every((n) => n != null) &&
    nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1)
  ) {
    return `${list[0]}-${list[list.length - 1]}`;
  }
  return list.join(',');
}

/** What the round-results pages say, indexed for the checks below. */
type RoundIndex = {
  /** Loose team name → rounds the team has a result in. */
  teamRounds: Map<string, Set<string>>;
  /** v1 key → round → the distinct "name|panel role" entries for that key. */
  judgesByKey: Map<string, Map<string, Set<string>>>;
  /** Exact judge spelling → rounds. */
  judgeNameRounds: Map<string, Set<string>>;
  /** Rounds whose page lists a team twice: one debate, two judging panels. */
  doublePanelRounds: Set<string>;
  /** At least one results page named at least one judge. */
  hasJudges: boolean;
  /** Results pages read. */
  pages: number;
};

function indexRounds(rounds: RoundDebate[] | undefined): RoundIndex {
  const idx: RoundIndex = {
    teamRounds: new Map(),
    judgesByKey: new Map(),
    judgeNameRounds: new Map(),
    doublePanelRounds: new Set(),
    hasJudges: false,
    pages: 0,
  };
  const pagesByKey = new Map<string, number>();
  const doublePanelPages = new Map<string, number>();
  for (const r of rounds ?? []) {
    idx.pages += 1;
    const key = roundKey(r.roundLabel, r.roundNumber);
    if (!key) continue;
    // HWS-style round robins list the TEAM twice on one results page, each
    // listing with its own judging panel (owner answer, 2026-10-27). A judge
    // cannot sit on both panels of one debate, so a repeat inside such a page
    // is undecided rather than proof of two judges. Only a page where EVERY
    // team appears exactly twice counts; empty names and swing stand-ins are
    // not teams to count. A key shared by pages of different parts (R1A, R1B)
    // is double-panel only if every one of those pages is.
    for (const t of r.teamResults) addTo(idx.teamRounds, loose(t.teamName), key);
    pagesByKey.set(key, (pagesByKey.get(key) ?? 0) + 1);
    if (isDoublePanelPage(r.teamResults)) {
      doublePanelPages.set(key, (doublePanelPages.get(key) ?? 0) + 1);
    }
    for (const j of r.judgeAssignments) {
      const name = cleanName(j.personName);
      const k = normalizePersonName(name);
      if (!k || ignoredForSharing(name)) continue;
      idx.hasJudges = true;
      const byRound = idx.judgesByKey.get(k) ?? new Map<string, Set<string>>();
      idx.judgesByKey.set(k, byRound);
      addTo(byRound, key, `${name}|${j.panelRole ?? ''}`);
      addTo(idx.judgeNameRounds, name, key);
    }
  }
  for (const [key, n] of doublePanelPages) {
    if (n === pagesByKey.get(key)) idx.doublePanelRounds.add(key);
  }
  return idx;
}

/** Every counted team on the page is listed exactly twice (and there is at least one). */
export function isDoublePanelPage(teams: ReadonlyArray<{ teamName: string }>): boolean {
  const counts = new Map<string, number>();
  for (const t of teams) {
    const name = cleanName(t.teamName);
    if (!name || /^swing/i.test(name) || isPlaceholderPersonName(name)) continue;
    const team = loose(name);
    counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  return counts.size > 0 && [...counts.values()].every((n) => n === 2);
}

function addTo<K, V>(m: Map<K, Set<V>>, k: K, v: V): void {
  const s = m.get(k) ?? new Set<V>();
  s.add(v);
  m.set(k, s);
}

// ── The check ───────────────────────────────────────────────────────────────

export type SharedKeyClass = 'overlap' | 'disjoint' | 'unknown' | 'duplicate';

export type SharedKey = {
  key: string;
  /** Raw spellings seen for this key, in first-seen order. */
  names: string[];
  /** The largest number of distinct entries sharing the key in any one list. */
  entries: number;
  /** Which lists showed the shared key. */
  sources: string[];
  /** The strongest class any one list showed (overlap > unknown > disjoint > duplicate). */
  class: SharedKeyClass;
  /** Some list held the key under both a speaker and an adjudicator row. */
  crossRole: boolean;
  /**
   * Why the class was given, rounds only (names stay in the name column):
   * the first overlapping round and the two sides' sources for an overlap,
   * each side's rounds for a disjoint group, the side without rounds for an
   * unknown one.
   */
  evidence: string;
  /** The participants merge leaves this key with no adjudicator row. */
  judgeRoleDropped: boolean;
  /**
   * For a key that some list holds under two roles: whether a speaker row
   * and a judge row name the same institution ('same'), only different ones
   * ('different'), or one side names none ('unknown'). null when no list
   * held the key under two roles.
   */
  crossRoleInstitution: InstitutionMatch | null;
  /**
   * For an 'unknown' group: the pair that left it undecided, with what each
   * side is evidenced in, so the owner can decide it by eye
   * (lib/identity/unknownRounds.ts writes these out). Absent otherwise.
   */
  undecided?: UndecidedPair;
};

/** One side of an undecided pair, spelled as the page shows it. */
export type UndecidedEntry = {
  name: string;
  role: ParticipantsRow['role'];
  team: string;
  institution: string;
  /** Rounds this entry is evidenced in (roundKey form, sorted); empty when none. */
  rounds: string[];
};

export type UndecidedPair = {
  a: UndecidedEntry;
  b: UndecidedEntry;
  /**
   * Two judge entries with one spelling, both seen on the results pages:
   * the rounds are the name's, and the pages cannot say which entry sat.
   */
  sameSpellingJudges: boolean;
};

export type InstitutionMatch = 'same' | 'different' | 'unknown';

export type TournamentFindings = {
  /** (a) Distinct raw names with letters whose v1 key is empty. */
  emptyKeyNames: string[];
  /** (b) Keys held by two or more distinct entries in one list. */
  sharedKeys: SharedKey[];
  /** Round-results pages that were read (0: judge rounds unknowable). */
  resultsPages?: number;
};

type Role = ParticipantsRow['role'];
type Entry = {
  name: string;
  identity: string;
  role: Role;
  affiliation: string;
  institution: string;
  /** Loose team name; '' when the row names none. */
  team: string;
  /** Team and institution as the page spells them, for the owner's sheet. */
  label: { team: string; institution: string };
  /** Rounds this very row was scored in (speaker tab rows only). */
  ownRounds: Set<string> | null;
};

const CLASS_RANK: Record<SharedKeyClass, number> = {
  duplicate: 0,
  disjoint: 1,
  unknown: 2,
  overlap: 3,
};
const MATCH_RANK: Record<InstitutionMatch, number> = { unknown: 0, different: 1, same: 2 };

/** Spelled loosely enough that one team or institution reads as one. */
function loose(s: string | null | undefined): string {
  return cleanName(s ?? '').toLowerCase();
}

function entryLabel(
  team: string | null | undefined,
  institution: string | null | undefined,
): Entry['label'] {
  return { team: cleanName(team ?? ''), institution: cleanName(institution ?? '') };
}

/** Team and institution together. */
function affiliation(
  team: string | null | undefined,
  institution: string | null | undefined,
): string {
  return JSON.stringify([loose(team), loose(institution)]);
}

/**
 * Do rows of different roles in one group name the same institution? 'same'
 * if any such pair shares a non-empty institution, else 'different' if some
 * pair names two different ones, else 'unknown' (no pair names both). null
 * when the group holds only one role.
 */
function institutionMatch(rows: Entry[]): InstitutionMatch | null {
  let best: InstitutionMatch | null = null;
  for (const a of rows) {
    for (const b of rows) {
      // Each unordered pair of different roles once.
      if (a.role >= b.role) continue;
      const m: InstitutionMatch =
        !a.institution || !b.institution
          ? 'unknown'
          : a.institution === b.institution
            ? 'same'
            : 'different';
      if (best === null || MATCH_RANK[m] > MATCH_RANK[best]) best = m;
    }
  }
  return best;
}

/** Rounds with a score on one speaker-tab row. */
function scoredRounds(r: SpeakerTabRow): Set<string> {
  const out = new Set<string>();
  for (const s of r.roundScores) {
    if (s.score == null || s.positionLabel === 'average') continue;
    const k = roundKey(s.roundLabel);
    if (k) out.add(k);
  }
  return out;
}

/** Everything the pair checks look rounds up in. */
type Evidence = {
  rounds: RoundIndex;
  /** v1 key → speaker-tab rows' (loose team, scored rounds). */
  speakerTab: Map<string, Array<{ team: string; rounds: Set<string> }>>;
};

/** One shared key at one tournament, and the evidence to judge it by. */
type KeyContext = { key: string; ev: Evidence };

/** One side of a pair: what it is ("speaker", "judge"), its rounds (null: none known), and where they came from. */
type Side = { word: string; rounds: Set<string> | null; from: string };

const noRounds = (word: string): Side => ({ word, rounds: null, from: '' });

/** The rounds one speaker entry spoke in, best source first. */
function speakerSide(e: Entry, { key, ev }: KeyContext): Side {
  if (e.ownRounds && e.ownRounds.size > 0)
    return { word: 'speaker', rounds: e.ownRounds, from: 'speaker tab' };
  if (!e.team) return noRounds('speaker');
  const tab = (ev.speakerTab.get(key) ?? []).filter((r) => r.team === e.team && r.rounds.size > 0);
  if (tab.length > 0)
    return {
      word: 'speaker',
      rounds: new Set(tab.flatMap((r) => [...r.rounds])),
      from: 'speaker tab',
    };
  const team = ev.rounds.teamRounds.get(e.team);
  return team && team.size > 0
    ? { word: 'speaker', rounds: team, from: 'team results' }
    : noRounds('speaker');
}

/** The rounds the key judged, from the results pages. */
function judgeSide({ key, ev }: KeyContext): Side {
  const byRound = ev.rounds.judgesByKey.get(key);
  return byRound && byRound.size > 0
    ? { word: 'judge', rounds: new Set(byRound.keys()), from: 'results' }
    : noRounds('judge');
}

type PairVerdict = {
  cls: 'overlap' | 'disjoint' | 'unknown';
  crossRole: boolean;
  evidence: string;
  /** Set on an 'unknown' verdict only. */
  pair?: UndecidedPair;
};

function sideVerdict(a: Side, b: Side, crossRole: boolean): PairVerdict {
  const ra = a.rounds;
  const rb = b.rounds;
  if (!ra || !rb) {
    const missing = [!ra ? a.word : null, !rb ? b.word : null].filter(Boolean).join(' and ');
    return { cls: 'unknown', crossRole, evidence: `no rounds for the ${missing}` };
  }
  const shared = sortedRounds([...ra].filter((r) => rb.has(r)));
  if (shared.length > 0) {
    return {
      cls: 'overlap',
      crossRole,
      evidence: `${shared[0]}: ${a.word} (${a.from}) and ${b.word} (${b.from})`,
    };
  }
  // Owner rule (assumptions Q4/Q10): nobody is in both an Open final and a
  // Novice final at one tournament, so entries that between them reach both
  // are two people even though the two finals have different round keys.
  // (EUDC is the one event where Open and ESL outrounds run side by side and
  // one person may be in both; ESL is not covered by this rule.)
  const crossFinal = crossBracketFinals(ra, rb) ?? crossBracketFinals(rb, ra);
  if (crossFinal) {
    return {
      cls: 'overlap',
      crossRole,
      evidence: `final: Open final and Novice final (${crossFinal.open} and ${crossFinal.novice})`,
    };
  }
  return {
    cls: 'disjoint',
    crossRole,
    evidence: `${a.word} ${formatRounds(ra)} (${a.from}); ${b.word} ${formatRounds(rb)} (${b.from})`,
  };
}

/** The bracket a final's round key belongs to; null for any other round. */
function finalBracket(key: string): 'open' | 'novice' | null {
  const m = /^(?:grand_final|final)(?: (.+))?$/.exec(key);
  if (!m) return null;
  const category = (m[1] ?? '').trim();
  if (category === '' || category === 'open') return 'open';
  return /novice/.test(category) ? 'novice' : null;
}

/** `open` holds an Open final and `novice` holds a Novice final: which keys. */
function crossBracketFinals(
  open: Set<string>,
  novice: Set<string>,
): { open: string; novice: string } | null {
  const o = [...open].find((r) => finalBracket(r) === 'open');
  const n = [...novice].find((r) => finalBracket(r) === 'novice');
  return o && n ? { open: o, novice: n } : null;
}

/**
 * Two judge entries with one key. The results pages give a judge's name and
 * panel role per round, deduplicated by that pair, so: a round showing the
 * key twice (two spellings, or two panel roles) is an overlap; two different
 * spellings that never share a round are disjoint; one spelling that appears
 * once per round cannot tell one judge from two on matching roles: unknown.
 */
function judgePairVerdict(a: Entry, b: Entry, { key, ev }: KeyContext): PairVerdict {
  const byRound = ev.rounds.judgesByKey.get(key);
  if (!byRound || byRound.size === 0)
    return { cls: 'unknown', crossRole: false, evidence: 'no rounds for either judge' };
  // A double-panel round lists the same judge name once per panel, so a repeat
  // there is not two judges (owner exception to the same-round rule).
  const twice = sortedRounds(
    [...byRound]
      .filter(([r, seen]) => seen.size >= 2 && !ev.rounds.doublePanelRounds.has(r))
      .map(([r]) => r),
  );
  if (twice.length > 0)
    return { cls: 'overlap', crossRole: false, evidence: `${twice[0]}: two judges (results)` };
  const na = cleanName(a.name);
  const nb = cleanName(b.name);
  if (na === nb) {
    return {
      cls: 'unknown',
      crossRole: false,
      evidence: `judge ${formatRounds(byRound.keys())} (results): one spelling, can't tell one judge from two`,
    };
  }
  const side = (name: string): Side => ({
    word: 'judge',
    rounds: ev.rounds.judgeNameRounds.get(name) ?? null,
    from: 'results',
  });
  return sideVerdict(side(na), side(nb), false);
}

/**
 * The rounds one entry of a pair is evidenced in, the same lookups the
 * verdicts use: a speaker's own rounds; a judge's by spelling when the pair
 * are two judge spellings, else by key.
 */
function roundsOf(e: Entry, other: Entry, ctx: KeyContext): Set<string> | null {
  if (e.role === 'speaker') return speakerSide(e, ctx).rounds;
  if (e.role !== 'adjudicator') return null;
  const name = cleanName(e.name);
  if (other.role === 'adjudicator' && name !== cleanName(other.name)) {
    return ctx.ev.rounds.judgeNameRounds.get(name) ?? null;
  }
  return judgeSide(ctx).rounds;
}

function undecidedPair(a: Entry, b: Entry, ctx: KeyContext): UndecidedPair {
  const side = (e: Entry, other: Entry): UndecidedEntry => ({
    name: e.name,
    role: e.role,
    team: e.label.team,
    institution: e.label.institution,
    rounds: sortedRounds(roundsOf(e, other, ctx) ?? []),
  });
  const sa = side(a, b);
  const sb = side(b, a);
  const sameSpellingJudges =
    a.role === 'adjudicator' &&
    b.role === 'adjudicator' &&
    cleanName(a.name) === cleanName(b.name) &&
    sa.rounds.length > 0;
  return { a: sa, b: sb, sameSpellingJudges };
}

function pairVerdict(a: Entry, b: Entry, ctx: KeyContext): PairVerdict {
  const v = basePairVerdict(a, b, ctx);
  return v.cls === 'unknown' ? { ...v, pair: undecidedPair(a, b, ctx) } : v;
}

function basePairVerdict(a: Entry, b: Entry, ctx: KeyContext): PairVerdict {
  const roles = [a.role, b.role].sort().join('+');
  switch (roles) {
    case 'speaker+speaker':
      return sideVerdict(speakerSide(a, ctx), speakerSide(b, ctx), false);
    case 'adjudicator+speaker':
      return sideVerdict(speakerSide(a.role === 'speaker' ? a : b, ctx), judgeSide(ctx), true);
    case 'adjudicator+adjudicator':
      return judgePairVerdict(a, b, ctx);
    default:
      // An 'other' row (no role column, no section title) has no rounds.
      return {
        cls: 'unknown',
        crossRole: a.role !== b.role,
        evidence: 'no rounds for the other row',
      };
  }
}

/**
 * The class of one key within one list. `rows` are the distinct entries (at
 * least two). Pairs with the same role, team and institution are one person
 * listed twice and are skipped; if every pair is like that the group is a
 * duplicate. Otherwise the strongest pair wins: any overlap, else any
 * unknown, else disjoint.
 */
function classify(
  rows: Entry[],
  ctx: KeyContext,
): PairVerdict | { cls: 'duplicate'; crossRole: false; evidence: string; pair?: undefined } {
  let best: PairVerdict | null = null;
  let crossRole = false;
  for (const [i, a] of rows.entries()) {
    for (const b of rows.slice(i + 1)) {
      if (a.role === b.role && a.affiliation === b.affiliation) continue;
      const v = pairVerdict(a, b, ctx);
      crossRole ||= v.crossRole;
      if (!best || CLASS_RANK[v.cls] > CLASS_RANK[best.cls]) best = v;
    }
  }
  if (!best)
    return { cls: 'duplicate', crossRole: false, evidence: 'same role, team and institution' };
  return { ...best, crossRole };
}

/** Does v1 throw away a whole name a person would recognise as theirs? */
export function isLostName(name: string): boolean {
  return /[\p{L}\p{N}]/u.test(name) && normalizePersonName(name) === '';
}

function ignoredForSharing(name: string): boolean {
  return isRedactedName(name) || isPlaceholderPersonName(name);
}

/** One list to judge on its own, and whether ingest's participantByName merge reads it. */
type Source = { source: string; entries: Entry[]; mergedByName: boolean };

function sourcesOf(lists: ParsedLists): Source[] {
  const sources: Source[] = [];
  if (lists.teamRows) {
    sources.push({
      source: 'team tab',
      entries: lists.teamRows.flatMap((t, i) =>
        // A roster lists each member once; the row index keeps two
        // same-named teams' rosters apart.
        t.speakers.map((s, j) => ({
          name: cleanName(s),
          identity: JSON.stringify([i, j]),
          role: 'speaker' as const,
          affiliation: affiliation(t.teamName, t.institution),
          institution: loose(t.institution),
          team: loose(t.teamName),
          label: entryLabel(t.teamName, t.institution),
          ownRounds: null,
        })),
      ),
      mergedByName: false,
    });
  }
  if (lists.speakerRows) {
    sources.push({
      source: 'speaker tab',
      entries: lists.speakerRows.map((r) => ({
        name: r.speakerName,
        identity: JSON.stringify([
          r.speakerName,
          r.teamName,
          r.institution,
          r.rank,
          r.totalScore,
          r.roundScores.map((s) => s.score),
        ]),
        role: 'speaker' as const,
        affiliation: affiliation(r.teamName, r.institution),
        institution: loose(r.institution),
        team: loose(r.teamName),
        label: entryLabel(r.teamName, r.institution),
        ownRounds: scoredRounds(r),
      })),
      mergedByName: false,
    });
  }
  // ingest reads the API list in place of the HTML one (apiParticipants ??
  // parseParticipantsList), and both go through participantByName.
  const fromParticipants = (rows: ParticipantsRow[]): Entry[] =>
    rows.map((r) => ({
      name: r.name,
      identity: JSON.stringify([r.name, r.role, r.judgeTag, r.teamName, r.institution]),
      role: r.role,
      affiliation: affiliation(r.teamName, r.institution),
      institution: loose(r.institution),
      team: loose(r.teamName),
      label: entryLabel(r.teamName, r.institution),
      ownRounds: null,
    }));
  if (lists.participantRows) {
    sources.push({
      source: 'participants',
      entries: fromParticipants(lists.participantRows),
      mergedByName: true,
    });
  }
  if (lists.apiParticipantRows) {
    sources.push({
      source: 'api participants',
      entries: fromParticipants(lists.apiParticipantRows),
      mergedByName: true,
    });
  }
  return sources;
}

/**
 * One list's entries by v1 key. `rows` keeps one entry per distinct
 * identity; `lastRole` is the role of the last row in list order, the one
 * participantByName keeps. Lost names go into `lost` instead.
 */
type KeyGroup = { names: string[]; rows: Map<string, Entry>; lastRole: Role };

function groupByKey(entries: Entry[], lost: Set<string>): Map<string, KeyGroup> {
  const byKey = new Map<string, KeyGroup>();
  for (const e of entries) {
    const name = e.name.trim();
    if (!name) continue;
    if (isLostName(name)) {
      lost.add(name);
      continue;
    }
    if (ignoredForSharing(name)) continue;
    const key = normalizePersonName(name);
    if (!key) continue;
    const g = byKey.get(key) ?? { names: [], rows: new Map<string, Entry>(), lastRole: e.role };
    byKey.set(key, g);
    if (!g.rows.has(e.identity)) g.rows.set(e.identity, { ...e, name });
    g.lastRole = e.role;
    if (!g.names.includes(name)) g.names.push(name);
  }
  return byKey;
}

function speakerTabIndex(rows: SpeakerTabRow[] | undefined): Evidence['speakerTab'] {
  const out: Evidence['speakerTab'] = new Map();
  for (const r of rows ?? []) {
    const key = normalizePersonName(r.speakerName);
    if (!key) continue;
    const list = out.get(key) ?? [];
    list.push({ team: loose(r.teamName), rounds: scoredRounds(r) });
    out.set(key, list);
  }
  return out;
}

export function findIdentityIssues(lists: ParsedLists): TournamentFindings {
  const lost = new Set<string>();
  const shared = new Map<string, SharedKey>();
  const ev: Evidence = {
    rounds: indexRounds(lists.rounds),
    speakerTab: speakerTabIndex(lists.speakerRows),
  };
  for (const { source, entries, mergedByName } of sourcesOf(lists)) {
    for (const [key, g] of groupByKey(entries, lost)) {
      if (g.rows.size < 2) continue;
      const rows = [...g.rows.values()];
      const v = classify(rows, { key, ev });
      const dropped =
        mergedByName && g.lastRole !== 'adjudicator' && rows.some((r) => r.role === 'adjudicator');
      const inst = institutionMatch(rows);
      const s: SharedKey = shared.get(key) ?? {
        key,
        names: [],
        entries: 0,
        sources: [],
        class: v.cls,
        crossRole: false,
        evidence: v.evidence,
        judgeRoleDropped: false,
        crossRoleInstitution: null,
        undecided: v.pair,
      };
      s.names.push(...g.names.filter((n) => !s.names.includes(n)));
      s.entries = Math.max(s.entries, g.rows.size);
      s.sources.push(source);
      if (CLASS_RANK[v.cls] > CLASS_RANK[s.class]) {
        s.class = v.cls;
        s.evidence = v.evidence;
        s.undecided = v.pair;
      }
      s.crossRole ||= v.crossRole;
      s.judgeRoleDropped ||= dropped;
      if (
        inst &&
        (s.crossRoleInstitution === null || MATCH_RANK[inst] > MATCH_RANK[s.crossRoleInstitution])
      ) {
        s.crossRoleInstitution = inst;
      }
      shared.set(key, s);
    }
  }
  return {
    emptyKeyNames: [...lost].sort(),
    sharedKeys: [...shared.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    resultsPages: ev.rounds.pages,
  };
}

// ── Output ──────────────────────────────────────────────────────────────────

export type TournamentReport = {
  base: string;
  host: string;
  slug: string | null;
  pagesRead: string[];
  findings: TournamentFindings;
  error?: string;
  /** The landing page's tournament name, when a landing page was stored. */
  name?: string | null;
};

function ofClass(r: TournamentReport, cls: SharedKeyClass): SharedKey[] {
  return r.findings.sharedKeys.filter((s) => s.class === cls);
}

/** A disjoint speaker+judge group: plausibly one person who spoke and judged. */
function isSpeakerJudge(s: SharedKey): boolean {
  return s.class === 'disjoint' && s.crossRole;
}

/** One plausible person whose judge role the participants merge drops today. */
function isJudgeRoleLost(s: SharedKey): boolean {
  return isSpeakerJudge(s) && s.judgeRoleDropped;
}

/**
 * Would a phase-7 re-ingest change this tournament? (a), or a shared key
 * whose entries overlap in some round (two people). Disjoint, unknown and
 * duplicate groups do not count here; see isAffectedIfUnknownCounted.
 */
export function isAffected(r: TournamentReport): boolean {
  return (
    r.findings.emptyKeyNames.length > 0 || r.findings.sharedKeys.some((s) => s.class === 'overlap')
  );
}

/** The upper bound: as isAffected, with every 'unknown' group taken as two people. */
export function isAffectedIfUnknownCounted(r: TournamentReport): boolean {
  return isAffected(r) || r.findings.sharedKeys.some((s) => s.class === 'unknown');
}

export const CSV_HEADER = [
  'tournament_url',
  'host',
  'slug',
  'affected',
  'affected_if_unknown_counted',
  'empty_key_names',
  'shared_key_groups',
  'shared_key_entries',
  'overlap_groups',
  'disjoint_speaker_judge_groups',
  'disjoint_same_role_groups',
  'unknown_round_groups',
  'duplicate_groups',
  'cross_role_same_institution',
  'judge_role_dropped',
  'judge_role_lost_one_person',
  'results_pages',
  'empty_key_examples',
  'shared_key_examples',
  'round_evidence',
  'pages_read',
  'error',
] as const;

const CLASS_LABEL: Record<SharedKeyClass, string> = {
  overlap: 'overlapping rounds',
  disjoint: 'disjoint rounds',
  unknown: 'rounds unknown',
  duplicate: 'duplicate',
};

const MAX_EXAMPLES = 5;

/** The class, the roles, and for speaker+judge groups the institution match. */
function exampleLabel(s: SharedKey): string {
  const parts = [CLASS_LABEL[s.class]];
  if (s.class !== 'duplicate') parts.push(s.crossRole ? 'speaker+judge' : 'same role');
  if (s.crossRole && s.crossRoleInstitution) parts.push(`${s.crossRoleInstitution} institution`);
  return parts.join(', ');
}

function csvCell(v: string | number | boolean | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The CSV the owner reads: one row per tournament, affected ones first, then
 * those affected only if unknown groups count.
 * The tournament id is not in the export (index.jsonl carries URLs only), so
 * the row is keyed by the public tournament URL, which is exactly what
 * Tournament.sourceUrlRaw stores (lib/cv/publicTournamentUrl.ts) and what the
 * pre-scrape runner takes as input.
 */
export function toCsv(reports: TournamentReport[]): string {
  const rank = (r: TournamentReport) => (isAffected(r) ? 2 : isAffectedIfUnknownCounted(r) ? 1 : 0);
  const ordered = [...reports].sort((a, b) => rank(b) - rank(a) || (a.base < b.base ? -1 : 1));
  const lines = [CSV_HEADER.join(',')];
  for (const r of ordered) {
    const f = r.findings;
    // Overlaps first, so the five examples show what matters; the evidence
    // column follows the same order, one entry per example.
    const examples = [...f.sharedKeys]
      .sort((a, b) => CLASS_RANK[b.class] - CLASS_RANK[a.class])
      .slice(0, MAX_EXAMPLES);
    lines.push(
      [
        r.base,
        r.host,
        r.slug,
        isAffected(r),
        isAffectedIfUnknownCounted(r),
        f.emptyKeyNames.length,
        f.sharedKeys.length,
        f.sharedKeys.reduce((n, s) => n + s.entries, 0),
        ofClass(r, 'overlap').length,
        f.sharedKeys.filter(isSpeakerJudge).length,
        ofClass(r, 'disjoint').filter((s) => !s.crossRole).length,
        ofClass(r, 'unknown').length,
        ofClass(r, 'duplicate').length,
        f.sharedKeys.filter((s) => s.class !== 'duplicate' && s.crossRoleInstitution === 'same')
          .length,
        f.sharedKeys.filter((s) => s.judgeRoleDropped).length,
        f.sharedKeys.filter(isJudgeRoleLost).length,
        f.resultsPages ?? 0,
        f.emptyKeyNames.slice(0, MAX_EXAMPLES).join(' | '),
        examples
          .map(
            (s) =>
              `${s.names.join(' / ')} (x${s.entries}, ${exampleLabel(s)}, ${s.sources.join('+')})`,
          )
          .join(' | '),
        examples.map((s) => s.evidence).join(' | '),
        r.pagesRead.join(' '),
        r.error ?? null,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** Tournaments with at least one group, and the number of groups. */
export type Tally = { tournaments: number; groups: number };

export type Summary = {
  tournaments: number;
  /** The union: tournaments with (a) or an overlapping-rounds group, each counted once. */
  affected: number;
  /** The same union, with every rounds-unknown group taken as a collision too. */
  affectedIfUnknownCounted: number;
  withEmptyKey: number;
  withSharedKey: number;
  emptyKeyNames: number;
  sharedKeyGroups: number;
  /** Overlapping rounds: two people. Counted. */
  overlap: Tally;
  overlapSpeakerJudge: Tally;
  /** Disjoint rounds, a speaker and a judge entry: plausibly one person who did both. */
  disjointSpeakerJudge: Tally;
  /** Disjoint rounds, one role: plausibly a swing, replacement or organiser on several teams. */
  disjointSameRole: Tally;
  /** Some pair has no round data on one side. */
  unknown: Tally;
  duplicate: Tally;
  /** Speaker+judge groups (any class but duplicate) whose rows name the same institution. */
  crossRoleSameInstitution: Tally;
  judgeRoleDropped: Tally;
  /** Disjoint speaker+judge groups whose judge role the participants merge drops: lost credit. */
  judgeRoleLostByOnePerson: Tally;
  /** Tournaments with no results page read: their judge rounds are unknowable. */
  withoutResultsPages: number;
  errors: number;
};

function tally(reports: TournamentReport[], pick: (s: SharedKey) => boolean): Tally {
  const counts = reports.map((r) => r.findings.sharedKeys.filter(pick).length);
  return {
    tournaments: counts.filter((n) => n > 0).length,
    groups: counts.reduce((a, b) => a + b, 0),
  };
}

export function summarise(reports: TournamentReport[]): Summary {
  return {
    tournaments: reports.length,
    affected: reports.filter(isAffected).length,
    affectedIfUnknownCounted: reports.filter(isAffectedIfUnknownCounted).length,
    withEmptyKey: reports.filter((r) => r.findings.emptyKeyNames.length > 0).length,
    withSharedKey: reports.filter((r) => r.findings.sharedKeys.length > 0).length,
    emptyKeyNames: reports.reduce((n, r) => n + r.findings.emptyKeyNames.length, 0),
    sharedKeyGroups: reports.reduce((n, r) => n + r.findings.sharedKeys.length, 0),
    overlap: tally(reports, (s) => s.class === 'overlap'),
    overlapSpeakerJudge: tally(reports, (s) => s.class === 'overlap' && s.crossRole),
    disjointSpeakerJudge: tally(reports, isSpeakerJudge),
    disjointSameRole: tally(reports, (s) => s.class === 'disjoint' && !s.crossRole),
    unknown: tally(reports, (s) => s.class === 'unknown'),
    duplicate: tally(reports, (s) => s.class === 'duplicate'),
    crossRoleSameInstitution: tally(
      reports,
      (s) => s.class !== 'duplicate' && s.crossRoleInstitution === 'same',
    ),
    judgeRoleDropped: tally(reports, (s) => s.judgeRoleDropped),
    judgeRoleLostByOnePerson: tally(reports, isJudgeRoleLost),
    withoutResultsPages: reports.filter((r) => !r.findings.resultsPages).length,
    errors: reports.filter((r) => r.error).length,
  };
}

// ── Export coverage ─────────────────────────────────────────────────────────

export type ExportUrlStats = {
  /** Lines in index.jsonl. */
  documents: number;
  /** Distinct document URLs (several snapshots of one URL count once). */
  distinctUrls: number;
  /** Tournament addresses with a tab page: the "Tournaments with a tab page" total. */
  tournamentUrls: number;
  /** The same, with the slug's case and http/https folded, as ingest's lookups fold them. */
  foldedUrls: number;
  /**
   * Addresses that hold only API JSON on a host that also has a root-hosted
   * (slug-less) tab: very likely the root tournament's second row.
   */
  rootApiSplits: number;
  /** Distinct hosts. */
  hosts: number;
};

/**
 * How the export's tournament count is built, so it can be held against
 * `SELECT count(*) FROM "Tournament"`. Rows in Tournament are keyed by a
 * fingerprint of host, lower-cased slug, name and year
 * (lib/calicotab/fingerprint.ts) and found again by host + slug
 * case-insensitively and on either scheme (findTournamentByHostSlug); the
 * export is keyed by URL. The folded count applies the same folding.
 */
export function exportUrlStats(
  entries: IndexEntry[],
  tournaments: TournamentDocuments[],
): ExportUrlStats {
  const folded = new Set(
    tournaments.map((t) => `${t.host.toLowerCase()}/${(t.slug ?? '').toLowerCase()}`),
  );
  const rootHosts = new Set(tournaments.filter((t) => t.slug === null).map((t) => t.host));
  const apiOnly = new Set(
    tournaments
      .filter(
        (t) =>
          t.slug !== null &&
          rootHosts.has(t.host) &&
          Object.keys(t.docs).every((k) => k === 'apiTeams' || k === 'apiAdjudicators'),
      )
      .map((t) => `${t.host}/${(t.slug ?? '').toLowerCase()}`),
  );
  return {
    documents: entries.length,
    distinctUrls: new Set(entries.map((e) => e.url)).size,
    tournamentUrls: tournaments.length,
    foldedUrls: folded.size,
    rootApiSplits: apiOnly.size,
    hosts: new Set(tournaments.map((t) => t.host)).size,
  };
}

/** The list of affected tournament URLs, one per line: the input the re-ingest step takes. */
export function affectedList(reports: TournamentReport[]): string {
  return reports
    .filter(isAffected)
    .map((r) => r.base)
    .sort()
    .join('\n');
}
