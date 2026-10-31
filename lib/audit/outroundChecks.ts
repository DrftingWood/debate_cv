import { compareOutroundDepth, outroundRankStrict, tierRank } from '@/lib/calicotab/judgeStats';
import { isPreRound } from '@/lib/calicotab/stageLexicon';
import type { AuditInputs, AuditPiece } from './auditInputs';
import {
  bracketOfBreak,
  bracketOfLabel,
  breakPieces,
  isWithheld,
  outroundPiece,
  outroundRoundPieces,
  plural,
  result,
  suggest,
  teamKey,
  withheldOutroundPieces,
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
 * Whoever wins a final is a champion (owner ruling, 2026-10-31): the Open
 * Grand Final, an ESL / Novice / Pro-Am final, a Gold / Silver / Bronze tier
 * final alike (formatStage.championTitle titles them "ESL Champion" and so on).
 * So no final is set aside as the one that counts.
 */
function isFinal(rank: number): boolean {
  return rank >= FINAL_RANK;
}

function deepest<T extends { label: string; rank: number }>(items: T[]): T | null {
  return [...items].sort((a, b) => compareOutroundDepth(b, a))[0] ?? null;
}

/** The recorded piece for the main final, read from piece labels alone (no outround rows needed). */
function mainFinalPiece(pieces: AuditPiece[]): SuggestedPiece | null {
  const finals = outroundRoundPieces(pieces)
    .map((p) => ({ label: p.label, rank: outroundRankStrict(p.label) ?? -1 }))
    .filter((p) => isFinal(p.rank));
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

/**
 * Each bracket's own final, the deepest it reached: the Open Grand Final, an
 * ESL or Novice final, a Gold / Silver / Bronze tier final. Each names a
 * champion, so each is judged on its own.
 */
function finalsOf(stages: Stage[]): Stage[] {
  const byBracket = new Map<string, Stage[]>();
  for (const s of stages.filter((x) => isFinal(x.rank))) {
    const key = `${s.bracket}:${tierRank(s.label)}`;
    byBracket.set(key, [...(byBracket.get(key) ?? []), s]);
  }
  return [...byBracket.values()].flatMap((list) => {
    const best = deepest(list);
    return best ? [best] : [];
  });
}

/**
 * No final to judge, and that is the tournament's doing: it withholds its
 * outround pages (none stored at all) or a final's page itself. A results page
 * held back until the closing ceremony is not a gap in our data.
 */
function championWithheld(inputs: AuditInputs): boolean {
  const held = withheldOutroundPieces(inputs.pieces);
  if (held.length === 0) return false;
  if (inputs.outrounds.length === 0) return true;
  return held.some((p) => isFinal(outroundRankStrict(p.label) ?? -1));
}

export function checkChampion(inputs: AuditInputs): CheckResult {
  const { outrounds, breakRows, pieces } = inputs;
  if (outrounds.length === 0 && breakRows.length === 0) {
    return result('champion', 'na', 'The tournament has no break and no outround results.');
  }
  const finals = finalsOf(outroundStages(outrounds));
  if (finals.length === 0 && championWithheld(inputs)) {
    return result('champion', 'na', 'The tournament withholds its outround results.');
  }
  // An Open break with no Open final is a gap in what is stored, whatever
  // other brackets finished: the main draw's champion is missing.
  const openBroke = breakRows.filter((r) => bracketOfBreak(r.stage) === 'open');
  const hasOpenFinal = finals.some((f) => f.bracket === 'open' || tierRank(f.label) > 0);
  if (finals.length === 0 || (openBroke.length > 0 && !hasOpenFinal)) {
    // A tab with no Open bracket counts its whole break.
    const counted = openBroke.length > 0 ? openBroke : breakRows;
    const teams = new Set(counted.map((r) => teamKey(r.team))).size;
    const detail =
      outrounds.length === 0
        ? `${teams} teams broke, but no outround results are stored.`
        : 'The outround results have no Open final.';
    return result('champion', 'fail', detail, championPieces(pieces, null));
  }
  const bad = finals.find((f) => f.winners.length !== 1);
  if (bad) {
    const n = bad.winners.length;
    const detail =
      n === 0
        ? `The ${bad.label} has no winner on record.`
        : `The ${bad.label} has ${n} winners; it should have one.`;
    return result('champion', 'fail', detail, championPieces(pieces, bad.label));
  }
  const detail = [...finals]
    .sort((x, y) => compareOutroundDepth(y, x))
    .map((f) => `${f.winners[0]} won the ${f.label}`)
    .join('; ');
  return result('champion', 'pass', `${detail}.`);
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

/**
 * Checked per bracket, so an ESL final is never measured against the Open
 * semifinals. A bracket with a stage the tournament withholds is left out:
 * its stored stages are a part, and halving across the gap would fail a
 * bracket for a page no re-scrape can bring.
 */
export function checkOutroundShape(inputs: AuditInputs): CheckResult {
  const held = new Set(withheldOutroundPieces(inputs.pieces).map((p) => bracketOfLabel(p.label)));
  const all = outroundStages(inputs.outrounds);
  const stages = all.filter((s) => !held.has(s.bracket));
  if (stages.length === 0) {
    const detail =
      held.size > 0
        ? 'The tournament withholds some of its outround results.'
        : 'No outround results are stored.';
    return result('outround_shape', 'na', detail);
  }
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
  // A withheld Open break, or a withheld Open outround (its teams would be
  // missing from the count), leaves nothing fair to compare.
  const heldOpenRound = withheldOutroundPieces(inputs.pieces).some(
    (p) => bracketOfLabel(p.label) === 'open',
  );
  if ((broke.size === 0 && isWithheld(inputs.pieces, 'break', 'open')) || heldOpenRound) {
    return result(
      'break_matches',
      'na',
      'The tournament withholds part of its Open break or outrounds.',
    );
  }
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

/**
 * A break page the menu links whose teams were never stored. The linked pages
 * are the break pieces that are not withheld (a tab with no break link is
 * recorded not-published, and the adjudicator break names no teams); each one
 * should have break rows in its bracket. It applies only once outrounds were
 * debated, because a break page that is up before the break is announced is
 * empty by design and no re-scrape fills it. The fix reads those break pages
 * again.
 */
export function checkBreakUnstored(inputs: AuditInputs): CheckResult {
  const linked = inputs.pieces.filter(
    (p) => p.kind === 'break' && p.key !== 'adjudicators' && p.status !== 'withheld',
  );
  if (linked.length === 0) {
    return result('break_unstored', 'na', 'No team break page is linked.');
  }
  // Per bracket: a break page counts only against outrounds debated in its
  // own bracket, so an empty Novice page beside stored Open outrounds is not
  // a gap (it may simply not be out).
  const debated = new Set([
    ...inputs.outrounds.map((o) => bracketOfLabel(o.stage)),
    ...outroundRoundPieces(inputs.pieces)
      .filter((p) => p.status === 'ok')
      .map((p) => bracketOfLabel(p.label)),
  ]);
  const candidates = linked.filter((p) => debated.has(p.key));
  if (candidates.length === 0) {
    return result(
      'break_unstored',
      'na',
      'No outrounds are stored for a linked break, so the break may not be out yet.',
    );
  }
  const stored = new Set(inputs.breakRows.map((r) => bracketOfBreak(r.stage)));
  const missing = candidates.filter((p) => !stored.has(p.key));
  if (missing.length === 0) {
    return result('break_unstored', 'pass', 'Every linked break page has its teams stored.');
  }
  const names = missing.map((p) => p.label.replace(/^Break:\s*/i, ''));
  const verb = plural(missing.length, 'page is', 'pages are');
  return result(
    'break_unstored',
    'warn',
    `The ${names.join(' and ')} break ${verb} linked but no break rows are stored.`,
    missing.map(suggest),
  );
}
