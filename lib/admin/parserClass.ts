/**
 * Which parser warnings need the owner (Task R2). On 2026-10-31 the live
 * ledger was led by notes that describe a tab rather than a fault: "timing:
 * competition likely finished" (×184), "nav: breakTabs not found
 * (optional)", "nav: teamTab constructed as fallback", "tabs: team tab not
 * released", "nav: limited tab visibility may be intentional". Those say the
 * tournament chose to hide something, or that the parser found its way round
 * a missing link; nobody can fix them, and a properly scraped tournament must
 * never be highlighted. The real problems ("parse: round … → 0 results",
 * "fetch: participants HTTP 403", "nav: resultsRounds not found") were
 * buried beneath them.
 *
 * So the informational shapes are named, and everything else is a problem:
 * a headline nobody has seen before is surfaced, never hidden, because the
 * cost of a missed fault is a wrong CV and the cost of a stray note is one
 * "Mark checked". Pure, so the Parser tab's toggle and the Inbox agree.
 */

export type WarningClass = 'problem' | 'info';

/** Notes about how a tab is published, not faults in reading it. Checked first. */
const INFO = new RegExp(
  [
    'likely finished',
    '\\(optional\\)',
    'constructed as fallback',
    'not released',
    'limited tab visibility',
    // A tab published for the top N only (tabbycatApi.ts: "<tab> tab released
    // to top N only") or in part is the tournament's own choice.
    'released to top',
    'partial release',
    // A tournament withholding its participants list answers 401/403; that
    // is a deliberate setting, not a fault. Other fetches (team, speaker,
    // round) refusing or missing stay problems.
    '^fetch: participants HTTP 40[13]',
  ].join('|'),
  'i',
);

/**
 * The problem shapes the parser writes on purpose: a page that read as empty,
 * a fetch the site refused, a parse that failed. "nav: resultsRounds not
 * found" is a problem too (a tab with no rounds gives a CV with no results),
 * reached as an unmatched headline rather than named here.
 */
const PROBLEM = /→ 0 results|^fetch: .*HTTP|^parse:/i;

/** 'info' for a note about how the tab is published; 'problem' for anything else. */
export function classifyWarning(headline: string): WarningClass {
  return INFO.test(headline) ? 'info' : 'problem';
}

/**
 * A problem of a shape the parser names (empty page, refused fetch, failed
 * parse), as against one surfaced only because it matched nothing. The
 * Inbox ranks the first as a fail and the second as a warn.
 */
export function isPlainProblem(headline: string): boolean {
  return classifyWarning(headline) === 'problem' && PROBLEM.test(headline);
}
