import { CHECK_WEIGHTS, type CheckResult } from './types';

/** Points off per open user report, and the most they can take off. */
const REPORT_PENALTY = 10;
const REPORT_PENALTY_CAP = 30;

/**
 * Tournament score: pass earns a check's weight, warn half, fail nothing.
 * `na` checks leave both earned and possible weight, so a tournament is never
 * marked down for a check that does not apply. Open user reports then take a
 * flat penalty after the weighted score, because a person saying "this is
 * wrong" is evidence the checks cannot see. Floored at 0.
 */
export function scoreTournament(checks: CheckResult[], openReports: number): number {
  let earned = 0;
  let possible = 0;
  for (const c of checks) {
    if (c.code === 'user_reports' || c.status === 'na') continue;
    const w = CHECK_WEIGHTS[c.code];
    possible += w;
    if (c.status === 'pass') earned += w;
    else if (c.status === 'warn') earned += w / 2;
  }
  const base = possible === 0 ? 100 : Math.round((100 * earned) / possible);
  const penalty = Math.min(REPORT_PENALTY_CAP, Math.max(0, openReports) * REPORT_PENALTY);
  return Math.max(0, base - penalty);
}

export function band(score: number): 'good' | 'check' | 'rescrape' {
  if (score >= 90) return 'good';
  if (score >= 70) return 'check';
  return 'rescrape';
}

/**
 * Database score: the mean of tournament scores weighted by 1 + usersAffected,
 * so tournaments on real CVs count more, next to the plain mean.
 */
export function databaseScore(rows: Array<{ score: number; usersAffected: number }>): {
  weighted: number | null;
  unweighted: number | null;
  n: number;
} {
  if (rows.length === 0) return { weighted: null, unweighted: null, n: 0 };
  let sum = 0;
  let wSum = 0;
  let wTotal = 0;
  for (const r of rows) {
    const w = 1 + r.usersAffected;
    sum += r.score;
    wSum += r.score * w;
    wTotal += w;
  }
  return {
    weighted: Math.round(wSum / wTotal),
    unweighted: Math.round(sum / rows.length),
    n: rows.length,
  };
}
