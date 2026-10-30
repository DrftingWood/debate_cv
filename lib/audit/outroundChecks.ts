import { compareOutroundDepth, outroundRankStrict, tierRank } from '@/lib/calicotab/judgeStats';
import { isPreRound } from '@/lib/calicotab/stageLexicon';
import type { AuditInputs, AuditPiece } from './auditInputs';
import {
  bracketOfBreak,
  bracketOfLabel,
  breakPieces,
  outroundPiece,
  outroundRoundPieces,
  plural,
  result,
  teamKey,
  type SuggestedPiece,
} from './checkHelpers';
import type { CheckResult } from './types';

/**
 * The outround checks: a champion, the shape of each bracket, and the break
 * size against the teams that debated outrounds.
 */

/** The rank of a Final / Grand Final (JUDGE_STATS_RANK in judgeStats.ts). */
const FINAL_RANK = 95;

type Stage = {
  label: string;
  rank: number;
  bracket: string;
  partial: boolean;
  teams: string[];
  winners: string[];
};

/**
 * Outround rows grouped into stages. A label the lexicon cannot read as a
 * stage is left out: without a rank it cannot be placed in a bracket, and
 * guessing would turn an odd label into a false shape failure.
 */
function outroundStages(outrounds: AuditInputs['outrounds']): Stage[] {
  const byLabel = new Map<string, Stage>();
  for (const row of outrounds) {
    let s = byLabel.get(row.stage);
    if (!s) {
      const rank = outroundRankStrict(row.stage);
      if (rank == null) continue;
      s = {
        label: row.stage,
        rank,
        bracket: bracketOfLabel(row.stage),
        partial: isPreRound(row.stage),
        teams: [],
        winners: [],
      };
      byLabel.set(row.stage, s);
    }
    const key = teamKey(row.team);
    if (!s.teams.includes(key)) s.teams.push(key);
    // Winners keep the name as written, for the detail sentence.
    if (row.result === 'won' && !s.winners.some((w) => teamKey(w) === key))
      s.winners.push(row.team);
  }
  return [...byLabel.values()];
}

/**
 * A final that can name the champion: the Open bracket's, or a Gold / Silver /
 * Bronze tier final (one-day competitions name their main finals by tier).
 * A category final (ESL, Novice, Pro-Am) never stands in for it; when both
 * exist, compareOutroundDepth already ranks Open first.
 */
function isMainFinal(label: string, rank: number): boolean {
  return rank >= FINAL_RANK && (bracketOfLabel(label) === 'open' || tierRank(label) > 0);
}

function deepest<T extends { label: string; rank: number }>(items: T[]): T | null {
  return [...items].sort((a, b) => compareOutroundDepth(b, a))[0] ?? null;
}

/** The recorded piece for the main final, read from piece labels alone (no outround rows needed). */
function mainFinalPiece(pieces: AuditPiece[]): SuggestedPiece | null {
  const finals = outroundRoundPieces(pieces)
    .map((p) => ({ label: p.label, rank: outroundRankStrict(p.label) ?? -1 }))
    .filter((p) => isMainFinal(p.label, p.rank));
  const best = deepest(finals);
  return best ? outroundPiece(pieces, best.label) : null;
}

/** The final's piece, else the Open break, else any team break. */
function championPieces(pieces: AuditPiece[], finalLabel: string | null): SuggestedPiece[] {
  const final = finalLabel ? outroundPiece(pieces, finalLabel) : mainFinalPiece(pieces);
  if (final) return [final];
  const open = breakPieces(pieces, 'open');
  return open.length > 0 ? open : breakPieces(pieces);
}

export function checkChampion(inputs: AuditInputs): CheckResult {
  const { outrounds, breakRows, pieces } = inputs;
  if (outrounds.length === 0 && breakRows.length === 0) {
    return result('champion', 'na', 'The tournament has no break and no outround results.');
  }
  const final = deepest(outroundStages(outrounds).filter((s) => isMainFinal(s.label, s.rank)));
  if (!final) {
    const teams = new Set(breakRows.map((r) => teamKey(r.team))).size;
    const detail =
      outrounds.length === 0
        ? `${teams} teams broke, but no outround results are stored.`
        : 'The outround results have no Open final.';
    return result('champion', 'fail', detail, championPieces(pieces, null));
  }
  if (final.winners.length === 1) {
    return result('champion', 'pass', `${final.winners[0]} won the ${final.label}.`);
  }
  const n = final.winners.length;
  const detail =
    n === 0
      ? `The ${final.label} has no winner on record.`
      : `The ${final.label} has ${n} winners; it should have one.`;
  return result('champion', 'fail', detail, championPieces(pieces, final.label));
}

type Problem = { stages: Stage[]; text: string };

/**
 * Winners: exactly one in a final (a BP final seats four and crowns one),
 * half the room otherwise (BP: 2 of 4 advance; two-team: 1 of 2).
 */
function winnerProblem(s: Stage): Problem | null {
  const n = s.winners.length;
  const counts = `The ${s.label} has ${s.teams.length} teams and ${n} ${plural(n, 'winner', 'winners')}`;
  if (s.rank >= FINAL_RANK)
    return n === 1 ? null : { stages: [s], text: `${counts}; one should win` };
  return n * 2 === s.teams.length ? null : { stages: [s], text: `${counts}; half should win` };
}

/**
 * Each stage has half the teams of the one before. Not after a partial
 * round: its byes join the next stage without having debated, so the next
 * stage is not half of it.
 */
function halvingProblem(prev: Stage, next: Stage): Problem | null {
  if (prev.partial || prev.rank === next.rank || next.teams.length * 2 === prev.teams.length) {
    return null;
  }
  return {
    stages: [prev, next],
    text: `The ${next.label} has ${next.teams.length} teams, but the ${prev.label} before it had ${prev.teams.length}`,
  };
}

function bracketProblems(stages: Stage[]): Problem[] {
  const sorted = [...stages].sort((a, b) => a.rank - b.rank);
  const problems = sorted.map(winnerProblem);
  for (let i = 1; i < sorted.length; i++) problems.push(halvingProblem(sorted[i - 1], sorted[i]));
  return problems.filter((p): p is Problem => p != null);
}

/** Checked per bracket, so an ESL final is never measured against the Open semifinals. */
export function checkOutroundShape(inputs: AuditInputs): CheckResult {
  const stages = outroundStages(inputs.outrounds);
  if (stages.length === 0) return result('outround_shape', 'na', 'No outround results are stored.');
  const brackets = new Map<string, Stage[]>();
  for (const s of stages) brackets.set(s.bracket, [...(brackets.get(s.bracket) ?? []), s]);
  const problems = [...brackets.values()].flatMap(bracketProblems);
  if (problems.length === 0) {
    return result(
      'outround_shape',
      'pass',
      `All ${stages.length} outround stages have the expected teams and winners.`,
    );
  }
  const more = problems.length - 1;
  const tail = more > 0 ? `, and ${more} other ${plural(more, 'problem', 'problems')}` : '';
  const pieces = problems
    .flatMap((p) => p.stages.map((s) => outroundPiece(inputs.pieces, s.label)))
    .filter((p): p is SuggestedPiece => p != null);
  return result('outround_shape', 'fail', `${problems[0].text}${tail}.`, pieces);
}

/**
 * The Open break against the teams in the Open outrounds. All Open stages are
 * pooled rather than only the first: when the first is a partial round, the
 * seeded teams with a bye appear only in the stage after it, and pooling
 * counts them without needing to know which round they skipped.
 */
export function checkBreakMatches(inputs: AuditInputs): CheckResult {
  const broke = new Set(
    inputs.breakRows.filter((r) => bracketOfBreak(r.stage) === 'open').map((r) => teamKey(r.team)),
  );
  const debated = new Set(
    outroundStages(inputs.outrounds)
      .filter((s) => s.bracket === 'open')
      .flatMap((s) => s.teams),
  );
  if (broke.size === 0 || debated.size === 0) {
    return result('break_matches', 'na', 'There is no Open break and Open outround to compare.');
  }
  if (broke.size === debated.size) {
    return result(
      'break_matches',
      'pass',
      `The Open break and the Open outrounds both have ${broke.size} teams.`,
    );
  }
  return result(
    'break_matches',
    'warn',
    `The Open break lists ${broke.size} teams; the Open outrounds have ${debated.size}.`,
    breakPieces(inputs.pieces, 'open'),
  );
}
