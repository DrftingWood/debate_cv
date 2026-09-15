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

/**
 * ── One nomenclature ────────────────────────────────────────────────────
 *
 * The outround ladder, each rung named by the rooms a full round of it has:
 *
 *   rooms  rung                 BP teams   two-team teams
 *     1    Final / Grand Final      4            2
 *     2    Semifinals               8            4
 *     4    Quarterfinals           16            8
 *     8    Octofinals              32           16
 *    16    Double Octofinals       64           32
 *    32    Triple Octofinals      128           64
 *
 * A break that is not a power of two runs one rung PARTIALLY: the top seeds
 * take a bye through it and the rest debate for the places left. That round
 * is "Partial <rung>". BP, break 6: the Final holds 4, so teams 3-6 debate
 * one room while 1-2 wait — a Partial Semifinal, six teams at a rung that
 * would hold eight.
 *
 * Organisers also name that round from the other side, after the round it
 * feeds: "Pre-Final". Pre and Partial point in opposite directions and name
 * the same round —
 *
 *   Pre-Final          = Partial Semifinals
 *   Pre-Semifinals     = Partial Quarterfinals
 *   Pre-Quarterfinals  = Partial Octofinals
 *   Pre-Octofinals     = Partial Double Octofinals
 *
 * — so every such label resolves to its Partial rung and the CV shows that
 * one name. "Double" names a rung too: a double quarterfinal has twice the
 * rooms of the quarters, which is the octofinal, so "Partial Double Quarters"
 * is a Partial Octofinal. A partial round ranks just below its full rung and
 * above the rung beneath (JUDGE_STATS_RANK in judgeStats.ts).
 *
 * The corpus agrees: Partial Double Octofinals is followed by Octofinals at
 * all 13 tournaments that run one, Partial Double Quarters by Quarterfinals
 * at all 7, Partial Octofinals by Quarterfinals at 10 of 12.
 */
export type OutroundStage =
  | 'grand_final'
  | 'final'
  | 'semifinal'
  | 'partial_semifinal'
  | 'quarterfinal'
  | 'partial_quarterfinal'
  | 'octofinal'
  | 'partial_octofinal'
  | 'double_octofinal'
  | 'partial_double_octofinal'
  | 'triple_octofinal'
  | 'partial_triple_octofinal';

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
const FINALS = String.raw`fin(?:als?|ais|ales)`;

const RULES: Rule[] = [
  // ── pre-rounds: the Partial round of the rung below the one named ──────
  // First, because "Pre-Semifinals" contains "Semifinals" and would
  // otherwise be read as the round it merely feeds.
  {
    stage: 'partial_triple_octofinal',
    re: new RegExp(String.raw`\bpr[eé][-\s]*double[-\s]*octo(?:s|[-\s]*${FINALS})?\b`, 'i'),
  },
  {
    stage: 'partial_double_octofinal',
    re: new RegExp(String.raw`\bpr[eé][-\s]*octo(?:s|[-\s]*${FINALS})?\b`, 'i'),
  },
  {
    stage: 'partial_octofinal',
    re: new RegExp(String.raw`\bpr[eé][-\s]*qua(?:r)?ter(?:s|[-\s]*${FINALS})?\b`, 'i'),
  },
  {
    stage: 'partial_quarterfinal',
    re: new RegExp(String.raw`\bpr[eé][-\s]*semi(?:s|[-\s]*${FINALS})?\b`, 'i'),
  },
  {
    stage: 'partial_semifinal',
    re: new RegExp(String.raw`\bpr[eé][-\s]*(?:grand[-\s]*)?${FINALS}\b`, 'i'),
  },
  // ── triple octofinals ──
  {
    stage: 'triple_octofinal',
    re: new RegExp(
      String.raw`\btriples?[-\s]*oct[ao](?:s|[-\s]*finals?)?\b|\btriples\b|\btriples[-\s]*octavos${CONNECTED_FINAL}`,
      'i',
    ),
  },
  // ── double octofinals (and round-of-32) ──
  // "Octos" / "Octas" are common short forms; without them "Partial Double
  // Octos" fell through to the plain octofinal rule and outranked the
  // double-octofinal it feeds.
  {
    stage: 'double_octofinal',
    re: new RegExp(
      String.raw`\bdouble[-\s]*oct[ao](?:s|[-\s]*finals?)?\b|\bdoubles\b|\bround\s*of\s*32\b|\bdobles?[-\s]*octavos${CONNECTED_FINAL}|\bdobles?[-\s]*oitavas${CONNECTED_FINAL}|三十二强赛?|三十二強賽?`,
      'i',
    ),
  },
  // ── octofinals ── "Double Quarterfinals" / "Double QF" is this rung.
  {
    stage: 'octofinal',
    re: new RegExp(
      String.raw`\bdouble[-\s]*(?:qua(?:r)?ter(?:s|[-\s]*finals?)?|qf)\b|\bocto[-\s]*finals?\b|\boctos\b|\boctas\b|\bround\s*of\s*16\b|\boctavos${CONNECTED_FINAL}|\boitavas${CONNECTED_FINAL}|十六强赛?|十六強賽?`,
      'i',
    ),
  },
  // ── quarterfinals ("quater" is a misspelling seen in the wild) ──
  // "Double Semifinals" / "Double Semi's" / "Double SF" is this rung.
  {
    stage: 'quarterfinal',
    re: new RegExp(
      String.raw`\bdouble[-\s]*(?:semi(?:'?s|[-\s]*finals?)?|sf)\b|\bqua(?:r)?ter[-\s]*finals?\b|\bqf\b|\bquarters\b|\bcuartos${CONNECTED_FINAL}|\bquartas${CONNECTED_FINAL}|八强赛?|八強賽?|四分之一决赛|四分之一決賽|準々決勝|准准决胜`,
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
 * "Partial", in the languages the corpus uses — including the plural a
 * plural noun takes ("Octavos Parciales", "Oitavas Parciais").
 */
const PARTIAL = /\bpar[ct]ia(?:l|les|is)\b/i;

/**
 * The Partial rung for a label that says "partial". A "Partial Final" is not
 * a round that can exist — the final is already one room — so it is read as
 * the partial round of the finals series, the Partial Semifinal.
 */
const PARTIAL_OF: Record<OutroundStage, OutroundStage> = {
  grand_final: 'partial_semifinal',
  final: 'partial_semifinal',
  semifinal: 'partial_semifinal',
  partial_semifinal: 'partial_semifinal',
  quarterfinal: 'partial_quarterfinal',
  partial_quarterfinal: 'partial_quarterfinal',
  octofinal: 'partial_octofinal',
  partial_octofinal: 'partial_octofinal',
  double_octofinal: 'partial_double_octofinal',
  partial_double_octofinal: 'partial_double_octofinal',
  triple_octofinal: 'partial_triple_octofinal',
  partial_triple_octofinal: 'partial_triple_octofinal',
};

/**
 * A label with a round number in it is a prelim, whatever else it says:
 * "Round 5 (Final Prelim)", "Round 6 (Semi-Final Qualifier)". No corpus
 * outround label carries one; "Round of 16" does not match.
 */
const NUMBERED_ROUND = /\b(?:round|ronda|rodada|runde|ronde)\s*\d/i;

/** Identify the outround a label names, and which words named it. */
export function matchStage(label: string | null | undefined): StageMatch | null {
  if (!label) return null;
  const text = label.trim();
  if (!text || NUMBERED_ROUND.test(text)) return null;
  for (const { stage, re } of RULES) {
    const m = text.match(re);
    if (m) return { stage: PARTIAL.test(text) ? PARTIAL_OF[stage] : stage, matched: m[0] };
  }
  return null;
}

/**
 * Is this label a partial round — one run with byes, whether the organiser
 * called it "Partial X" or "Pre-Y"? Exported so callers reasoning about
 * "should this have classified?" share the lexicon's definition.
 */
export function isPreRound(label: string | null | undefined): boolean {
  const stage = matchStage(label)?.stage;
  return !!stage && stage.startsWith('partial_');
}

/**
 * Words that qualify a stage rather than name a bracket, so "Partial" or
 * "Double" is never reported as a break category the way "Gold" or "ESL"
 * would be.
 */
const STAGE_MODIFIERS = /^(?:partial|parcial|parciales|parciais|double|doubles|doble|dobles|triple|triples)$/i;

/** Words that join a category to a stage and belong to neither. */
const CONNECTORS = /^(?:de|del|of|the|do|da|dos|das|por|para|da|e|y|and|-|–|—|:|,)$/i;

/**
 * Category tokens that are acronyms. Everything else short is a word — "pro"
 * is "Pro", not "PRO" — which a length rule could not tell apart.
 */
const CATEGORY_ACRONYMS = new Set(['esl', 'efl', 'ell', 'eal', 'hs', 'ms', 'jhs', 'shs', 'ele']);

/** Normalise a category token's casing without destroying acronyms. */
export function normaliseCategory(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^[a-z0-9]+$/.test(t)) {
    if (CATEGORY_ACRONYMS.has(t) || /^[a-z]\d+$/.test(t)) return t.toUpperCase();
    return t[0]!.toUpperCase() + t.slice(1);
  }
  return t;
}

export type SplitStage = { category: string | null; stage: OutroundStage | null };

/**
 * A leftover word that is only stage vocabulary — a stage name, a modifier,
 * or a hyphenated run of them ("Partial-Double") — is not a category.
 */
function isStageVocabulary(word: string): boolean {
  const parts = word.split(/[-–]/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => matchStage(p) != null || STAGE_MODIFIERS.test(p));
}

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
    // caught by the space-delimited connector list below. Brackets and
    // quotes go too: "Octofinals (Partial)" must not leave "(Partial)".
    .map((w) => w.replace(/^[-–—:,()[\]'"的之]+|[-–—:,()[\]'"的之]+$/g, '').trim())
    .filter((w) => w && !CONNECTORS.test(w));

  // A leftover word that is itself stage vocabulary is redundant, not a
  // category: "Silver Final Finals" is the Silver final, and a break slug
  // literally called "quarterfinals" must not render as
  // "Quarterfinals Quarterfinals". Dropping them is also what makes this
  // function idempotent, which the CV relies on when it re-formats a label
  // it has already stored.
  const categoryWords = words.filter((w) => !isStageVocabulary(w));
  if (categoryWords.length === 0) return { category: null, stage: m.stage };
  // Keep multi-word categories intact ("English as a Second Language"), but
  // normalise the casing of a single token.
  const category =
    categoryWords.length === 1
      ? normaliseCategory(categoryWords[0]!)
      : categoryWords.join(' ');
  return { category, stage: m.stage };
}
