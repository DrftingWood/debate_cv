import type { AuditInputs } from './auditInputs';
import {
  breakPieces,
  expectedPrelims,
  heldSentence,
  isWithheld,
  listText,
  outroundRoundPieces,
  plural,
  prelimPiece,
  result,
  suggest,
  tabPiece,
  withoutWithheld,
  type SuggestedPiece,
} from './checkHelpers';
import { checkBreakMatches, checkChampion, checkOutroundShape } from './outroundChecks';
import {
  checkPanels,
  checkPartners,
  checkPointsAddUp,
  checkRoomsConsistent,
  checkRoundsComplete,
  checkTeamCoverage,
} from './roundChecks';
import type { CheckResult, CheckStatus } from './types';

/**
 * The data-accuracy check engine: AuditInputs in, one CheckResult per check
 * out, in the spec's order with user reports last. Pure: the loader reads the
 * database, the scorer (score.ts) turns the results into a number. Design:
 * docs/superpowers/specs/2026-10-31-data-accuracy-design.md.
 */

export type { AuditInputs, AuditPiece } from './auditInputs';
export { minSpeakers, teamsPerRoom } from './checkHelpers';

/**
 * Bump when a check's rule changes, so the cron re-audits every tournament
 * instead of trusting results computed under the old rule.
 */
export const CHECKS_VERSION = '2026-10-31.8';

function checkSpeakerTab(inputs: AuditInputs): CheckResult {
  const { speakerParticipants: all, speakersWithScores: scored } = inputs;
  if (all === 0) return result('speaker_tab', 'na', 'No speakers are on record.');
  const share = scored / all;
  const status: CheckStatus = share < 0.5 ? 'fail' : share < 0.8 ? 'warn' : 'pass';
  // An unreleased speaker tab answers 404 and is recorded as withheld: the
  // missing scores are the tournament's choice, and no re-scrape brings them,
  // so the check does not apply rather than failing. A full set of scores
  // stored before the tab was pulled still passes.
  if (status !== 'pass' && isWithheld(inputs.pieces, 'speaker')) {
    return result('speaker_tab', 'na', heldSentence(inputs.pieces, 'speaker', 'speaker tab'));
  }
  return result(
    'speaker_tab',
    status,
    `Speaker scores are on record for ${scored} of ${all} speakers.`,
    status === 'pass' ? [] : [tabPiece(inputs.pieces, 'speaker')],
  );
}

/** A tournament that withholds its motions page is not marked down for it. */
function checkMotions(inputs: AuditInputs): CheckResult {
  if (inputs.pieces.some((p) => p.kind === 'motions' && p.status === 'withheld')) {
    return result('motions', 'na', heldSentence(inputs.pieces, 'motions', 'motions page'));
  }
  const expected = expectedPrelims(inputs);
  if (expected.length === 0) {
    return result('motions', 'na', 'The number of prelim rounds is not known.');
  }
  const have = new Set(inputs.motionRounds);
  const missing = expected.filter((n) => !have.has(n));
  if (missing.length === 0) {
    return result('motions', 'pass', `All ${expected.length} prelim rounds have a motion.`);
  }
  // Only a warning: tournaments often hold back a round's motion on purpose.
  const names = listText(missing.map((n) => `R${n}`));
  return result(
    'motions',
    'warn',
    `${names} ${plural(missing.length, 'has', 'have')} no motion on record.`,
    [tabPiece(inputs.pieces, 'motions')],
  );
}

function checkScrapeIncomplete(inputs: AuditInputs): CheckResult {
  const failed = inputs.pieces.filter((p) => p.status === 'failed');
  if (failed.length === 0) return result('scrape_incomplete', 'pass', 'No page failed to load.');
  const pages = plural(failed.length, 'page', 'pages');
  return result(
    'scrape_incomplete',
    'fail',
    `${failed.length} ${pages} failed to load: ${listText(failed.map((p) => p.label))}.`,
    failed.map(suggest),
  );
}

/** No pieces: an old parser's gaps are unknown, so the fix is a full re-scrape. */
function checkParserStale(parserVersion: string | null, current: string): CheckResult {
  if (parserVersion === current) {
    return result('parser_stale', 'pass', 'Scraped with the current parser.');
  }
  if (parserVersion == null) {
    return result('parser_stale', 'warn', 'No parser version is recorded for this scrape.');
  }
  return result(
    'parser_stale',
    'warn',
    `Scraped with parser ${parserVersion}; the current one is ${current}.`,
  );
}

/**
 * A tournament with stored rounds but no recorded format. The format decides
 * how many teams share a room and how many speakers a team needs, so several
 * other checks lean on it; and it shows on the CV. With no rounds stored
 * there is nothing a format could be read from, so the check does not apply.
 * The suggested pages (R1 and the team tab) are what a re-scrape needs when
 * the stored data cannot settle the format ("Infer format" says so first).
 */
function checkFormatMissing(inputs: AuditInputs): CheckResult {
  const format = inputs.format?.trim();
  if (format) return result('format_missing', 'pass', `The format is ${format}.`);
  const rounds = new Set(inputs.roundRows.map((r) => r.round)).size;
  if (rounds === 0) return result('format_missing', 'na', 'No rounds are stored to read it from.');
  return result(
    'format_missing',
    'fail',
    `No format is recorded, though ${rounds} ${plural(rounds, 'round is', 'rounds are')} stored.`,
    [prelimPiece(inputs.pieces, 1), tabPiece(inputs.pieces, 'team')],
  );
}

/**
 * Nobody named as adjudication core. Two sources count: the participants
 * list's Adj Core tick and the names under the home page's Tournament Staff
 * block (CA / CAP / DCA / Core / Adjudication), both counted into coreNamed.
 * Only a warning, since a tab may truly have no core. It applies only when
 * the participants list was read: a list that failed, or that the tournament
 * keeps private, says nothing about who the core was. A list read before
 * pieces were recorded is recognised by the judges on record. The fix reads
 * the participants list and the home page again.
 */
function checkCoreMissing(inputs: AuditInputs): CheckResult {
  const list = inputs.pieces.find((p) => p.kind === 'participants');
  const read = list ? list.status === 'ok' : inputs.judgeParticipants > 0;
  if (!read) return result('core_missing', 'na', 'The participants list has not been read.');
  if (inputs.coreNamed > 0) {
    const n = inputs.coreNamed;
    return result(
      'core_missing',
      'pass',
      `${n} ${plural(n, 'person is', 'people are')} named as adjudication core.`,
    );
  }
  return result(
    'core_missing',
    'warn',
    'No adjudication core is named: the participants list ticks no one as Adj Core and the home page names none.',
    [tabPiece(inputs.pieces, 'participants'), tabPiece(inputs.pieces, 'home')],
  );
}

/** What reportPieces reads: the recorded pieces and what says how many prelims there were. */
export type ReportPieceInputs = Pick<AuditInputs, 'pieces' | 'prelimRoundCount' | 'roundRows'>;

/**
 * What a report category points at. Identity categories point at no page.
 * Exported for the admin CV reports ledger (Task 5d), whose "Re-scrape
 * suggested" must offer the very pages this check does.
 */
export function reportPieces(category: string, inputs: ReportPieceInputs): SuggestedPiece[] {
  const { pieces } = inputs;
  switch (category) {
    case 'wrong_teammate':
      return [tabPiece(pieces, 'speaker'), tabPiece(pieces, 'team')];
    case 'wrong_speaker_rank':
    case 'wrong_speaker_average':
      return [tabPiece(pieces, 'speaker')];
    case 'wrong_team_result':
      return [
        tabPiece(pieces, 'team'),
        ...expectedPrelims(inputs).map((n) => prelimPiece(pieces, n)),
      ];
    case 'wrong_outround':
      return [...outroundRoundPieces(pieces).map(suggest), ...breakPieces(pieces)];
    default:
      return [];
  }
}

/**
 * Open user reports. The score's penalty for them is applied in score.ts;
 * this result carries the count and the pages the reports point at.
 */
function checkUserReports(inputs: AuditInputs): CheckResult {
  const n = inputs.openReports.length;
  if (n === 0) return result('user_reports', 'pass', 'No open user reports.');
  return result(
    'user_reports',
    'warn',
    `${n} open user ${plural(n, 'report', 'reports')}.`,
    inputs.openReports.flatMap((r) => r.categories.flatMap((c) => reportPieces(c, inputs))),
  );
}

export function runChecks(inputs: AuditInputs, currentParserVersion: string): CheckResult[] {
  const results = [
    checkChampion(inputs),
    checkRoundsComplete(inputs),
    checkRoomsConsistent(inputs),
    checkTeamCoverage(inputs),
    checkPartners(inputs),
    checkPanels(inputs),
    checkPointsAddUp(inputs),
    checkOutroundShape(inputs),
    checkBreakMatches(inputs),
    checkSpeakerTab(inputs),
    checkMotions(inputs),
    checkScrapeIncomplete(inputs),
    checkParserStale(inputs.parserVersion, currentParserVersion),
    checkFormatMissing(inputs),
    checkCoreMissing(inputs),
    checkUserReports(inputs),
  ];
  return withoutWithheld(results, inputs.pieces);
}
