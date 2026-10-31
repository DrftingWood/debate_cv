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
import {
  checkBreakMatches,
  checkBreakUnstored,
  checkChampion,
  checkOutroundShape,
} from './outroundChecks';
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
export const CHECKS_VERSION = '2026-10-31.11';

/**
 * No speakers on record. That is na unless the speaker tab is linked but never
 * loaded (a failed piece) and the tournament's teams or rounds are stored. A
 * speaker tab that loaded ok and holds nobody is a properly scraped one (every
 * speaker redacted, say) and is never highlighted; only a warning even so, and
 * the fix is the speaker tab again.
 */
function speakersUnstored(inputs: AuditInputs): CheckResult {
  const linked = inputs.pieces.find((p) => p.kind === 'speaker' && p.status === 'failed');
  const stored = inputs.teamTab.length > 0 || inputs.roundRows.length > 0;
  if (!linked || !stored) return result('speaker_tab', 'na', 'No speakers are on record.');
  return result('speaker_tab', 'warn', 'The speaker tab is linked but no speakers are on record.', [
    suggest(linked),
  ]);
}

function checkSpeakerTab(inputs: AuditInputs): CheckResult {
  const { speakerParticipants: all, speakersWithScores: scored } = inputs;
  if (all === 0) return speakersUnstored(inputs);
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
    // Without a round count there is no list of rounds to compare, but a
    // linked motions page that left nothing stored is still a gap.
    const linked = inputs.pieces.find((p) => p.kind === 'motions' && p.status === 'failed');
    if (linked && inputs.motionRounds.length === 0) {
      return result('motions', 'warn', 'A motions page is linked but no motion is on record.', [
        suggest(linked),
      ]);
    }
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

/**
 * An old parser's gaps are unknown, so the fix is to read every page on
 * record again: each recorded piece that is not withheld is suggested (a
 * withheld one can bring nothing). A tournament with no piece recorded has
 * nothing to suggest and needs a full re-scrape.
 */
function checkParserStale(inputs: AuditInputs, current: string): CheckResult {
  const { parserVersion } = inputs;
  const readable = inputs.pieces.filter((p) => p.status !== 'withheld').map(suggest);
  if (parserVersion !== current && inputs.pagesRefreshedUnder === current) {
    // Ruling 18: a refresh re-read the pages, but only a full scrape redoes
    // the rest, so the wording says what is and is not current.
    return result(
      'parser_stale',
      'pass',
      'Pages refreshed under the current parser; format and unpublished pages update on the next full scrape.',
    );
  }
  if (parserVersion === current) {
    return result('parser_stale', 'pass', 'Scraped with the current parser.');
  }
  if (parserVersion == null) {
    return result(
      'parser_stale',
      'warn',
      'No parser version is recorded for this scrape.',
      readable,
    );
  }
  return result(
    'parser_stale',
    'warn',
    `Scraped with parser ${parserVersion}; the current one is ${current}.`,
    readable,
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
 * Only a warning, since a tab may truly have no core. It warns only when both
 * sources were read: the participants list (one that failed, or that the
 * tournament keeps private, says nothing about who the core was; a list read
 * before pieces were recorded is recognised by the judges on record) and the
 * home page (read means loaded, or answered as withheld or not published).
 * Until the home page has been read the staff block is simply unseen, so the
 * check says so rather than warn on every tab that was scraped before the
 * block was parsed; Tools, Fill missing adjudication cores, reads it. Someone
 * named by either source is a pass whatever was read.
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
  const home = inputs.pieces.find((p) => p.kind === 'home');
  if (!home || (home.status !== 'ok' && home.status !== 'withheld')) {
    return result(
      'core_missing',
      'na',
      "Not checked yet: the tab's home page hasn't been read. Tools → Fill missing adjudication cores reads it.",
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
    checkBreakUnstored(inputs),
    checkSpeakerTab(inputs),
    checkMotions(inputs),
    checkScrapeIncomplete(inputs),
    checkParserStale(inputs, currentParserVersion),
    checkFormatMissing(inputs),
    checkCoreMissing(inputs),
    checkUserReports(inputs),
  ];
  return withoutWithheld(results, inputs.pieces);
}
