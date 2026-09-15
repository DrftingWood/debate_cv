import { matchStage } from './stageLexicon';

/**
 * Which round a speaker score or a motion belongs to.
 *
 * A prelim round's identity is the number in its results URL,
 * `/results/round/<N>/` — Tabbycat's own sequence, and what TeamResult rows
 * are keyed by. Speaker scores and motions used to be keyed by the first
 * number in their LABEL instead, and those only agree while every round is
 * called "Round N". Fifteen corpus tournaments break that:
 *
 *   split rounds      "Round 1A" @1, "Round 1B" @2, "Round 2" @3 …
 *   interleaved       "Round 1-A" @1, "Round 2-A" @2, "Round 1-B" @3 …
 *   zero-based        "Rodada 0" @1, "Rodada 1" @2 …
 *
 * so R1A and R1B both became round 1 (one score silently dropped on the
 * unique key — 404 of them), every later round sat one off from its team
 * result and its motion, "Round 1A"'s motion had no round at all, and a
 * "Rodada 0" speech became round 0, which the CV reads as the average.
 */

export type PrelimRound = { number: number; label: string };

/** The prelim rounds the nav lists, in sequence order. */
export function prelimRoundsFromNav(labelsByUrl: Record<string, string> | null | undefined): PrelimRound[] {
  const byNumber = new Map<number, string>();
  for (const [url, label] of Object.entries(labelsByUrl ?? {})) {
    const m = url.match(/\/results\/round\/(\d+)/);
    if (!m) continue;
    if (matchStage(label)) continue;
    const n = Number(m[1]);
    if (!byNumber.has(n)) byNumber.set(n, label.trim());
  }
  return [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, label]) => ({ number, label }));
}

function numberInLabel(label: string): number | null {
  const m = label.match(/\d+/);
  const n = m ? Number(m[0]) : null;
  // 0 is reserved for the Average row downstream.
  return n != null && n > 0 ? n : null;
}

/**
 * Map each speaker-tab score column (by its label) to a round number.
 *
 * The tab lays its score columns out in round order, one per prelim, so when
 * it carries exactly as many as the nav lists, the i-th column IS the i-th
 * prelim. When the counts differ — a round not yet on the tab, an extra
 * round in the nav — nothing ties a column to a round except its label, and
 * the number in the label is used as before.
 */
export function speakerColumnRounds(
  columnLabels: readonly string[],
  prelims: readonly PrelimRound[],
): Map<string, number> {
  const columns = [...new Set(columnLabels)].filter((l) => !matchStage(l));
  const out = new Map<string, number>();
  if (prelims.length > 0 && columns.length === prelims.length) {
    columns.forEach((label, i) => out.set(label, prelims[i]!.number));
    return out;
  }
  for (const label of columns) {
    const n = numberInLabel(label);
    if (n != null) out.set(label, n);
  }
  return out;
}

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A motion's round: the prelim whose nav label it carries, when exactly one
 * does; otherwise whatever the motions parser read from the label (null for
 * outrounds, which are matched by label elsewhere).
 */
export function motionRoundNumber(
  roundLabel: string,
  parsed: number | null,
  prelims: readonly PrelimRound[],
): number | null {
  const hits = prelims.filter((p) => fold(p.label) === fold(roundLabel));
  return hits.length === 1 ? hits[0]!.number : parsed;
}
