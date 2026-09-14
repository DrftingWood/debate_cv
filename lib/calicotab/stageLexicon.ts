/**
 * The vocabulary of outround names, and how to read a round label written
 * in it.
 *
 * ── Why a lexicon rather than a regex ───────────────────────────────────
 *
 * Tabbycat ships an English UI, and every install in a 625-tournament
 * sweep reported `<html lang="en">` and version 2.11 — but round NAMES are
 * free text typed by the organiser. So the variant is not a property of the
 * document, it is a property of the label. Three kinds of variation show up:
 *
 *   stock      "Grand Final", "Quarterfinals", "Round of 16"
 *   language   "Cuartos de Final", "Semifinais", "Gran Final"
 *   category   "Gold Final", "HS Grand Finals", "Semifinais de Iniciados"
 *
 * CJK labels are matched WITHOUT \b. JavaScript defines a word boundary
 * against [A-Za-z0-9_], so \b next to a Han or kana character does not
 * mean what it appears to mean; these forms are distinctive enough that a
 * plain substring match is both safe and correct.
 *
 * The old classifier handled only the first, and its last resort was a bare
 * `\bfinals?\b`. That is actively dangerous rather than merely incomplete:
 * "Cuartos de Final" is Spanish for QUARTERfinals and contains the word
 * "Final", so a quarterfinalist was reported as having reached the
 * tournament final. Ordering the lexicon from most specific to least is what
 * fixes that — the bare-final rule is only ever reached once every more
 * specific phrase, in every language, has failed.
 *
 * ── Why categories are not an allowlist ─────────────────────────────────
 *
 * Break categories are free text too: the same sweep turned up 76 distinct
 * category tokens (Gold, Bronze, HS, College, Elementary, Iniciado, abierto,
 * pro-am, u16, …), of which a hardcoded Open|ESL|EFL|Novice list recognised
 * 8. So the category is not matched at all — the STAGE phrase is matched,
 * and whatever text is left over is, by definition, whatever this tournament
 * calls its bracket. That generalises to categories nobody has seen yet.
 */

export type OutroundStage =
  | 'grand_final'
  | 'final'
  // Play-in rounds, for a break that is not a power of two. The top teams
  // sit out protected while the rest play in for the remaining places, so
  // a pre-round always runs at 1.5x the field of the round it feeds.
  //
  // BP — four to a room, two advance:
  //   break 6   pre-final      6,5,4,3 debate;  1,2   protected to the Final
  //   break 12  pre-semis      5-12 debate;     1-4   protected to Semis
  //   break 24  pre-quarters   9-24 debate;     1-8   protected to Quarters
  //   break 48  pre-octos      17-48 debate;    1-16  protected to Octos
  //
  // AP / Australs — two to a room, one advances, so the same rounds occur
  // at half those break sizes:
  //   break 6   pre-semis      3-6 debate;      1,2   protected to Semis
  //   break 12  pre-quarters   5-12 debate;     1-4   protected to Quarters
  //   break 24  pre-octos      9-24 debate;     1-8   protected to Octos
  // AP has no pre-final in practice: it would need a three-team break, and
  // a single room before the final is just called the semifinal.
  //
  // Each is a round in its own right: it is not the round it feeds (a team
  // in the pre-final has not reached the final) and not the round below
  // either — a 6-break BP pre-final has no semifinal to be. The ranks in
  // judgeStats place each between the two, which holds for both formats.
  | 'pre_final'
  | 'semifinal'
  | 'pre_semifinal'
  | 'quarterfinal'
  | 'pre_quarterfinal'
  | 'octofinal'
  | 'pre_octofinal'
  | 'double_octofinal'
  | 'triple_octofinal';

type Rule = { stage: OutroundStage; re: RegExp };

/**
 * Ordered most specific first. Within a tier, every language is tried before
 * moving to a broader tier, so no language's bare "final" can pre-empt
 * another language's "quarterfinal".
 *
 * Each pattern absorbs its own trailing connector ("de final", "of finals")
 * so the leftover text is the category and not a fragment of the stage name.
 */
const CONNECTED_FINAL = String.raw`(?:\s*(?:de|of|do|da|dos|das)?\s*finals?(?:es|is)?)?`;

const RULES: Rule[] = [
  // ── play-in rounds ────────────────────────────────────────────────────
  // First, because "Pre-Semifinals" contains "Semifinals" and would
  // otherwise be read as the round it merely feeds.
  { stage: 'pre_octofinal', re: /\bpr[eé][-\s]*octo[-\s]*fin(?:als?|ais|ales)\b|\bpr[eé][-\s]*octos?\b/i },
  {
    stage: 'pre_quarterfinal',
    re: /\bpr[eé][-\s]*qua(?:r)?ter[-\s]*fin(?:als?|ais|ales)\b|\bpr[eé][-\s]*quarters?\b/i,
  },
  {
    stage: 'pre_semifinal',
    re: /\bpr[eé][-\s]*semi[-\s]*fin(?:als?|ais|ales)\b|\bpr[eé][-\s]*semis?\b/i,
  },
  { stage: 'pre_final', re: /\bpr[eé][-\s]*grand[-\s]*fin(?:als?|ais|ales)\b/i },
  { stage: 'pre_final', re: /\bpr[eé][-\s]*fin(?:als?|ais|ales)\b/i },
  // ── triple octofinals ──
  { stage: 'triple_octofinal', re: /\btriple[-\s]*octo(?:finals?)?\b|\btriples\b|\btriples[-\s]*octavos\b/i },
  // ── double octofinals (incl. partials and round-of-32) ──
  {
    stage: 'double_octofinal',
    re: new RegExp(
      String.raw`\b(?:partial\s+)?double[-\s]*octo(?:finals?)?\b|\bdoubles\b|\bround\s*of\s*32\b|\bdoble[-\s]*octavos${CONNECTED_FINAL}|\bdobles[-\s]*oitavas${CONNECTED_FINAL}|\bdouble[-\s]*octas\b|三十二强赛?|三十二強賽?`,
      'i',
    ),
  },
  // ── octofinals ──
  {
    stage: 'octofinal',
    re: new RegExp(
      String.raw`\bocto[-\s]*finals?\b|\boctos\b|\boctas\b|\bround\s*of\s*16\b|\boctavos${CONNECTED_FINAL}|\boitavas${CONNECTED_FINAL}|十六强赛?|十六強賽?`,
      'i',
    ),
  },
  // ── quarterfinals ("quater" is a misspelling seen in the wild) ──
  {
    stage: 'quarterfinal',
    re: new RegExp(
      String.raw`\bqua(?:r)?ter[-\s]*finals?\b|\bqf\b|\bquarters\b|\bcuartos${CONNECTED_FINAL}|\bquartas${CONNECTED_FINAL}|八强赛?|八強賽?|四分之一决赛|四分之一決賽|準々決勝|准准决胜`,
      'i',
    ),
  },
  // ── semifinals ──
  {
    stage: 'semifinal',
    re: new RegExp(
      String.raw`\bsemi[-\s]*finals?\b|\bsf\b|\bsemi'?s?\b|\bsemi[-\s]*finales\b|\bsemi[-\s]*finais\b|\bsemi[-\s]*finais${CONNECTED_FINAL}|四强赛?|四強賽?|半决赛|半決賽|準決勝`,
      'i',
    ),
  },
  // ── grand final ──
  { stage: 'grand_final', re: /\bgrand[-\s]*final(?:e|s)?\b|\bgf\b|\bgran[-\s]*finals?(?:es)?\b|\bgrande[-\s]*finals?(?:is)?\b|总决赛|總決賽/i },
  // ── plain final: last resort, after every more specific phrase above ──
  { stage: 'final', re: /\bfinals?\b|\bfinales\b|\bfinais\b|决赛|決賽|決勝/i },
];

export type StageMatch = {
  stage: OutroundStage;
  /** The exact substring that named the stage, so callers can strip it. */
  matched: string;
};

/**
 * Does this label name a play-in round? The accented, spaced and grand
 * spellings are easy to miss ("Pré-Semifinal", "Pre - Finals", "Pre-Grand
 * Finals"), so the pattern lives here once.
 */
const PRE_ROUND =
  /\bpr[eé][-\s]*(?:grand[-\s]*)?(?:octo|qua(?:r)?ter|semi|final)/i;

/**
 * Is this label a play-in round? Exported so callers that reason about
 * "should this have classified?" use the same definition rather than
 * re-deriving one — the accented, spaced and grand spellings are easy to
 * miss ("Pré-Semifinal", "Pre - Finals", "Pre-Grand Finals").
 */
export function isPreRound(label: string | null | undefined): boolean {
  return !!label && PRE_ROUND.test(label.trim());
}

/** Identify the outround a label names, and which words named it. */
export function matchStage(label: string | null | undefined): StageMatch | null {
  if (!label) return null;
  const text = label.trim();
  if (!text) return null;
  for (const { stage, re } of RULES) {
    const m = text.match(re);
    if (m) return { stage, matched: m[0] };
  }
  return null;
}

/**
 * Words that qualify a stage rather than name a bracket. "Partial
 * Octofinals" is an octofinal with byes, so "Partial" must not end up
 * reported as a break category the way "Gold" or "ESL" would be.
 */
const STAGE_MODIFIERS = /^(?:partial|parcial|double|triple|doble)$/i;

/** Words that join a category to a stage and belong to neither. */
const CONNECTORS = /^(?:de|del|of|the|do|da|dos|das|por|para|da|e|y|and|-|–|—|:|,)$/i;

/** Normalise a category token's casing without destroying acronyms. */
function normaliseCategory(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^[a-z]+$/.test(t)) {
    // All lowercase: short tokens are acronyms (esl, efl, ele, hs, pa),
    // longer ones are words.
    return t.length <= 3 ? t.toUpperCase() : t[0]!.toUpperCase() + t.slice(1);
  }
  return t;
}

export type SplitStage = { category: string | null; stage: OutroundStage | null };

/**
 * Read a round label into the stage it names and the break category it
 * belongs to, if any.
 *
 * The category is the remainder: whatever is not the stage phrase and not a
 * connector. That is what lets an unseen category ("Gold", "Elementary",
 * "Iniciados") survive to the CV instead of being silently discarded and
 * making a secondary-bracket run read as the main bracket.
 */
export function splitStageLabel(label: string | null | undefined): SplitStage {
  const m = matchStage(label);
  if (!m) return { category: null, stage: null };

  const text = (label ?? '').trim();
  const idx = text.toLowerCase().indexOf(m.matched.toLowerCase());
  const before = idx >= 0 ? text.slice(0, idx) : '';
  const after = idx >= 0 ? text.slice(idx + m.matched.length) : '';

  const words = `${before} ${after}`
    .split(/\s+/)
    // 的 / 之 join a category to a stage in Chinese ("Novice的决赛") and are
    // not separated by spaces, so they are stripped here rather than being
    // caught by the space-delimited connector list below.
    .map((w) => w.replace(/^[-–—:,的之]+|[-–—:,的之]+$/g, '').trim())
    .filter((w) => w && !CONNECTORS.test(w));

  // A leftover word that is itself a stage name is redundant, not a
  // category: "Silver Final Finals" is the Silver final, and a break slug
  // literally called "quarterfinals" must not render as
  // "Quarterfinals Quarterfinals". Dropping them is also what makes this
  // function idempotent, which the CV relies on when it re-formats a label
  // it has already stored.
  const categoryWords = words.filter((w) => !matchStage(w) && !STAGE_MODIFIERS.test(w));
  if (categoryWords.length === 0) return { category: null, stage: m.stage };
  // Keep multi-word categories intact ("English as a Second Language"), but
  // normalise the casing of a single token.
  const category =
    categoryWords.length === 1
      ? normaliseCategory(categoryWords[0]!)
      : categoryWords.join(' ');
  return { category, stage: m.stage };
}
