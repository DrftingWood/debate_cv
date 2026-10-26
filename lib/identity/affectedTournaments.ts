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

export type SharedKey = {
  key: string;
  /** Raw spellings seen for this key, in first-seen order. */
  names: string[];
  /** The largest number of distinct entries sharing the key in any one list. */
  entries: number;
  /** Which lists showed the collision. */
  sources: string[];
};

export type TournamentFindings = {
  /** (a) Distinct raw names with letters whose v1 key is empty. */
  emptyKeyNames: string[];
  /** (b) Keys held by two or more distinct entries in one list. */
  sharedKeys: SharedKey[];
};

type Entry = { name: string; identity: string };

/** Does v1 throw away a whole name a person would recognise as theirs? */
export function isLostName(name: string): boolean {
  return /[\p{L}\p{N}]/u.test(name) && normalizePersonName(name) === '';
}

function ignoredForSharing(name: string): boolean {
  return isRedactedName(name) || isPlaceholderPersonName(name);
}

export function findIdentityIssues(lists: ParsedLists): TournamentFindings {
  const sources: Array<[string, Entry[]]> = [];
  if (lists.teamRows) {
    sources.push([
      'team tab',
      lists.teamRows.flatMap((t, i) =>
        // A roster lists each member once; the row index keeps two
        // same-named teams' rosters apart.
        t.speakers.map((s, j) => ({ name: cleanName(s), identity: JSON.stringify([i, j]) })),
      ),
    ]);
  }
  if (lists.speakerRows) {
    sources.push([
      'speaker tab',
      lists.speakerRows.map((r) => ({
        name: r.speakerName,
        identity: JSON.stringify([r.speakerName, r.teamName, r.institution, r.rank, r.totalScore, r.roundScores.map((s) => s.score)]),
      })),
    ]);
  }
  const fromParticipants = (rows: ParticipantsRow[]): Entry[] =>
    rows.map((r) => ({ name: r.name, identity: JSON.stringify([r.name, r.role, r.judgeTag, r.teamName, r.institution]) }));
  if (lists.participantRows) sources.push(['participants', fromParticipants(lists.participantRows)]);
  if (lists.apiParticipantRows) sources.push(['api participants', fromParticipants(lists.apiParticipantRows)]);

  const lost = new Set<string>();
  const shared = new Map<string, SharedKey>();
  for (const [source, entries] of sources) {
    const byKey = new Map<string, { names: string[]; identities: Set<string> }>();
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
      let g = byKey.get(key);
      if (!g) {
        g = { names: [], identities: new Set() };
        byKey.set(key, g);
      }
      g.identities.add(e.identity);
      if (!g.names.includes(name)) g.names.push(name);
    }
    for (const [key, g] of byKey) {
      if (g.identities.size < 2) continue;
      const s = shared.get(key) ?? { key, names: [], entries: 0, sources: [] };
      for (const n of g.names) if (!s.names.includes(n)) s.names.push(n);
      s.entries = Math.max(s.entries, g.identities.size);
      s.sources.push(source);
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

export function isAffected(r: TournamentReport): boolean {
  return r.findings.emptyKeyNames.length > 0 || r.findings.sharedKeys.length > 0;
}

export const CSV_HEADER = [
  'tournament_url',
  'host',
  'slug',
  'affected',
  'empty_key_names',
  'shared_key_groups',
  'shared_key_entries',
  'empty_key_examples',
  'shared_key_examples',
  'pages_read',
  'error',
] as const;

const MAX_EXAMPLES = 5;

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
        f.emptyKeyNames.slice(0, MAX_EXAMPLES).join(' | '),
        f.sharedKeys
          .slice(0, MAX_EXAMPLES)
          .map((s) => `${s.names.join(' / ')} (x${s.entries}, ${s.sources.join('+')})`)
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

export type Summary = {
  tournaments: number;
  affected: number;
  withEmptyKey: number;
  withSharedKey: number;
  emptyKeyNames: number;
  sharedKeyGroups: number;
  errors: number;
};

export function summarise(reports: TournamentReport[]): Summary {
  return {
    tournaments: reports.length,
    affected: reports.filter(isAffected).length,
    withEmptyKey: reports.filter((r) => r.findings.emptyKeyNames.length > 0).length,
    withSharedKey: reports.filter((r) => r.findings.sharedKeys.length > 0).length,
    emptyKeyNames: reports.reduce((n, r) => n + r.findings.emptyKeyNames.length, 0),
    sharedKeyGroups: reports.reduce((n, r) => n + r.findings.sharedKeys.length, 0),
    errors: reports.filter((r) => r.error).length,
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
