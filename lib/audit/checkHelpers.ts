import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';
import type { AuditInputs, AuditPiece } from './auditInputs';
import { publicPieceUrl, type CheckCode, type CheckResult, type CheckStatus } from './types';

/**
 * Shared vocabulary for the checks: room shape by format, which prelim rounds
 * exist, how a suggested piece is found, and how a detail sentence lists
 * things. Kept apart from the checks so each check file reads as rules only.
 */

export type SuggestedPiece = CheckResult['pieces'][number];

const BP_POSITIONS = new Set(['og', 'oo', 'cg', 'co']);

/**
 * Teams per room: 4 for British Parliamentary, or whenever a round row sits
 * at a BP position, since `format` is null on many older tournaments while
 * their rows still say OG/OO/CG/CO. Every other format seats two.
 */
export function teamsPerRoom(
  format: string | null,
  roundRows: ReadonlyArray<{ position: string | null }>,
): 2 | 4 {
  if (format?.trim().toLowerCase() === 'british parliamentary') return 4;
  const bp = roundRows.some(
    (r) => r.position != null && BP_POSITIONS.has(r.position.trim().toLowerCase()),
  );
  return bp ? 4 : 2;
}

const THREE_SPEAKER_FORMATS = new Set(['asian parliamentary', 'world schools', 'australs']);

/**
 * The fewest speakers a team must have on record. A minimum, never a maximum:
 * World Schools squads run to five and Australs teams often carry a fourth.
 */
export function minSpeakers(format: string | null): 2 | 3 {
  return format && THREE_SPEAKER_FORMATS.has(format.trim().toLowerCase()) ? 3 : 2;
}

/** Team names compared loosely: the tab and a round page can differ in case or spacing. */
export function teamKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Prelim rows only. With a known round count, rows past it (an outround a
 * loader might pass by mistake) are left out.
 */
export function prelimRows(
  inputs: Pick<AuditInputs, 'prelimRoundCount' | 'roundRows'>,
): AuditInputs['roundRows'] {
  const n = inputs.prelimRoundCount;
  return inputs.roundRows.filter((r) => r.round >= 1 && (n == null || r.round <= n));
}

/**
 * The prelim rounds that should exist: 1..prelimRoundCount, or, when the
 * count was never recorded, 1..the highest round with rows.
 */
export function expectedPrelims(
  inputs: Pick<AuditInputs, 'prelimRoundCount' | 'roundRows'>,
): number[] {
  const n = inputs.prelimRoundCount ?? prelimRows(inputs).reduce((m, r) => Math.max(m, r.round), 0);
  return Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);
}

/** Rooms per prelim round with rows: teams ÷ teams per room, rounded up (a swing team still fills a room). */
export function roomsByRound(inputs: AuditInputs): Map<number, number> {
  const teams = new Map<number, Set<string>>();
  for (const r of prelimRows(inputs)) {
    const set = teams.get(r.round) ?? new Set<string>();
    set.add(teamKey(r.team));
    teams.set(r.round, set);
  }
  const perRoom = teamsPerRoom(inputs.format, inputs.roundRows);
  const rounds = [...teams.keys()].sort((a, b) => a - b);
  return new Map(rounds.map((round) => [round, Math.ceil(teams.get(round)!.size / perRoom)]));
}

// ── brackets ────────────────────────────────────────────────────────────

/**
 * The bracket an outround label belongs to: its category lowercased, with no
 * category meaning Open. The same key a break piece carries ("open", "esl",
 * "pro-am"), so a bracket and its break page line up.
 */
export function bracketKey(category: string | null): string {
  return category == null ? 'open' : category.trim().toLowerCase();
}

export function bracketOfLabel(label: string): string {
  return bracketKey(splitStageLabel(label).category);
}

/** Break rows say "Open" or "ESL"; a row whose category was never known was stored as "break". */
export function bracketOfBreak(stage: string): string {
  const s = stage.trim().toLowerCase();
  return s === 'break' ? 'open' : s;
}

// ── suggested pieces ────────────────────────────────────────────────────

/** A recorded piece as a suggestion, its URL made public. */
export function suggest(p: AuditPiece): SuggestedPiece {
  return { kind: p.kind, key: p.key, label: p.label, url: p.url ? publicPieceUrl(p.url) : null };
}

const TAB_LABELS = { team: 'Team tab', speaker: 'Speaker tab', motions: 'Motions' } as const;

/**
 * A single tab page. Suggested even when no piece was recorded: its key is
 * fixed, so a re-scrape can still find it (and reports it harmlessly as not
 * on the tab if it is not there).
 */
export function tabPiece(pieces: AuditPiece[], kind: keyof typeof TAB_LABELS): SuggestedPiece {
  const found = pieces.find((p) => p.kind === kind);
  return found ? suggest(found) : { kind, key: '', label: TAB_LABELS[kind], url: null };
}

/** A prelim round's piece, keyed by its number; made up from the number when none was recorded. */
export function prelimPiece(pieces: AuditPiece[], round: number): SuggestedPiece {
  const key = String(round);
  const found = pieces.find((p) => p.kind === 'round' && p.key === key);
  return found ? suggest(found) : { kind: 'round', key, label: `R${round}`, url: null };
}

const normLabel = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Round pieces that are outrounds: their label names a stage ("Grand Final"), where a prelim's says "R3". */
export function outroundRoundPieces(pieces: AuditPiece[]): AuditPiece[] {
  return pieces.filter((p) => p.kind === 'round' && matchStage(p.label) != null);
}

/**
 * The round piece for an outround stage. Outround pieces are keyed by the
 * tab's round sequence number, which the outround rows do not carry, so they
 * are found by label: the same text first, then the same stage in the same
 * bracket ("Semis" for "Semifinals"). Null when nothing matches: an outround
 * has no number to make a piece up from.
 */
export function outroundPiece(pieces: AuditPiece[], stage: string): SuggestedPiece | null {
  const rounds = outroundRoundPieces(pieces);
  const exact = rounds.find((p) => normLabel(p.label) === normLabel(stage));
  if (exact) return suggest(exact);
  const want = splitStageLabel(stage);
  if (!want.stage) return null;
  const same = rounds.find((p) => {
    const got = splitStageLabel(p.label);
    return got.stage === want.stage && bracketKey(got.category) === bracketKey(want.category);
  });
  return same ? suggest(same) : null;
}

/** Team break pieces, optionally one bracket's. The adjudicator break says nothing about teams. */
export function breakPieces(pieces: AuditPiece[], bracket?: string): SuggestedPiece[] {
  return pieces
    .filter((p) => p.kind === 'break' && p.key !== 'adjudicators')
    .filter((p) => bracket == null || p.key === bracket)
    .map(suggest);
}

export function dedupePieces(pieces: SuggestedPiece[]): SuggestedPiece[] {
  const seen = new Set<string>();
  return pieces.filter((p) => {
    const k = `${p.kind}\u0000${p.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── results and sentences ───────────────────────────────────────────────

// eslint-disable-next-line max-params -- four plainly distinct fields of one record; an options object would only add noise at forty call sites
export function result(
  code: CheckCode,
  status: CheckStatus,
  detail: string,
  pieces: SuggestedPiece[] = [],
): CheckResult {
  return { code, status, detail, pieces: dedupePieces(pieces) };
}

const STATUS_ORDER: Record<CheckStatus, number> = { na: 0, pass: 1, warn: 2, fail: 3 };

export function worst(statuses: CheckStatus[]): CheckStatus {
  return statuses.reduce<CheckStatus>(
    (w, s) => (STATUS_ORDER[s] > STATUS_ORDER[w] ? s : w),
    'pass',
  );
}

/** "A", "A and B", "A, B and C": for naming rounds or pages inside one sentence. */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The median; for an even count, the mean of the two middle values (owner ruling 8). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
