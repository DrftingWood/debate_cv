import { classifyOutroundStage, type OutroundStage, normalizeStageLabel } from '@/lib/calicotab/judgeStats';

/**
 * Canonical display label for each outround stage.
 *
 * The CV used to show whatever raw stage string Tabbycat emitted —
 * "Open Final", "Grand Final", "Final", "Open Finals" all rendered
 * differently across tournaments even though they're conceptually the
 * same championship round. That read as inconsistency on the user's CV.
 *
 * This helper routes every display through classifyOutroundStage (the
 * canonical classifier), then maps each canonical stage to a single
 * display string. Category prefixes ("Open", "ESL", "Novice") drop out
 * of the label here — they're either irrelevant (single-category
 * tournament) or carried separately via eliminationReachedByCategory's
 * `category` field for the multi-category EUDC dual-break case.
 *
 * "Grand Final" and "Final" both collapse to "Final" — most users
 * think of them as the same round, and the underlying rank scale
 * (grand_final=100 vs final=95 in JUDGE_STATS_RANK) still differentiates
 * them for sorting / champion detection if needed.
 *
 * Anything that doesn't classify falls back to the raw string so
 * unknown / prelim labels still render.
 */
const STAGE_DISPLAY: Record<OutroundStage, string> = {
  grand_final: 'Final',
  final: 'Final',
  semifinal: 'Semifinals',
  quarterfinal: 'Quarterfinals',
  octofinal: 'Octofinals',
  double_octofinal: 'Double Octofinals',
  triple_octofinal: 'Triple Octofinals',
};

export function formatStageForDisplay(raw: string | null | undefined): string {
  if (!raw) return '';
  // normalizeStageLabel expands abbreviations ("OF" → "Octofinals", "GF" →
  // "Grand Final") so the classifier sees the canonical form. Stored
  // eliminationReached strings come through normalizeStageLabel during
  // ingest already, but applying it again defensively covers any caller
  // that passes a raw Tabbycat label (e.g. break-tab parse intermediates).
  const normalized = normalizeStageLabel(raw);
  const classified = classifyOutroundStage(normalized);
  if (classified) return STAGE_DISPLAY[classified];
  return normalized;
}
