import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { isPlaceholderPersonName, isRedactedName } from '@/lib/calicotab/names';
import {
  parseParticipantsList,
  parseSpeakerTab,
  parseTeamTab,
  type ParticipantsRow,
  type SpeakerTabRow,
  type TeamTabRow,
} from '@/lib/calicotab/parseTabs';
import { cleanName } from '@/lib/calicotab/tabbycatApi';
import { mapParticipants, type ApiAdjudicator, type ApiRoundsTeam } from '@/lib/calicotab/tabbycatApiRounds';

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
 *   (b) two different entries at one tournament whose v1 keys are equal —
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
 * Counting rules, deliberately conservative toward "affected":
 * - Redacted and stand-in names ("<em>Redacted</em>", "Speaker 1") are left
 *   out of (b). They share a key by design and ingest already handles them
 *   (names.ts, redactedSpeaker.ts); counting them would flag nearly every
 *   tournament.
 * - (a) needs at least one letter or digit in the raw name. Punctuation-only
 *   cells ("—", "?") are not people, and v2 drops them too.
 * - (b) is judged within ONE list at a time (team tab rosters, speaker tab,
 *   participants list, API participants). Each list names each person once,
 *   so two rows with one key in one list are two entries. Across lists the
 *   same person appears in every list, so matching across them would count
 *   everyone. Rows identical in every field are counted once, so a parser
 *   that reads one row twice does not invent a namesake.
 *
 * Not every shared key is a merge that loses a person, so each one is put in
 * exactly one class, judged against what ingest actually writes:
 *
 *   sameRole  — two speaker rows, or two adjudicator rows, with one key and a
 *               different team or institution. A real collision: the
 *               speaker loop upserts both onto one (tournamentId, personId)
 *               TournamentParticipant, the second overwriting the first's
 *               team, rank and total; and participantByName keeps only the
 *               last adjudicator row, so the other judge gets no row at all.
 *   crossRole — a speaker row and an adjudicator (or other) row with one
 *               key, and no same-role pair. Also a real collision. The
 *               owner's domain rule: nobody is both a speaker and a judge at
 *               one tournament, so a key on both lists is two people
 *               (namesakes), not one participant holding two roles. ingest
 *               still gives them one Person and one TournamentParticipant,
 *               and participantByName keeps only one of the two rows (see
 *               judgeRoleDropped below). An 'other' row (no role column, no
 *               section title) is counted the same way, conservatively.
 *               `crossRoleInstitution` says whether the speaker and judge
 *               rows name the same institution: the one case where a data
 *               error rather than a namesake is plausible, kept apart so the
 *               owner can eyeball it.
 *   duplicate — the same role with the same team and institution: one
 *               person listed twice (a second table on the page, a split
 *               category tab), not a namesake.
 *
 * `judgeRoleDropped` flags a participants-list group where participantByName
 * (Map.set, last row wins) ends on a non-adjudicator row while an
 * adjudicator row shares the key: ingest writes no judge role for that key,
 * because the adjudicator loop only reads rows still marked adjudicator.
 * Tabbycat lists the Adjudicators table before the Speakers table, so the
 * speaker row usually wins. Under the owner's rule this is not a separate
 * bug: it is how the cross-role collision shows up, the judge namesake
 * losing their row to the speaker namesake. Every such key is already a
 * cross-role (or same-role) group, so it adds nothing to "affected"; it is
 * reported as the count of keys where the merge visibly lost the judge.
 */

export type DocumentKind = 'teamTab' | 'speakerTab' | 'participants' | 'apiTeams' | 'apiAdjudicators';

export type ClassifiedUrl = {
  /** Public tournament base, `https://host/slug/` (or `https://host/` when root-hosted). */
  base: string;
  host: string;
  slug: string | null;
  kind: DocumentKind;
};

// Same paths extractNavigation (lib/calicotab/parseNav.ts) accepts for these tabs.
const HTML_KINDS: Array<[RegExp, DocumentKind]> = [
  [/^(.*?)\/tab\/(?:team(?:-standings)?|overall)\/?$/, 'teamTab'],
  [/^(.*?)\/tab\/speaker(?:-standings)?\/?$/, 'speakerTab'],
  [/^(.*?)\/participants\/list\/?$/, 'participants'],
];

/**
 * The tournament and page kind of one stored document URL, or null when it
 * is not one of the pages this check reads (landing pages, rounds, break
 * tabs, motions, other API endpoints, private URLs).
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
    const slug = api[1]!;
    return { base: `${u.origin}/${slug}/`, host: u.host, slug, kind: api[2] === 'teams' ? 'apiTeams' : 'apiAdjudicators' };
  }
  for (const [re, kind] of HTML_KINDS) {
    const m = path.match(re);
    if (!m) continue;
    const prefix = m[1]!.split('/').filter(Boolean);
    // Tabbycat tournaments live at /<slug>/...; a root-hosted install has
    // the tabs directly under /. Anything deeper is not a tab page.
    if (prefix.length > 1) return null;
    const slug = prefix[0] ?? null;
    return { base: slug ? `${u.origin}/${slug}/` : `${u.origin}/`, host: u.host, slug, kind };
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
};

/**
 * Group the export index by tournament, keeping the newest 200 document of
 * each kind. The export can hold several snapshots of one URL (one per
 * content hash), and a tab may be stored under two URL spellings
 * (/tab/team/ and /tab/team-standings/); the newest wins either way.
 */
export function groupByTournament(entries: Iterable<IndexEntry>): TournamentDocuments[] {
  const byBase = new Map<string, TournamentDocuments>();
  for (const e of entries) {
    if (e.status != null && e.status !== 200) continue;
    const c = classifyDocumentUrl(e.url);
    if (!c) continue;
    let t = byBase.get(c.base);
    if (!t) {
      t = { base: c.base, host: c.host, slug: c.slug, docs: {} };
      byBase.set(c.base, t);
    }
    const prev = t.docs[c.kind];
    if (!prev || time(e.fetchedAt) > time(prev.fetchedAt)) t.docs[c.kind] = e;
  }
  return [...byBase.values()].sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0));
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
};

/**
 * Parse the bodies of one tournament's documents with the ingest parsers.
 * `read` returns a document's decompressed body. The two API lists are only
 * combined when the teams list is present, as ingest's API participants path
 * needs both (an absent adjudicators list reads as none).
 */
export function parseTournamentDocuments(
  docs: TournamentDocuments['docs'],
  read: (entry: IndexEntry) => string,
): ParsedLists {
  const out: ParsedLists = {};
  if (docs.teamTab) out.teamRows = parseTeamTab(read(docs.teamTab));
  if (docs.speakerTab) out.speakerRows = parseSpeakerTab(read(docs.speakerTab));
  if (docs.participants) out.participantRows = parseParticipantsList(read(docs.participants));
  if (docs.apiTeams) {
    const teams = jsonList(read(docs.apiTeams)).filter(isApiTeam);
    const adjudicators = docs.apiAdjudicators ? jsonList(read(docs.apiAdjudicators)).filter(isApiAdjudicator) : [];
    out.apiParticipantRows = mapParticipants({ teams, adjudicators });
  }
  return out;
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
    v.speakers.every((s) => isObject(s) && (s.name === null || typeof s.name === 'string') && typeof s.anonymous === 'boolean')
  );
}

function isApiAdjudicator(v: unknown): v is ApiAdjudicator {
  return isObject(v) && (v.name === null || typeof v.name === 'string') && typeof v.anonymous === 'boolean';
}

// ── The check ───────────────────────────────────────────────────────────────

export type SharedKeyClass = 'sameRole' | 'crossRole' | 'duplicate';

export type SharedKey = {
  key: string;
  /** Raw spellings seen for this key, in first-seen order. */
  names: string[];
  /** The largest number of distinct entries sharing the key in any one list. */
  entries: number;
  /** Which lists showed the collision. */
  sources: string[];
  /** The strongest class any one list showed (sameRole > crossRole > duplicate). */
  class: SharedKeyClass;
  /** The participants merge leaves this key with no adjudicator row (a symptom of the collision). */
  judgeRoleDropped: boolean;
  /**
   * For a key that some list holds under two roles: whether a speaker row
   * and a judge row name the same institution ('same'), only different ones
   * ('different'), or one side names none ('unknown'). null when no list
   * held the key under two roles.
   */
  crossRoleInstitution: InstitutionMatch | null;
};

export type InstitutionMatch = 'same' | 'different' | 'unknown';

export type TournamentFindings = {
  /** (a) Distinct raw names with letters whose v1 key is empty. */
  emptyKeyNames: string[];
  /** (b) Keys held by two or more distinct entries in one list. */
  sharedKeys: SharedKey[];
};

type Role = ParticipantsRow['role'];
type Entry = { name: string; identity: string; role: Role; affiliation: string; institution: string };

const CLASS_RANK: Record<SharedKeyClass, number> = { duplicate: 0, crossRole: 1, sameRole: 2 };
const MATCH_RANK: Record<InstitutionMatch, number> = { unknown: 0, different: 1, same: 2 };

/** Spelled loosely enough that one team or institution reads as one. */
function loose(s: string | null | undefined): string {
  return cleanName(s ?? '').toLowerCase();
}

/** Team and institution together. */
function affiliation(team: string | null | undefined, institution: string | null | undefined): string {
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
        !a.institution || !b.institution ? 'unknown' : a.institution === b.institution ? 'same' : 'different';
      if (best === null || MATCH_RANK[m] > MATCH_RANK[best]) best = m;
    }
  }
  return best;
}

/**
 * The class of one key within one list. `rows` are the distinct entries (at
 * least two). 'other' rows (neither speaker nor adjudicator) are never
 * written as people, so they only ever make a group cross-role.
 */
function classify(rows: Entry[]): SharedKeyClass {
  for (const role of ['speaker', 'adjudicator'] as const) {
    const affs = new Set(rows.filter((r) => r.role === role).map((r) => r.affiliation));
    if (affs.size >= 2) return 'sameRole';
  }
  if (new Set(rows.map((r) => r.role)).size >= 2) return 'crossRole';
  return 'duplicate';
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
        identity: JSON.stringify([r.speakerName, r.teamName, r.institution, r.rank, r.totalScore, r.roundScores.map((s) => s.score)]),
        role: 'speaker' as const,
        affiliation: affiliation(r.teamName, r.institution),
        institution: loose(r.institution),
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
    }));
  if (lists.participantRows) {
    sources.push({ source: 'participants', entries: fromParticipants(lists.participantRows), mergedByName: true });
  }
  if (lists.apiParticipantRows) {
    sources.push({ source: 'api participants', entries: fromParticipants(lists.apiParticipantRows), mergedByName: true });
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
    if (!g.rows.has(e.identity)) g.rows.set(e.identity, e);
    g.lastRole = e.role;
    if (!g.names.includes(name)) g.names.push(name);
  }
  return byKey;
}

export function findIdentityIssues(lists: ParsedLists): TournamentFindings {
  const lost = new Set<string>();
  const shared = new Map<string, SharedKey>();
  for (const { source, entries, mergedByName } of sourcesOf(lists)) {
    for (const [key, g] of groupByKey(entries, lost)) {
      if (g.rows.size < 2) continue;
      const rows = [...g.rows.values()];
      const cls = classify(rows);
      const dropped = mergedByName && g.lastRole !== 'adjudicator' && rows.some((r) => r.role === 'adjudicator');
      const inst = institutionMatch(rows);
      const s: SharedKey = shared.get(key) ?? {
        key,
        names: [],
        entries: 0,
        sources: [],
        class: cls,
        judgeRoleDropped: false,
        crossRoleInstitution: null,
      };
      s.names.push(...g.names.filter((n) => !s.names.includes(n)));
      s.entries = Math.max(s.entries, g.rows.size);
      s.sources.push(source);
      if (CLASS_RANK[cls] > CLASS_RANK[s.class]) s.class = cls;
      s.judgeRoleDropped ||= dropped;
      if (inst && (s.crossRoleInstitution === null || MATCH_RANK[inst] > MATCH_RANK[s.crossRoleInstitution])) {
        s.crossRoleInstitution = inst;
      }
      shared.set(key, s);
    }
  }
  return {
    emptyKeyNames: [...lost].sort(),
    sharedKeys: [...shared.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

// ── Output ──────────────────────────────────────────────────────────────────

export type TournamentReport = {
  base: string;
  host: string;
  slug: string | null;
  pagesRead: DocumentKind[];
  findings: TournamentFindings;
  error?: string;
};

function ofClass(r: TournamentReport, cls: SharedKeyClass): SharedKey[] {
  return r.findings.sharedKeys.filter((s) => s.class === cls);
}

/** A shared key that is two people merged into one: same-role or cross-role. */
function isCollision(s: SharedKey): boolean {
  return s.class === 'sameRole' || s.class === 'crossRole';
}

/**
 * Would a phase-7 re-ingest change this tournament? (a), or any real
 * collision: same-role, or cross-role (a speaker and a judge at one
 * tournament are never one person). A duplicate row is one person and does
 * not count.
 */
export function isAffected(r: TournamentReport): boolean {
  return r.findings.emptyKeyNames.length > 0 || r.findings.sharedKeys.some(isCollision);
}

function crossRoleWith(r: TournamentReport, m: InstitutionMatch): number {
  return ofClass(r, 'crossRole').filter((s) => s.crossRoleInstitution === m).length;
}

export const CSV_HEADER = [
  'tournament_url',
  'host',
  'slug',
  'affected',
  'empty_key_names',
  'shared_key_groups',
  'shared_key_entries',
  'same_role_groups',
  'cross_role_groups',
  'cross_role_same_institution',
  'cross_role_different_institution',
  'cross_role_unknown_institution',
  'duplicate_groups',
  'judge_role_dropped',
  'empty_key_examples',
  'shared_key_examples',
  'pages_read',
  'error',
] as const;

const CLASS_LABEL: Record<SharedKeyClass, string> = { sameRole: 'same-role', crossRole: 'cross-role', duplicate: 'duplicate' };

const MAX_EXAMPLES = 5;

/** "cross-role, same institution" for cross-role groups, so the owner can scan for them. */
function exampleLabel(s: SharedKey): string {
  if (s.class !== 'crossRole' || !s.crossRoleInstitution) return CLASS_LABEL[s.class];
  return `${CLASS_LABEL[s.class]}, ${s.crossRoleInstitution} institution`;
}

function csvCell(v: string | number | boolean | null): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The CSV the owner reads: one row per tournament, affected ones first.
 * The tournament id is not in the export (index.jsonl carries URLs only), so
 * the row is keyed by the public tournament URL, which is exactly what
 * Tournament.sourceUrlRaw stores (lib/cv/publicTournamentUrl.ts) and what the
 * pre-scrape runner takes as input.
 */
export function toCsv(reports: TournamentReport[]): string {
  const ordered = [...reports].sort((a, b) => Number(isAffected(b)) - Number(isAffected(a)) || (a.base < b.base ? -1 : 1));
  const lines = [CSV_HEADER.join(',')];
  for (const r of ordered) {
    const f = r.findings;
    lines.push(
      [
        r.base,
        r.host,
        r.slug,
        isAffected(r),
        f.emptyKeyNames.length,
        f.sharedKeys.length,
        f.sharedKeys.reduce((n, s) => n + s.entries, 0),
        ofClass(r, 'sameRole').length,
        ofClass(r, 'crossRole').length,
        crossRoleWith(r, 'same'),
        crossRoleWith(r, 'different'),
        crossRoleWith(r, 'unknown'),
        ofClass(r, 'duplicate').length,
        f.sharedKeys.filter((s) => s.judgeRoleDropped).length,
        f.emptyKeyNames.slice(0, MAX_EXAMPLES).join(' | '),
        // Real collisions first, so the five examples show what matters.
        [...f.sharedKeys]
          .sort((a, b) => CLASS_RANK[b.class] - CLASS_RANK[a.class])
          .slice(0, MAX_EXAMPLES)
          .map((s) => `${s.names.join(' / ')} (x${s.entries}, ${exampleLabel(s)}, ${s.sources.join('+')})`)
          .join(' | '),
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
  /** The union: tournaments with (a), a same-role or a cross-role group, each counted once. */
  affected: number;
  /** Tournaments with a same-role or a cross-role group, each counted once. */
  withCollision: number;
  withEmptyKey: number;
  withSharedKey: number;
  emptyKeyNames: number;
  sharedKeyGroups: number;
  sameRole: Tally;
  crossRole: Tally;
  /** The cross-role groups split by whether speaker and judge share an institution. */
  crossRoleSameInstitution: Tally;
  crossRoleDifferentInstitution: Tally;
  crossRoleUnknownInstitution: Tally;
  duplicate: Tally;
  judgeRoleDropped: Tally;
  errors: number;
};

function tally(reports: TournamentReport[], pick: (s: SharedKey) => boolean): Tally {
  const counts = reports.map((r) => r.findings.sharedKeys.filter(pick).length);
  return { tournaments: counts.filter((n) => n > 0).length, groups: counts.reduce((a, b) => a + b, 0) };
}

export function summarise(reports: TournamentReport[]): Summary {
  return {
    tournaments: reports.length,
    affected: reports.filter(isAffected).length,
    withCollision: reports.filter((r) => r.findings.sharedKeys.some(isCollision)).length,
    withEmptyKey: reports.filter((r) => r.findings.emptyKeyNames.length > 0).length,
    withSharedKey: reports.filter((r) => r.findings.sharedKeys.length > 0).length,
    emptyKeyNames: reports.reduce((n, r) => n + r.findings.emptyKeyNames.length, 0),
    sharedKeyGroups: reports.reduce((n, r) => n + r.findings.sharedKeys.length, 0),
    sameRole: tally(reports, (s) => s.class === 'sameRole'),
    crossRole: tally(reports, (s) => s.class === 'crossRole'),
    crossRoleSameInstitution: tally(reports, (s) => s.class === 'crossRole' && s.crossRoleInstitution === 'same'),
    crossRoleDifferentInstitution: tally(reports, (s) => s.class === 'crossRole' && s.crossRoleInstitution === 'different'),
    crossRoleUnknownInstitution: tally(reports, (s) => s.class === 'crossRole' && s.crossRoleInstitution === 'unknown'),
    duplicate: tally(reports, (s) => s.class === 'duplicate'),
    judgeRoleDropped: tally(reports, (s) => s.judgeRoleDropped),
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
export function exportUrlStats(entries: IndexEntry[], tournaments: TournamentDocuments[]): ExportUrlStats {
  const folded = new Set(tournaments.map((t) => `${t.host.toLowerCase()}/${(t.slug ?? '').toLowerCase()}`));
  const rootHosts = new Set(tournaments.filter((t) => t.slug === null).map((t) => t.host));
  const apiOnly = new Set(
    tournaments
      .filter(
        (t) =>
          t.slug !== null &&
          rootHosts.has(t.host) &&
          Object.keys(t.docs).every((k) => k === 'apiTeams' || k === 'apiAdjudicators'),
      )
      .map((t) => `${t.host}/${t.slug!.toLowerCase()}`),
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
