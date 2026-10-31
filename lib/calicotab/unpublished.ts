import type { NavigationStructure } from './parseNav';
import { extractVueData } from './parseTabs';
import { matchStage } from './stageLexicon';
import {
  pieceLabel,
  wantsPiece,
  type PieceKind,
  type PieceOutcome,
  type PieceRef,
} from './scrapePieces';

// What a tournament never published is a fact about the tournament, not a gap
// in our scrape. Two shapes leave no page to load:
//   - a tab the menu does not link while the menu links others (the team tab
//     of a tournament that keeps standings private), and
//   - a results round whose page loads with its columns but `data: []`
//     (Tabbycat 2.12 renders "No Data Available" for a round never entered).
// Both are recorded as 'withheld' with reason 'not_published', which the
// audit treats like any withheld page: not applicable, never suggested.

const NO_PAGE = 'Not published by the tournament';

/**
 * Whether a results page loaded with a table that has columns but no rows in
 * any table. A page with no table at all is a layout we did not read, not an
 * unpublished round, so it does not count.
 */
export function roundPublishedEmpty(html: string): boolean {
  const tables = extractVueData(html);
  if (!tables || tables.length === 0) return false;
  return tables.every(
    (t) =>
      Array.isArray(t.head) && t.head.length > 0 && Array.isArray(t.data) && t.data.length === 0,
  );
}

/** The outcome for a round that loaded but was published with no results. */
export function emptyRoundOutcome(done: PieceOutcome): PieceOutcome {
  return {
    ...done,
    ok: false,
    error: 'Published with no results',
    withheld: true,
    reason: 'not_published',
  };
}

const NAV_TABS: Array<{
  nav: 'teamTab' | 'speakerTab' | 'motionsTab' | 'participants';
  kind: PieceKind;
}> = [
  { nav: 'teamTab', kind: 'team' },
  { nav: 'speakerTab', kind: 'speaker' },
  { nav: 'motionsTab', kind: 'motions' },
  { nav: 'participants', kind: 'participants' },
];

const notPublished = (ref: PieceRef, url: string, label: string): PieceOutcome => ({
  ...ref,
  label,
  url,
  ok: false,
  httpStatus: null,
  error: NO_PAGE,
  withheld: true,
  reason: 'not_published',
});

/**
 * The tab a fallback link stands for, when the tournament never linked it:
 * the outcome to record, or null when the page loaded (a normal piece) or
 * failed for a reason other than "not there" (a timeout, a 5xx: still a
 * failure). A 404/410 failed outcome is removed from `outcomes`.
 */
function unlinkedTab(outcomes: PieceOutcome[], kind: PieceKind, url: string): PieceOutcome | null {
  const i = outcomes.findIndex((o) => o.kind === kind);
  const seen = i >= 0 ? outcomes[i] : undefined;
  if (seen?.ok) return null;
  if (seen && seen.httpStatus !== 404 && seen.httpStatus !== 410) return null;
  if (seen) outcomes.splice(i, 1);
  return {
    ...notPublished({ kind, key: '' }, url, pieceLabel(kind, url)),
    httpStatus: seen?.httpStatus ?? null,
  };
}

/**
 * The pieces the tournament never linked. Judged only when the menu was read
 * (something was discovered on it), so a nav we failed to parse is not taken
 * for a tournament that published nothing. A tab the parser built as a
 * fallback (`constructed`) counts as not linked. A break tab counts only when
 * outround rounds are linked but no break tab is.
 *
 * Mutates `outcomes` (removes the converted failures) and returns the new
 * not-published outcomes to record beside them.
 */
export function unpublishedTabOutcomes(
  fullNav: NavigationStructure,
  outcomes: PieceOutcome[],
  only?: PieceRef[],
): PieceOutcome[] {
  const { discovered, constructed } = fullNav.meta;
  // "Other tabs are linked" means a content tab or a results round, not just
  // an institutions or break link.
  const linked = ['teamTab', 'speakerTab', 'motionsTab', 'participants', 'resultsRounds'];
  if (!discovered.some((d) => linked.includes(d))) return [];
  const out: PieceOutcome[] = [];
  for (const { nav, kind } of NAV_TABS) {
    const url = fullNav[nav];
    if (!url || !constructed.includes(nav) || !wantsPiece(only, { kind, key: '' })) continue;
    const piece = unlinkedTab(outcomes, kind, url);
    if (piece) out.push(piece);
  }
  const hasOutround = Object.values(fullNav.resultsRoundLabels).some((l) => matchStage(l) != null);
  if (
    hasOutround &&
    fullNav.breakTabs.length === 0 &&
    wantsPiece(only, { kind: 'break', key: 'open' })
  ) {
    const url = fullNav.home ?? fullNav.teamTab ?? '';
    out.push(notPublished({ kind: 'break', key: 'open' }, url, 'Break: Open'));
  }
  return out;
}
