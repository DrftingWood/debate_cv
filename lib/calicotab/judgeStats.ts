/**
 * Whether a round label refers to a preliminary ("inround") or an
 * elimination ("outround") stage.
 */
export type RoundKind = 'inround' | 'outround' | 'unknown';

const OUTROUND_ABBREVS = /^(?:GF|F|SF|QF|OF|DOF|TOF)$/i;
const OUTROUND_WORDS =
  /^(?:grand\s*finals?|finals?|semi[-\s]?finals?|quarter[-\s]?finals?|octo[-\s]?finals?|double\s*octo[-\s]?finals?|triple\s*octo[-\s]?finals?|partial\s*double[-\s]?octofinals?|partial\s*triple[-\s]?octofinals?|round\s*of\s*\d+)$/i;
// Bare colloquial forms — what some Tabbycat themes render in the
// `.tooltip-trigger` span when no `data-original-title` is present.
const OUTROUND_BARE = /^(?:octos?|doubles?|triples?|quarters?|semis?)$/i;

/**
 * Map a Tabbycat stage cell — possibly already canonical ("Round 1",
 * "Quarterfinals"), possibly an abbreviation ("R1", "QF") — to a canonical
 * form so every downstream consumer (classifier, dedup keys, schema rows,
 * UI labels) sees one vocabulary regardless of which Tabbycat HTML variant
 * produced it.
 *
 * The "R\d+" form arises when the round cell is just
 *   <span class="tooltip-trigger">R1</span>
 * with no enclosing `<div data-original-title="Round 1">`. Without
 * normalization the bare "R1" makes `roundNumber` null (so prelims look
 * like outrounds) and bypasses `classifyRoundLabel`'s inround patterns
 * (so chair counts come out 0).
 *
 * Inputs that already match the canonical form pass through unchanged —
 * the test fixtures with `data-original-title="Round 1"` keep working.
 *
 * Stage 1 of the 3-stage round-label pipeline:
 *   {@link normalizeStageLabel} → {@link classifyRoundLabel} → {@link classifyOutroundStage}
 */
export function normalizeStageLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const rMatch = t.match(/^R(\d+)$/i);
  if (rMatch) return `Round ${Number(rMatch[1])}`;
  const lower = t.toLowerCase();
  // Order matters: longer prefixes first so "DOF" doesn't match "F" first.
  if (/^gf$/i.test(t)) return 'Grand Final';
  if (/^sf$/i.test(t) || lower === 'semis') return 'Semifinals';
  if (/^qf$/i.test(t) || lower === 'quarters') return 'Quarterfinals';
  if (/^dof$/i.test(t) || lower === 'doubles') return 'Double Octofinals';
  if (/^tof$/i.test(t) || lower === 'triples') return 'Triple Octofinals';
  if (/^of$/i.test(t) || lower === 'octos') return 'Octofinals';
  if (/^f$/i.test(t)) return 'Final';
  return t;
}

/**
 * Classify a round label as inround (numeric prelim) vs outround (named
 * elimination).
 *
 *   "1", "2", "3"          → inround   (numeric strings — Tabbycat default)
 *   "Round 5"              → inround   (the "Round " prefix is stripped first)
 *   "QF", "SF", "F", "GF"  → outround  (standard outround abbreviations)
 *   "Quarterfinals"        → outround  (full word forms)
 *   "Grand Final"          → outround
 *   ""  /  null  /  garbage → unknown   (defensive — never throws)
 */
export function classifyRoundLabel(stage: string | null | undefined): RoundKind {
  if (typeof stage !== 'string') return 'unknown';
  const trimmed = stage.trim();
  if (!trimmed) return 'unknown';

  // Inrounds: pure numeric ("1", "12"), "Round N" form ("Round 5"), or
  // the "R\d+" abbreviation ("R1", "R12") that Tabbycat renders in the
  // `.tooltip-trigger` span when no `data-original-title` is present. The
  // "Round " prefix strip is anchored to a numeric body so labels like
  // "Round of 16" (an outround) aren't mis-stripped to "of 16".
  if (/^\d+$/.test(trimmed)) return 'inround';
  // Split and translated prelims too — "Round 1A", "Round 1-B", "Rodada 0",
  // "Ronda 3" — or a chair at a split-round tournament chaired no prelims.
  if (/^(?:round|ronda|rodada|runde)\s*\d+(?:\s*-?\s*[a-z])?$/i.test(trimmed)) return 'inround';
  if (/^r\d+[a-z]?$/i.test(trimmed)) return 'inround';

  // Outrounds: standard abbreviations or full-word forms, then anything the
  // stage lexicon reads ("Partial Double Quarters", "Pre-Octofinals"), so
  // the two classifiers never disagree about what an outround is.
  if (OUTROUND_ABBREVS.test(trimmed)) return 'outround';
  if (OUTROUND_WORDS.test(trimmed)) return 'outround';
  if (OUTROUND_BARE.test(trimmed)) return 'outround';
  if (matchStage(trimmed)) return 'outround';
  return 'unknown';
}

/**
 * One judge-assignment entry. Shape is intentionally minimal so this helper
 * can be called from any layer — DB rows, parser output, raw JSON — without
 * forcing callers to adapt.
 */
export type JudgeRoundEntry = {
  stage: string | null | undefined;
  panelRole: string | null | undefined;
};

/**
 * Count the inrounds (numeric prelims) a judge chaired.
 *
 * Iterates `judge_data` once, classifies each round via
 * {@link classifyRoundLabel}, and tallies entries that are both:
 *   - inround (numeric stage), and
 *   - chaired ("chair", case-insensitive, whitespace-tolerant).
 *
 * Robust to malformed input: non-array, null, undefined, or array with
 * non-object entries all return 0 rather than throwing.
 */
export function getInroundsChairedCount(
  judgeData: ReadonlyArray<JudgeRoundEntry> | null | undefined,
): number {
  if (!Array.isArray(judgeData)) return 0;
  let count = 0;
  for (const entry of judgeData) {
    if (!entry || typeof entry !== 'object') continue;
    if (classifyRoundLabel(entry.stage) !== 'inround') continue;
    const role = (entry.panelRole ?? '').toString().trim().toLowerCase();
    if (role !== 'chair') continue;
    count += 1;
  }
  return count;
}

// ── Adjudication core ───────────────────────────────────────────────────────

/**
 * What kind of adjudication-core member a role text names. The stored tag
 * stays 'core' for all of them (no data-shape change); the kind only decides
 * how much we assume about judging.
 */
export type CoreRoleKind = 'tab_director' | 'chief_adjudicator' | 'adj_core';

/**
 * Read a participant's role text. `\bd?ca\b` is a standalone word so a name
 * such as "Cameron" does not match. Someone who is both Tab Director and CA is
 * read as the CA, who judges. Returns null for anyone not on the core.
 */
export function classifyCoreRole(roleText: string | null | undefined): CoreRoleKind | null {
  const t = (roleText ?? '').toLowerCase();
  // Organisers type these by hand, so the spellings vary: "CAP" / "DCAP"
  // (the chief adjudicator panel), "Chief Adjudication Panel", plurals
  // ("CAs", "Deputy Chief Adjudicators"). Every one is core; missing them
  // left the person an ordinary judge with no core mark or judging break.
  if (
    /\b(?:chief|deputy)\s+(?:chief\s+)?adjudicat(?:or|ion)s?\b/.test(t) ||
    /\bd?ca[ps]?\b/.test(t)
  )
    return 'chief_adjudicator';
  // "Adj Core", "Adj-Core", "Adj. Core", "Adjudication Core", "Core Adj",
  // "Core Adjudicators".
  if (
    /\badj(?:udicat(?:or|ion)s?)?\.?[\s-]*core\b/.test(t) ||
    /\bcore[\s-]+adj(?:udicat(?:or|ion)s?)?\b/.test(t)
  )
    return 'adj_core';
  if (/\btab[\s-]?directors?\b/.test(t)) return 'tab_director';
  return null;
}

export function isAdjudicationCoreRole(roleText: string | null | undefined): boolean {
  return classifyCoreRole(roleText) != null;
}

/**
 * Owner rule (assumptions I20, 2026-10-27): Chief Adjudicators usually judge
 * the competition; Tab Directors usually do not. So a core row from the roster
 * is no evidence that its holder judged; only judging rounds are (see
 * coreJudgingBreak below).
 *
 * Owner rule: if a Tab Director does judge, that counts as a judging break
 * for them; technically it does for a judging CA too. So any core member who
 * sat on a round has a judging break; one who never judged does not, and nor
 * does an ordinary judge (who breaks only by judging an outround).
 */
export function coreJudgingBreak(
  judgeTypeTag: string | null | undefined,
  judgedAnyRound: boolean,
): boolean {
  return judgeTypeTag?.toLowerCase() === 'core' && judgedAnyRound;
}

export type { OutroundStage } from '@/lib/calicotab/stageLexicon';
import type { OutroundStage } from '@/lib/calicotab/stageLexicon';
import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';

/**
 * Map a raw outround label ("Grand Final", "ESL Quarterfinals",
 * "Novice Final", "GF", "Quarters", "Round of 16") to its canonical
 * stage. Returns null for prelim labels, null/empty input, or labels
 * that don't match any known outround pattern.
 *
 * Order matters: stage-specific patterns ("semi", "quarter", "octo")
 * run before the bare-final fallthrough so labels like "Quarterfinal"
 * (which contains the "final" substring) classify as quarterfinal
 * rather than final. Triple/double octo run before plain octo for the
 * same reason.
 *
 * Category-prefixed labels ("Novice Final", "ESL Semifinals", "U16
 * Octofinals") are intentionally accepted: Tabbycat splits a single
 * tournament into multiple parallel break categories and labels each
 * bracket's last round with the category name. The bare-final regex
 * is deliberately not anchored at `^…$` so those still classify.
 */
export function classifyOutroundStage(label: string | null | undefined): OutroundStage | null {
  // Delegates to the lexicon so every caller sees the same vocabulary —
  // stock English, the Spanish/Portuguese variants, and any category prefix
  // a tournament invents. Ordering lives there: the bare "final" rule is
  // reached only after every more specific phrase has failed, which is what
  // stops "Cuartos de Final" (quarterfinals) reading as the final.
  return matchStage(label)?.stage ?? null;
}

const JUDGE_STATS_RANK: Record<OutroundStage, number> = {
  // "Final" and "Grand Final" are one round (owner decision, assumptions I8/C8),
  // so they share a rank.
  grand_final: 95,
  final: 95,
  // Each rung, and just below it the same rung run partially — with byes
  // (see "One nomenclature" in stageLexicon.ts). Partial sits under its full
  // rung and over the rung beneath, except the partial quarterfinal
  // ("Pre-Semis", the BP 12-team round), which the owner treats as a
  // quarterfinal (C11) and so shares its rank.
  semifinal: 90,
  partial_semifinal: 85,
  quarterfinal: 80,
  partial_quarterfinal: 80,
  octofinal: 70,
  partial_octofinal: 65,
  double_octofinal: 60,
  partial_double_octofinal: 55,
  triple_octofinal: 50,
  partial_triple_octofinal: 45,
};

/**
 * Tie-break among one-day-competition tier finals: Gold > Silver > Bronze
 * (owner decision, assumptions C9/Q1). These are valid open-category finals,
 * so they count as breaks and as final-level appearances; the tier only
 * orders them at equal stage depth. Any other label returns 0.
 */
export function tierRank(label: string | null | undefined): number {
  if (!label) return 0;
  if (/\bgold\b/i.test(label)) return 3;
  if (/\bsilver\b/i.test(label)) return 2;
  if (/\bbronze\b/i.test(label)) return 1;
  return 0;
}

/**
 * Strict variant of {@link outroundRank} for callers that only have a
 * stage label (no structured roundNumber/isOutround context) and want
 * `null` returned when the label doesn't classify as a canonical outround.
 *
 * Used by ingest.ts's "deepest reached" computation, replacing the
 * previously-duplicated `INGEST_STAGE_RANK` table. Both helpers now share
 * the canonical 50-100 scale defined in `JUDGE_STATS_RANK`.
 */
export function outroundRankStrict(label: string | null | undefined): number | null {
  const stage = classifyOutroundStage(label);
  return stage ? JUDGE_STATS_RANK[stage] : null;
}

/**
 * Ordinal rank for an out-round stage. Higher = later. Plain numeric
 * round labels for outrounds also rank in numeric order so R9 > R8 > …
 * even when we don't know the stage name.
 *
 * Returns -1 when the round isn't an outround (callers should skip it).
 */
export function outroundRank(round: {
  roundLabel: string | null;
  roundNumber: number | null;
  isOutround: boolean;
}): number {
  if (!round.isOutround) return -1;
  const stage = classifyOutroundStage(round.roundLabel);
  if (stage) return JUDGE_STATS_RANK[stage];
  if (round.roundNumber != null) return round.roundNumber;
  return 0;
}

/**
 * THE comparator for "which outround is deeper". Positive when `a` is deeper.
 * Order: stage rank, then the Open bracket before a category bracket (an
 * "ESL Final" does not outrank a "Grand Final"), then Gold > Silver > Bronze,
 * then the label itself so the answer never depends on list order. Every
 * "deepest outround" site uses this; the rank comes from the caller because
 * ingest wants unclassified labels dropped while the CV scale keeps them.
 */
export function compareOutroundDepth(
  a: { label: string; rank: number },
  b: { label: string; rank: number },
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const isOpen = (label: string) => {
    const c = splitStageLabel(label).category;
    return !c || c.toLowerCase() === 'open';
  };
  const openDiff = Number(isOpen(a.label)) - Number(isOpen(b.label));
  if (openDiff !== 0) return openDiff;
  const tierDiff = tierRank(a.label) - tierRank(b.label);
  if (tierDiff !== 0) return tierDiff;
  // Equal in every respect that matters: break the tie on the text, deterministically.
  return a.label < b.label ? 1 : a.label > b.label ? -1 : 0;
}

/**
 * Pick the deeper outround across the URL owner's chair and panel roles.
 *
 * `TournamentParticipant.lastOutroundChaired` and `lastOutroundPaneled` are
 * stored separately so that the chair-deepest and panel-deepest rounds can
 * disagree (e.g. chaired QF, paneled SF). This helper answers the
 * combined "Last outround judged (any role)" question by ranking both via
 * `outroundRank` and returning the higher.
 *
 * Returns null when neither is set.
 */
export function deepestOutroundAcrossRoles(
  chaired: string | null | undefined,
  paneled: string | null | undefined,
): string | null {
  const c = chaired ?? null;
  const p = paneled ?? null;
  if (!c && !p) return null;
  if (!c) return p;
  if (!p) return c;
  const rankFor = (label: string) =>
    outroundRank({ roundLabel: label, roundNumber: null, isOutround: true });
  return compareOutroundDepth({ label: p, rank: rankFor(p) }, { label: c, rank: rankFor(c) }) > 0
    ? p
    : c;
}
