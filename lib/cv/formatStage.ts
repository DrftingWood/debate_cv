import {
  classifyOutroundStage,
  type OutroundStage,
  normalizeStageLabel,
} from '@/lib/calicotab/judgeStats';
import { splitOutroundStage } from '@/lib/calicotab/breakCategoryResolve';

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
 * display string.
 *
 * "Grand Final" and "Final" both collapse to "Final" — they are the same
 * round, and the rank scale gives them the same rank (95 in JUDGE_STATS_RANK).
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
  // One name per partial round, whatever the organiser called it: a
  // "Pre-Quarterfinals" and a "Partial Double Quarters" are both shown as the
  // Partial Octofinals they are (see stageLexicon.ts).
  partial_semifinal: 'Partial Semifinals',
  partial_quarterfinal: 'Partial Quarterfinals',
  partial_octofinal: 'Partial Octofinals',
  partial_double_octofinal: 'Partial Double Octofinals',
  partial_triple_octofinal: 'Partial Triple Octofinals',
};

/**
 * Canonical label for a stage with its break category stripped off.
 *
 * For callers that render the category themselves — the
 * `eliminationReachedByCategory` sites print `${category}: ${stage}`, so
 * the stage half must not repeat it ("ESL: ESL Final").
 */
export function formatBaseStageForDisplay(raw: string | null | undefined): string {
  if (!raw) return '';
  // normalizeStageLabel expands abbreviations ("OF" → "Octofinals", "GF" →
  // "Grand Final") so the classifier sees the canonical form. Stored
  // eliminationReached strings come through normalizeStageLabel during
  // ingest already, but applying it again defensively covers any caller
  // that passes a raw Tabbycat label (e.g. break-tab parse intermediates).
  const normalized = normalizeStageLabel(raw);
  const classified = classifyOutroundStage(normalized);
  if (!classified) return normalized;
  return STAGE_DISPLAY[classified];
}

/**
 * Canonical label that keeps the break category ("ESL Final",
 * "Novice Octofinals").
 *
 * The category is load-bearing, not noise: `eliminationReached` stores
 * the raw landing-page label, and `eliminationReachedByCategory` only
 * gets populated for EUDC tournaments where the team broke in more than
 * one category (see buildCvData.ts). Every other row — including the
 * common "broke in ESL only, at a non-EUDC tournament" case — carries
 * its category solely in this string. Dropping it rendered a bare
 * "Final", overstating the run, and combined with `wonTournament` it
 * read "Final (Champion)" — claiming an outright win of the whole
 * tournament rather than of the ESL bracket.
 *
 * "Open" is the exception: it's the implicit default bracket, and its
 * rounds appear as bare "Octofinals" / "Grand Final" just as often as
 * "Open Octofinals", so keeping it would reintroduce exactly the
 * inconsistency this helper exists to remove.
 */
export function formatStageForDisplay(raw: string | null | undefined): string {
  if (!raw) return '';
  const { category } = splitOutroundStage(normalizeStageLabel(raw));
  const base = formatBaseStageForDisplay(raw);
  if (!base) return '';
  if (!category || category === 'Open') return base;
  return `${category} ${base}`;
}

/**
 * The bracket a final was won in, or null for the Open bracket (bare labels
 * and a literal "Open" prefix). "ESL Grand Final" -> "ESL".
 */
export function titleCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const { category } = splitOutroundStage(normalizeStageLabel(raw));
  return !category || /^open$/i.test(category) ? null : category;
}

/**
 * What winning that final is called: "Champion" for the Open bracket and
 * "<category> Champion" otherwise ("ESL Champion", "Novice Champion",
 * "Silver Champion"). ESL / EFL / Novice final wins are titles (owner
 * decision, assumptions C10), but a reader must never take one for the Open
 * title, so the category always travels with the word.
 */
export function championTitle(raw: string | null | undefined): string {
  const category = titleCategory(raw);
  return category ? `${category} Champion` : 'Champion';
}
