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
  if (/^round\s+\d+$/i.test(trimmed)) return 'inround';
  if (/^r\d+$/i.test(trimmed)) return 'inround';

  // Outrounds: standard abbreviations or full-word forms.
  if (OUTROUND_ABBREVS.test(trimmed)) return 'outround';
  if (OUTROUND_WORDS.test(trimmed)) return 'outround';
  if (OUTROUND_BARE.test(trimmed)) return 'outround';
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

export type JudgeRoundInput = {
  roundNumber: number | null;
  roundLabel: string | null;
  isOutround: boolean;
  judgeAssignments: { personKey: string; panelRole: 'chair' | 'panel' | null }[];
};

export type JudgeStats = {
  chairedPrelimRounds: number;
  lastOutroundChaired: string | null;
  lastOutroundPaneled: string | null;
};

/**
 * Canonical outround stage. Source of truth for both `outroundRank`
 * (used by judge stats / CV champion check) and `outroundStageRank`
 * (used by ingest). The two functions need different numeric scales —
 * ingest gives "Grand Final" headroom over plain "Final" because it
 * also has to distinguish category-prefixed finals — but the regex
 * patterns that decide WHICH stage a label is must not drift between
 * them. Centralising the classifier keeps both call sites in lock-step.
 */
export type OutroundStage =
  | 'grand_final'
  | 'final'
  | 'semifinal'
  | 'quarterfinal'
  | 'octofinal'
  | 'double_octofinal'
  | 'triple_octofinal';

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
export function classifyOutroundStage(
  label: string | null | undefined,
): OutroundStage | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (/grand\s*final|\bgf\b/.test(s)) return 'grand_final';
  if (/semi[-\s]?final|\bsf\b|\bsemis?\b/.test(s)) return 'semifinal';
  if (/quarter[-\s]?final|\bqf\b|\bquarters?\b/.test(s)) return 'quarterfinal';
  if (/triple\s*octo|\btriples?\b/.test(s)) return 'triple_octofinal';
  if (/partial|double\s*octo|\bdoubles?\b|round\s*of\s*32/.test(s)) return 'double_octofinal';
  if (/octo[-\s]?final|\boctos?\b|round\s*of\s*16/.test(s)) return 'octofinal';
  if (/\bfinals?\b/.test(s)) return 'final';
  return null;
}

const JUDGE_STATS_RANK: Record<OutroundStage, number> = {
  grand_final: 100,
  final: 95,
  semifinal: 90,
  quarterfinal: 80,
  octofinal: 70,
  double_octofinal: 60,
  triple_octofinal: 50,
};

/**
 * Ordinal rank for an out-round stage. Higher = later. Plain numeric
 * round labels for outrounds also rank in numeric order so R9 > R8 > …
 * even when we don't know the stage name.
 *
 * Returns -1 when the round isn't an outround (callers should skip it).
 */
export function outroundRank(round: { roundLabel: string | null; roundNumber: number | null; isOutround: boolean }): number {
  if (!round.isOutround) return -1;
  const stage = classifyOutroundStage(round.roundLabel);
  if (stage) return JUDGE_STATS_RANK[stage];
  if (round.roundNumber != null) return round.roundNumber;
  return 0;
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
  return rankFor(p) > rankFor(c) ? p : c;
}

/**
 * Aggregate per-judge statistics across a tournament's rounds.
 *
 * Dedup rule for chairedPrelimRounds: a judge who chaired two rooms in the
 * same round still only counts once. Keyed by (personKey, roundNumber).
 *
 * Last-outround fields are written once and replaced only when we see a
 * strictly-later outround (per `outroundRank`). That way the order we iterate
 * `rounds` is irrelevant.
 */
export function aggregateJudgeStats(rounds: JudgeRoundInput[]): Map<string, JudgeStats> {
  const stats = new Map<string, JudgeStats>();
  const chairedSeen = new Set<string>(); // personKey|roundNumber
  const bestChair = new Map<string, number>(); // personKey -> outroundRank
  const bestPanel = new Map<string, number>();

  for (const round of rounds) {
    const stageRank = outroundRank(round);
    const isPrelim = !round.isOutround && round.roundNumber != null && round.roundNumber <= 5;

    for (const j of round.judgeAssignments) {
      const key = j.personKey;
      const stat =
        stats.get(key) ??
        ({ chairedPrelimRounds: 0, lastOutroundChaired: null, lastOutroundPaneled: null } satisfies JudgeStats);

      if (isPrelim && j.panelRole === 'chair') {
        const dedupKey = `${key}|${round.roundNumber}`;
        if (!chairedSeen.has(dedupKey)) {
          chairedSeen.add(dedupKey);
          stat.chairedPrelimRounds += 1;
        }
      }

      if (round.isOutround) {
        const label = round.roundLabel ?? `Round ${round.roundNumber ?? '?'}`;
        if (j.panelRole === 'chair' && stageRank > (bestChair.get(key) ?? -Infinity)) {
          bestChair.set(key, stageRank);
          stat.lastOutroundChaired = label;
        }
        if (j.panelRole === 'panel' && stageRank > (bestPanel.get(key) ?? -Infinity)) {
          bestPanel.set(key, stageRank);
          stat.lastOutroundPaneled = label;
        }
      }

      stats.set(key, stat);
    }
  }

  return stats;
}
