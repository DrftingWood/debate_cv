/**
 * Cross-tabs over the round table — seat × motion type, pairing × motion
 * type, seat × pairing — and the handful of cells that stand out.
 *
 * Every cell is a splitRounds row keyed by both dimensions at once, so it
 * inherits the per-format residual deltas the Positions section uses: a cell
 * is measured against the user's own figure in each of its rounds' formats,
 * never against a blended career baseline. A thin cell (splitRounds' rule) is
 * hidden and carries no figures at all — a grid of 2-round cells is mostly
 * noise, and a number that is on screen gets read however it is styled.
 *
 * Findings are the cells furthest from what their row and column predict:
 * interaction = cell delta − (row effect + column effect), both effects read
 * over the WHOLE record. Ranking by the cell's own delta mostly repeated a
 * single effect — "OO on Belief +1.1" when Belief alone was +0.9 — and
 * measuring effects inside a filtered slice erased them (under a seat filter
 * the seat is the whole grid). Stated with the number and the sample like
 * deriveQuirks' claims.
 * They also need two tournaments, so one good weekend cannot become "you are
 * strong on Belief motions in OG".
 */

import type { RoundFact } from '@/lib/cv/statsFacts';
import type { Quirk } from '@/lib/cv/speakerStats';
import { formatKey, splitRounds } from '@/lib/cv/roundSplits';

export type CrossTabDimension = 'seat' | 'motionType' | 'pairing';

/** Below this interaction, in speaker points, a cell is not a finding. */
export const MIN_FINDING_DELTA = 0.5;
const MAX_FINDINGS_EACH_WAY = 3;
const MIN_FINDING_TOURNAMENTS = 2;
/** Full names for the format prefixes seat keys and baselines use. */
export const FORMAT_NAME: Record<string, string> = {
  BP: 'British Parliamentary',
  AP: 'Asian Parliamentary',
  Aus: 'Australs',
  WSDC: 'World Schools',
  '2v2': 'Two-team Parliamentary',
};

export const SEAT_ORDER = ['OG', 'OO', 'CG', 'CO', 'Gov', 'Aff', 'Prop', 'Opp', 'Neg'];
export const MOTION_ORDER = ['Policy', 'Actor', 'Belief', 'Stance', 'Regret', 'Preference'];
const PAIRING_ORDER = ['pro', 'am', 'peers'];

export type CrossTabCell = {
  row: string;
  col: string;
  rounds: number;
  tournaments: number;
  hidden: boolean;
  /** The format keys ('BP', 'AP' …) the cell's rounds were baselined in — the seat's format, else the tab's. */
  formats: string[];
  avgScore: number | null;
  scoreDelta: number | null;
  decided: number;
  winRate: number | null;
  winRateDelta: number | null;
  avgPoints: number | null;
  /** Row effect + column effect, each the speaker-average delta over the whole record. */
  expected: number | null;
  /** scoreDelta − expected: what this pairing of row and column adds on its own. */
  interaction: number | null;
};

export type CrossTab = {
  rowDimension: CrossTabDimension;
  colDimension: CrossTabDimension;
  rows: string[];
  cols: string[];
  cells: CrossTabCell[];
};

/** Seat keys hold ':'; no dimension key holds a tab. */
const SEP = '\t';
export const cellKey = (row: string, col: string) => `${row}${SEP}${col}`;

function keyOf(dimension: CrossTabDimension, r: RoundFact): string | null {
  if (dimension === 'seat') return r.seat;
  if (dimension === 'motionType') return r.motionType;
  return r.proAm;
}

function orderKeys(dimension: CrossTabDimension, keys: string[], rounds: Map<string, number>): string[] {
  const rank = (list: string[], k: string) => (list.includes(k) ? list.indexOf(k) : list.length);
  if (dimension === 'motionType') return keys.sort((a, b) => rank(MOTION_ORDER, a) - rank(MOTION_ORDER, b) || a.localeCompare(b));
  if (dimension === 'pairing') return keys.sort((a, b) => rank(PAIRING_ORDER, a) - rank(PAIRING_ORDER, b));
  // Seats group by format, the format with most rounds first, then bench order.
  const byFormat = new Map<string, number>();
  for (const k of keys) {
    const prefix = k.split(':')[0];
    byFormat.set(prefix, (byFormat.get(prefix) ?? 0) + (rounds.get(k) ?? 0));
  }
  return keys.sort((a, b) => {
    const [pa, sa] = a.split(':');
    const [pb, sb] = b.split(':');
    return (
      (byFormat.get(pb) ?? 0) - (byFormat.get(pa) ?? 0) ||
      pa.localeCompare(pb) ||
      rank(SEAT_ORDER, sa) - rank(SEAT_ORDER, sb) ||
      a.localeCompare(b)
    );
  });
}

export function crossTab(
  rounds: RoundFact[],
  rowDimension: CrossTabDimension,
  colDimension: CrossTabDimension,
  /** The whole record, for baselines — see splitRounds. */
  baselineRounds: RoundFact[] = rounds,
): CrossTab {
  const formats = new Map<string, Set<string>>();
  const splits = splitRounds(rounds, (r) => {
    const row = keyOf(rowDimension, r);
    const col = keyOf(colDimension, r);
    if (row == null || col == null) return null;
    const key = cellKey(row, col);
    const set = formats.get(key) ?? new Set<string>();
    const f = formatKey(r);
    if (f) set.add(f);
    formats.set(key, set);
    return key;
  }, baselineRounds);

  // Effects over the whole record, from rounds carrying both keys — the same
  // population the grid is drawn from, so a purely additive record has no
  // interactions at all.
  const both = baselineRounds.filter((r) => keyOf(rowDimension, r) != null && keyOf(colDimension, r) != null);
  const effects = (dimension: CrossTabDimension) =>
    new Map(splitRounds(both, (r) => keyOf(dimension, r), baselineRounds).map((s) => [s.key, s.scoreDelta]));
  const rowEffect = effects(rowDimension);
  const colEffect = effects(colDimension);

  const cells: CrossTabCell[] = splits.map((s) => {
    const [row, col] = s.key.split(SEP);
    const hidden = s.thin;
    const re = rowEffect.get(row);
    const ce = colEffect.get(col);
    const expected = re != null && ce != null ? re + ce : null;
    return {
      row,
      col,
      rounds: s.rounds,
      tournaments: s.tournaments,
      hidden,
      formats: [...(formats.get(s.key) ?? [])].sort(),
      avgScore: hidden ? null : s.avgScore,
      scoreDelta: hidden ? null : s.scoreDelta,
      decided: hidden ? 0 : s.decided,
      winRate: hidden ? null : s.winRate,
      winRateDelta: hidden ? null : s.winRateDelta,
      avgPoints: hidden ? null : s.avgPoints,
      expected: hidden ? null : expected,
      interaction: hidden || expected == null || s.scoreDelta == null ? null : s.scoreDelta - expected,
    };
  });

  const total = (pick: (c: CrossTabCell) => string) => {
    const m = new Map<string, number>();
    for (const c of cells) m.set(pick(c), (m.get(pick(c)) ?? 0) + c.rounds);
    return m;
  };
  const rowRounds = total((c) => c.row);
  const colRounds = total((c) => c.col);

  return {
    rowDimension,
    colDimension,
    rows: orderKeys(rowDimension, [...rowRounds.keys()], rowRounds),
    cols: orderKeys(colDimension, [...colRounds.keys()], colRounds),
    cells,
  };
}

// ── Findings ──────────────────────────────────────────────────────────────

const PAIRING_PHRASE: Record<string, string> = { pro: 'as the pro', am: 'as the am', peers: 'with peers' };
const PAIRING_NOUN: Record<string, string> = { pro: 'being the pro', am: 'being the am', peers: 'pairing with peers' };

/** "OG" from "BP:OG" — the format is named in the comparison instead. */
export const seatName = (key: string) => key.split(':').slice(1).join(':') || key;

function phrase(dimension: CrossTabDimension, key: string): string {
  if (dimension === 'seat') return `in ${seatName(key)}`;
  if (dimension === 'motionType') return `on ${key} motions`;
  return PAIRING_PHRASE[key] ?? key;
}

const signed = (n: number) => {
  const r = Number(n.toFixed(1));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`;
};

export function crossTabFindings(tabs: CrossTab[]): Quirk[] {
  const seen = new Map<string, { tab: CrossTab; cell: CrossTabCell }>();
  for (const tab of tabs) {
    for (const cell of tab.cells) {
      if (cell.hidden || cell.scoreDelta == null || cell.interaction == null) continue;
      if (cell.tournaments < MIN_FINDING_TOURNAMENTS || Math.abs(cell.interaction) < MIN_FINDING_DELTA) continue;
      const id = `crosstab:${tab.rowDimension}:${cell.row}×${tab.colDimension}:${cell.col}`;
      if (!seen.has(id)) seen.set(id, { tab, cell });
    }
  }

  const name = (dimension: CrossTabDimension, key: string) =>
    dimension === 'seat' ? seatName(key) : dimension === 'motionType' ? `${key} motions` : (PAIRING_NOUN[key] ?? key);

  const toQuirk = (id: string, { tab, cell }: { tab: CrossTab; cell: CrossTabCell }): Quirk => {
    const where = `${phrase(tab.rowDimension, cell.row)} ${phrase(tab.colDimension, cell.col)}`;
    const against =
      cell.formats.length === 1
        ? `your usual ${FORMAT_NAME[cell.formats[0]] ?? cell.formats[0]} speech`
        : 'your usual speech in each format';
    const gap = Math.abs(cell.interaction!).toFixed(1);
    const side = cell.interaction! > 0 ? 'above' : 'below';
    return {
      id,
      text:
        `${where[0].toUpperCase()}${where.slice(1)} you average ${signed(cell.scoreDelta!)} against ${against} — ` +
        `${gap} ${side} what ${name(tab.rowDimension, cell.row)} and ${name(tab.colDimension, cell.col)} predict on their own.`,
      basis: `${cell.rounds} rounds at ${cell.tournaments} tournaments`,
      tone: cell.interaction! > 0 ? 'pos' : 'neg',
    };
  };

  const all = [...seen];
  const pos = all
    .filter(([, v]) => v.cell.interaction! > 0)
    .sort((a, b) => b[1].cell.interaction! - a[1].cell.interaction!)
    .slice(0, MAX_FINDINGS_EACH_WAY);
  const neg = all
    .filter(([, v]) => v.cell.interaction! < 0)
    .sort((a, b) => a[1].cell.interaction! - b[1].cell.interaction!)
    .slice(0, MAX_FINDINGS_EACH_WAY);
  return [...pos, ...neg].map(([id, v]) => toQuirk(id, v));
}
