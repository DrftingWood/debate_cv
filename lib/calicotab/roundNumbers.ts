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
 *   repeated labels   "Round 1" @1, "Round 1" @2 …
 *
 * so R1A and R1B both became round 1 (one score silently dropped on the
 * unique key — 404 of them), every later round sat one off from its team
 * result and its motion, and a "Rodada 0" speech became round 0, which the
 * CV reads as the average.
 *
 * Resolution, most to least certain:
 *   1. by round key — a column "R1A" and a nav label "Round 1A" both read
 *      "1a", so each names its round outright;
 *   2. by position — a tab lays out one column per prelim, in order;
 *   3. by the digit in the label, but only where the nav shows every label's
 *      number IS its sequence number, so the digit cannot lie.
 */

export type PrelimRound = { number: number; label: string };

/**
 * Nav rounds that are neither a prelim nor a rung of the outround ladder. A
 * "Debate-off" for the last break place is played by a handful of teams
 * after the prelims; counted as a prelim it made australs2026 a nine-round
 * tournament, flagging every full-draw speaker's record as incomplete.
 */
const NOT_A_PRELIM = /\bdebate[-\s]?offs?\b|\btie[-\s]?break(?:er)?s?\b|\bplay[-\s]?offs?\b/i;

export function isPrelimRoundLabel(label: string | null | undefined): boolean {
  return !!label && !matchStage(label) && !NOT_A_PRELIM.test(label);
}

/** The prelim rounds the nav lists, in sequence order. */
export function prelimRoundsFromNav(labelsByUrl: Record<string, string> | null | undefined): PrelimRound[] {
  const byNumber = new Map<number, string>();
  for (const [url, label] of Object.entries(labelsByUrl ?? {})) {
    const m = url.match(/\/results\/round\/(\d+)/);
    if (!m || !isPrelimRoundLabel(label)) continue;
    const n = Number(m[1]);
    if (!byNumber.has(n)) byNumber.set(n, label.trim());
  }
  return [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, label]) => ({ number, label }));
}

/**
 * What a nav label and a tab column share: "Round 1A", "R1A", "Round 1-A"
 * and "Round 1 A" all read "1a"; "Rodada 0" reads "0". Null for anything
 * that is not a numbered round.
 */
export function roundKey(label: string): string | null {
  const t = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  const m = t.match(/^(?:round|ronda|rodada|runde|ronde|rnd|r)?(\d+[a-z]?)$/);
  return m ? m[1]! : null;
}

function byRoundKey(prelims: readonly PrelimRound[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const p of prelims) {
    const k = roundKey(p.label);
    if (k == null) continue;
    out.set(k, [...(out.get(k) ?? []), p.number]);
  }
  return out;
}

/** True when no nav label's number disagrees with its sequence number. */
function labelDigitsAreSequence(prelims: readonly PrelimRound[]): boolean {
  return prelims.every((p) => {
    const k = roundKey(p.label);
    return k == null || k === String(p.number);
  });
}

function numberInLabel(label: string): number | null {
  const m = label.match(/\d+/);
  const n = m ? Number(m[0]) : null;
  // 0 is reserved for the Average row downstream.
  return n != null && n > 0 ? n : null;
}

/**
 * The round number of each speaker-tab score column, by column POSITION —
 * two columns can share a label, so a label cannot identify a column.
 * Null for a column that cannot be placed.
 */
export function speakerColumnRounds(
  columnLabels: readonly string[],
  prelims: readonly PrelimRound[],
): Array<number | null> {
  const isRoundColumn = (label: string) => !matchStage(label);
  const keys = byRoundKey(prelims);
  const keyed = columnLabels.map((label) => {
    if (!isRoundColumn(label)) return null;
    const k = roundKey(label);
    const hits = k == null ? undefined : keys.get(k);
    return hits && hits.length === 1 ? hits[0]! : null;
  });

  const roundColumns = columnLabels.filter(isRoundColumn).length;
  const named = keyed.filter((n): n is number => n != null);
  if (roundColumns > 0 && named.length === roundColumns && new Set(named).size === named.length) {
    return keyed;
  }

  if (prelims.length > 0 && roundColumns === prelims.length) {
    let i = 0;
    return columnLabels.map((label) => (isRoundColumn(label) ? prelims[i++]!.number : null));
  }

  const digitsSafe = labelDigitsAreSequence(prelims);
  return columnLabels.map((label, idx) => {
    if (!isRoundColumn(label)) return null;
    if (keyed[idx] != null) return keyed[idx];
    return digitsSafe ? numberInLabel(label) : null;
  });
}

export type MotionRoundInput = {
  roundLabel: string;
  /** What the motions parser read from the label. */
  roundNumber: number | null;
  /** The page heading the motion sits under, when the layout has headings. */
  roundIndex?: number;
};

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The round number of each motion, in document order.
 *
 * A motion takes the one nav prelim carrying its label. When several do
 * (hwsrr2023's repeated "Round 1"), the k-th heading with that label is the
 * k-th such round. Failing a label, a round key; failing that, the parsed
 * number where the label digits can be trusted. Outround motions keep what
 * the parser read, which is null.
 */
export function assignMotionRounds(
  motions: readonly MotionRoundInput[],
  prelims: readonly PrelimRound[],
): Array<number | null> {
  const byLabel = new Map<string, number[]>();
  for (const p of prelims) byLabel.set(fold(p.label), [...(byLabel.get(fold(p.label)) ?? []), p.number]);
  const keys = byRoundKey(prelims);
  const digitsSafe = labelDigitsAreSequence(prelims);
  const headingsByLabel = new Map<string, number[]>();

  return motions.map((m) => {
    const label = fold(m.roundLabel);
    const hits = byLabel.get(label) ?? [];
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) {
      if (m.roundIndex == null) return null;
      const headings = headingsByLabel.get(label) ?? [];
      if (!headings.includes(m.roundIndex)) headings.push(m.roundIndex);
      headingsByLabel.set(label, headings);
      return hits[headings.indexOf(m.roundIndex)] ?? null;
    }
    if (!isPrelimRoundLabel(m.roundLabel)) return m.roundNumber;
    const k = roundKey(m.roundLabel);
    const keyHits = k == null ? undefined : keys.get(k);
    if (keyHits && keyHits.length === 1) return keyHits[0]!;
    return digitsSafe ? m.roundNumber : null;
  });
}
