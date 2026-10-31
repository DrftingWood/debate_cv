import { isFailing, isWarning, type Band, type ParsedCheck } from '@/lib/admin/accuracy';
import { ASSUMPTIONS, CHECK_LABELS, type AssumptionCode, type CheckCode } from '@/lib/audit/types';

/**
 * The Tournaments tab's filters, as the address writes them:
 *   - `?check=<code>`: tournaments failing that check;
 *   - `?warn=<code>`: tournaments with that check a warning (isWarning);
 *   - `?band=good|check|rescrape`: tournaments in that score band;
 *   - `?question=<code>`: tournaments an unsettled rule decided;
 *   - `?checked=1`: tournaments with at least one mark applied;
 *   - `?ignored=1`: only the tournaments an admin set to ignored (test and
 *     demo ones). Without it the list leaves them out, as every admin score
 *     does.
 * They narrow together (a tournament must satisfy every one named). Apart
 * from lib/admin/tournamentList.ts so the chips can read them without the
 * list's database code.
 */
export type TournamentFilters = {
  check?: CheckCode;
  warn?: CheckCode;
  band?: Band;
  question?: AssumptionCode;
  checked?: true;
  ignored?: true;
};

const BANDS: readonly Band[] = ['good', 'check', 'rescrape'];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const hasKey = <T extends string>(map: Record<T, unknown>, k: string | undefined): k is T =>
  k !== undefined && Object.prototype.hasOwnProperty.call(map, k);

/**
 * The filters a request names. A word that is not a known check, band or
 * rule is ignored rather than turned into an empty list, so an old link
 * still shows tournaments instead of a misleading "nothing matches".
 */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): TournamentFilters {
  const check = first(params.check);
  const warn = first(params.warn);
  const band = first(params.band);
  const question = first(params.question);
  const knownBand = BANDS.find((b) => b === band);
  return {
    ...(hasKey(CHECK_LABELS, check) ? { check } : {}),
    ...(hasKey(CHECK_LABELS, warn) ? { warn } : {}),
    ...(knownBand ? { band: knownBand } : {}),
    ...(hasKey(ASSUMPTIONS, question) ? { question } : {}),
    ...(first(params.checked) === '1' ? { checked: true as const } : {}),
    ...(first(params.ignored) === '1' ? { ignored: true as const } : {}),
  };
}

/** True when a filter that needs the checks' JSON (not just the score) is named. */
export const needsChecks = (f: TournamentFilters) =>
  Boolean(f.check || f.warn || f.question || f.checked);

/** True when any filter is named at all. */
export const hasFilters = (f: TournamentFilters) => Boolean(f.band || needsChecks(f));

/**
 * Whether one audit passes every named filter. A check counts as failing by
 * the overview's own rule (isFailing), so a chip's count and the list it
 * opens cannot disagree.
 */
export function matchesFilters(
  audit: { score: number; bandOf: Band; checks: ParsedCheck[] },
  f: TournamentFilters,
): boolean {
  if (f.band && audit.bandOf !== f.band) return false;
  if (f.check && !audit.checks.some((c) => c.code === f.check && isFailing(c))) return false;
  if (f.warn && !audit.checks.some((c) => c.code === f.warn && isWarning(c))) return false;
  const { question } = f;
  if (question && !audit.checks.some((c) => c.assumptions.includes(question))) return false;
  if (f.checked && !audit.checks.some((c) => c.checkedBy)) return false;
  return true;
}

/** The filters as address parameters, for building links that keep them. */
export function filterParams(f: TournamentFilters): Record<string, string> {
  return {
    ...(f.check ? { check: f.check } : {}),
    ...(f.warn ? { warn: f.warn } : {}),
    ...(f.band ? { band: f.band } : {}),
    ...(f.question ? { question: f.question } : {}),
    ...(f.checked ? { checked: '1' } : {}),
    ...(f.ignored ? { ignored: '1' } : {}),
  };
}
