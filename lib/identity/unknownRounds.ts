import { parsePrivateUrlPage } from '@/lib/calicotab/parseNav';
import { cleanName } from '@/lib/calicotab/tabbycatApi';
import { csvLine } from '@/lib/utils/csv';
import type {
  IndexEntry,
  TournamentReport,
  UndecidedEntry,
  UndecidedPair,
} from '@/lib/identity/affectedTournaments';

/**
 * The owner's hand-analysis sheet for the shared-name groups the identity
 * check cannot decide ('rounds unknown'; lib/identity/affectedTournaments.ts).
 * One row per undecided group: the pair that left it undecided, side by side,
 * with the rounds each side is evidenced in, why the checker gave up, and a
 * deliberately simple hint. The owner fills `owner_verdict` with one / two.
 * Runbook: docs/runbooks/identity-affected-tournaments.md, section 1b.
 *
 * The hint only uses what a debater would look at first. It is not a third
 * classifier: a 'likely' here never moves a tournament onto the re-ingest
 * list, the owner's verdict does.
 */

export const UNKNOWN_ROUNDS_HEADER = [
  'tournament_url',
  'tournament_name',
  'name_as_listed',
  'role_a',
  'role_b',
  'team_a',
  'team_b',
  'institution_a',
  'institution_b',
  'rounds_known_a',
  'rounds_known_b',
  'why_unknown',
  'team_results_pages_available',
  'suggested',
  'owner_verdict',
] as const;

type Reason = { code: string; text: string };

const REASONS = {
  noResultsPages: { code: 'no_results_pages', text: 'results pages missing for this tournament' },
  speakerTeamNoResults: {
    code: 'speaker_no_rounds',
    text: 'no scored speaker rounds and team has no results page',
  },
  speakerNoTeam: { code: 'speaker_no_team', text: 'no scored speaker rounds and no team named' },
  judgeNotOnResults: { code: 'judge_not_on_results', text: 'judge appears on no results page' },
  sameSpellingJudges: {
    code: 'same_spelling_judges',
    text: 'same-spelled judges merged in results',
  },
  noRole: { code: 'no_role', text: 'row has no speaker or judge role, so no rounds' },
} satisfies Record<string, Reason>;

/** Why one side has no rounds; null when it has some. */
function sideReason(e: UndecidedEntry, resultsPages: number): Reason | null {
  if (e.rounds.length > 0) return null;
  // With no results page at all, every other explanation is downstream of it.
  if (resultsPages === 0) return REASONS.noResultsPages;
  if (e.role === 'speaker') return e.team ? REASONS.speakerTeamNoResults : REASONS.speakerNoTeam;
  if (e.role === 'adjudicator') return REASONS.judgeNotOnResults;
  return REASONS.noRole;
}

/** "code: sentence", one per distinct reason, joined with "; ". */
export function whyUnknown(pair: UndecidedPair, resultsPages: number): string {
  const reasons = pair.sameSpellingJudges
    ? [REASONS.sameSpellingJudges]
    : [sideReason(pair.a, resultsPages), sideReason(pair.b, resultsPages)];
  const seen = new Map<string, string>();
  for (const r of reasons) if (r) seen.set(r.code, `${r.code}: ${r.text}`);
  return seen.size > 0 ? [...seen.values()].join('; ') : 'undecided: no reason recorded';
}

export type Suggestion = 'likely one person' | 'likely two people' | 'no evidence';

/**
 * The owner's simple rule. Different institutions: likely two people. The
 * same institution and no round in common among the rounds that are known
 * (a side with none known clashes with nothing): likely one person. Anything
 * else, including either institution blank: no evidence.
 */
export function suggest(pair: UndecidedPair): Suggestion {
  const ia = cleanName(pair.a.institution).toLowerCase();
  const ib = cleanName(pair.b.institution).toLowerCase();
  if (!ia || !ib) return 'no evidence';
  if (ia !== ib) return 'likely two people';
  const clash = pair.a.rounds.some((r) => pair.b.rounds.includes(r));
  return clash ? 'no evidence' : 'likely one person';
}

function roleWord(role: UndecidedEntry['role']): string {
  return role === 'adjudicator' ? 'judge' : role === 'speaker' ? 'speaker' : 'other';
}

/**
 * One row per undecided group, in tournament order. A group of three or more
 * entries shows the first pair that could not be decided; the owner's
 * verdict on that pair settles whether the name is one person or more.
 */
export function unknownRoundsRows(reports: TournamentReport[]): string[][] {
  const rows: string[][] = [];
  const ordered = [...reports].sort((x, y) => (x.base < y.base ? -1 : x.base > y.base ? 1 : 0));
  for (const r of ordered) {
    const pages = r.findings.resultsPages ?? 0;
    for (const s of r.findings.sharedKeys) {
      if (s.class !== 'unknown' || !s.undecided) continue;
      const { a, b } = s.undecided;
      rows.push([
        r.base,
        r.name ?? '',
        a.name === b.name ? a.name : `${a.name} / ${b.name}`,
        roleWord(a.role),
        roleWord(b.role),
        a.team,
        b.team,
        a.institution,
        b.institution,
        a.rounds.join(','),
        b.rounds.join(','),
        whyUnknown(s.undecided, pages),
        pages > 0 ? 'yes' : 'no',
        suggest(s.undecided),
        '',
      ]);
    }
  }
  return rows;
}

/** The sheet as CSV (CRLF, header first); the caller adds the byte-order mark. */
export function toUnknownRoundsCsv(rows: string[][]): string {
  return [csvLine([...UNKNOWN_ROUNDS_HEADER]), ...rows.map(csvLine)].join('\r\n') + '\r\n';
}

/**
 * The tournament's name from its stored landing page, read the way ingest
 * reads it (parsePrivateUrlPage's <title> handling). Null when no landing
 * page was stored or it cannot be parsed: the column is a convenience, so a
 * bad page leaves it blank rather than failing the run.
 */
export function tournamentNameOf(
  landing: IndexEntry | undefined,
  read: (entry: IndexEntry) => string,
): string | null {
  if (!landing) return null;
  try {
    return parsePrivateUrlPage(read(landing), landing.url).tournamentName;
  } catch {
    return null;
  }
}
