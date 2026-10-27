/**
 * Motion type from the wording of the motion.
 *
 * A motion's stem is not just grammar: it decides what each side has to
 * prove, which is what debaters mean by "motion type".
 *
 *   Policy      THW                      a mechanism, better than the status quo
 *   Actor       TH, as X, would …        what is in a particular actor's interest
 *   Belief      THBT                     a judgement about the world, no mechanism
 *   Stance      THS / THO                whether a phenomenon is good, on balance
 *   Regret      THR                      a counterfactual world without it
 *   Preference  THP                      a comparison between two defined worlds
 *
 * Deterministic on purpose. Type is visible in the wording, so it needs no
 * model and no approval queue, applies to every stored motion at read time,
 * and can be tested against real motions. Topic ("Economics", "IR") is a
 * semantic question and stays on the tag + classifier flow in lib/tags.
 *
 * Built against the 1,023 motions of the 2026-09 corpus. The stem alone
 * resolved 95 %; the phrasings handled beyond it — actors in brackets, asides
 * between subject and verb, "will"/"welcomes"/"predicts"/"hopes", and the
 * Australs "That, as X, we would …" family — are each pinned by a test built
 * from the real motion that needed it (tests/motions.classify.test.ts).
 * A red-team pass over a wider 1,129-motion export then took coverage there
 * from 98.8 % to 99.8 % (compact stems like THPAW/THC, actor clauses with
 * commas, invisible characters) and pinned "as" idioms and "As the world
 * warms, …" openers as not being actors.
 */

export type MotionClass =
  'Policy' | 'Actor' | 'Belief' | 'Stance' | 'Regret' | 'Preference' | 'Unclassified';

export type MotionClassification = {
  type: MotionClass;
  /** Opens with a setting before the stem ("In countries with …, THW …"). */
  contextLed: boolean;
  /** Released with an info slide — background the debate leans on. */
  infoSlide: boolean;
};

type StemClass = Exclude<MotionClass, 'Actor' | 'Unclassified'>;

const VERB_TYPE: Array<[RegExp, StemClass]> = [
  [/^(?:would|w|will)$/, 'Policy'],
  // "predicts" asks for a judgement about the world, with no mechanism.
  [/^(?:believes?(?: that)?|bt|predicts?(?: that)?)$/, 'Belief'],
  // "welcomes" is "supports" for a development rather than a proposal;
  // "rejects" and "condemns" are "opposes" in a sterner voice.
  [/^(?:supports?|s|opposes?|o|welcomes?|rejects?|condemns?)$/, 'Stance'],
  [/^(?:regrets?|r)$/, 'Regret'],
  // "hopes that X" compares the world where X happens with the one where it
  // does not — a preference between two worlds.
  [/^(?:prefers?|p|hopes?(?: that)?)$/, 'Preference'],
];

const COMPACT_TYPE: Record<string, StemClass> = {
  thw: 'Policy',
  thbt: 'Belief',
  // A transposition common enough in real tabs to be worth reading.
  tbht: 'Belief',
  thb: 'Belief',
  ths: 'Stance',
  tho: 'Stance',
  thc: 'Stance',
  thr: 'Regret',
  thp: 'Preference',
  // "This House prefers a world" — Preference by definition.
  thpaw: 'Preference',
};

const VERB = [
  'believes that',
  'believe that',
  'believes',
  'believe',
  'bt',
  'predicts that',
  'predicts',
  'predict',
  'hopes that',
  'hope that',
  'hopes',
  'hope',
  'would',
  'will',
  'w',
  'supports',
  'support',
  's',
  'opposes',
  'oppose',
  'o',
  'welcomes',
  'welcome',
  'rejects',
  'reject',
  'condemns',
  'condemn',
  'regrets',
  'regret',
  'r',
  'prefers',
  'prefer',
  'p',
].join('|');

/**
 * "as" phrases that are idioms rather than roles: "TH, as a matter of
 * principle, would …", "As a result of the war, THW …", "TH as of 2025
 * would …". Each would otherwise read as an actor clause.
 */
const AS_IDIOM = String.raw`(?:a matter of|a result|soon as|of|long as|well as)\b`;

/**
 * What separates "this house" from its verb. At least one space or a comma:
 * with nothing required, the "s" of "This houses would" read as the verb
 * "supports". Only a closing bracket may abut the verb, TH(…)W.
 */
const SEP = String.raw`(?:\s*,\s*|\s+|(?<=\))\s*)`;

/**
 * "this house" or "th", then at most one of three things before the verb:
 *
 *   (1) a bracketed actor        TH(feminist movement)W …
 *   (2) an "as" actor clause     TH, as the US, W …
 *   (3) an aside                 TH, regardless of relationship status, would …
 *
 * (1) and (2) make the motion an actor motion; (3) does not. An actor can
 * also follow the verb (4), "This House would, as the EU, sanction …".
 *
 * The middle is optional *lazily* (`??`), so the bare stem is tried first
 * and "TH believes the state would …" stays a Belief rather than reading
 * "believes the state" as an aside. The clauses are lazy too, so they stop
 * at the first verb. They may hold commas — "TH, as a heterosexual, highly
 * educated woman, would …" — but not a sentence break, and an aside needn't
 * close with a comma ("TH, in a zombie apocalypse W …").
 */
const LONG_STEM = new RegExp(
  String.raw`(?:^|[\s,(])(?:this houses?|th)` +
    String.raw`(?:(\s*\([^)]*\)\s*)|((?:\s*,\s*|\s+)as\s+(?!${AS_IDIOM})[^.;:]{1,200}?\s*,?)|(\s*,\s*[^.;:]{1,80}?\s*,?|\s+[^.;:,]{1,40}?))??` +
    String.raw`${SEP}(${VERB})(?=[\s,.]|$)`,
);

/**
 * (4) An actor straight after the stem's verb, set off by commas. The comma
 * is what makes it a role: "THW treat addiction as a public health issue"
 * has none. Full stops are allowed inside because the role often carries an
 * "(e.g. …)".
 */
const TRAILING_ACTOR = new RegExp(String.raw`^\s*,\s*as\s+(?!${AS_IDIOM})[^;:]{1,160}?,`);

const COMPACT_STEM =
  /(?:^|[\s,(])(thw|thbt|tbht|ths|tho|thc|thr|thpaw|thp|thb(?= th(?:at|e)\b))(?=[\s,.]|$)/;

/**
 * Words that make a leading "As the …," clause a sentence rather than a
 * noun phrase — "As the world warms", "As the dust settles". A role
 * ("As a young working professional in a stable job") has no finite verb of
 * its own, except inside a relative clause ("As a person who has lost a
 * child"), which is cut off before this is checked. A closed list rather
 * than a suffix rule: "-s" can't tell "the world warms" from "the United
 * States", and "-ed" can't tell "the war ended" from "the accused".
 */
const CLAUSE_VERB = new RegExp(
  String.raw`\b(?:is|are|was|were|has|have|had|be|been|can|could|will|would|may|might|must|should|do|does|did|` +
    String.raw`becomes?|became|grows?|grew|continues?|continued|gets?|got|goes|went|comes?|came|begins?|began|` +
    String.raw`ends|ended|rises|rose|falls|fell|increases|increased|decreases|decreased|declines|declined|` +
    String.raw`changes|changed|emerges|emerged|spreads|warms|warmed|settles|settled|approaches|approached|` +
    String.raw`looms|loomed|unfolds|unfolded|evolves|evolved|develops|developed|shifts|shifted|expands|expanded|` +
    String.raw`intensifies|intensified|deepens|deepened|worsens|worsened|improves|improved|nears|neared|` +
    String.raw`draws|drew|takes|took|gains|gained|loses|lost|enters|entered|moves|moved|turns|turned|` +
    String.raw`remains|remained|seems|seemed|appears|appeared|happens|happened|escalates|escalated|` +
    String.raw`progresses|progressed|advances|advanced)\b`,
);

/** Where a role's head noun phrase ends and its description begins. */
const PHRASE_BREAK =
  /\b(?:who|whom|whose|which|that|of|in|on|at|for|with|from|by|to|under|living|working)\b/;

/**
 * "As a progressive voter, THW …" puts the actor before the stem. Limited to
 * a noun phrase ("as a …", "as the …") because "As AI becomes more powerful,
 * THBT …" opens with context, not an actor — and even then, "As the world
 * warms, THBT …" and "As a result of the war, THW …" are context too.
 */
const LEADING_ACTOR =
  /^as\s+(?!(?:a matter of|a result)\b)((?:a|an|the|this|someone|somebody|one)\s[^.;:]{1,160}?),\s*(?:this house|th(?:w|bt|s|o|r|p|paw|b|c)?)\b/;

function isLeadingActor(t: string): boolean {
  const m = LEADING_ACTOR.exec(t);
  if (!m) return false;
  const head = m[1].split(PHRASE_BREAK)[0];
  return !CLAUSE_VERB.test(head);
}

/**
 * Round labels in front of the motion: choice rounds ("A: That …",
 * "F. THW …"), numbered lists ("1. That …") and "Motion:" / "Motion 2:".
 */
const CHOICE_PREFIX = /^(?:motion(?:\s*\d+)?|[a-z]|\d{1,2})\s*[:.)]\s+/;

/** Straight and curly quotes wrapped around a whole motion. */
const EDGE_QUOTES = /^["'‘’“”]+|["'‘’“”]+$/g;

/** Openings that set a scene rather than state the motion. */
const SCENE = /^(?:where|when|if|in|given|assuming|during|after|within|for)\b[^,]*,\s*/;

/**
 * Australs motions: "That we …" / "That <subject> …", typed by what follows.
 * A scene can come before "That" ("Assuming the technology exists, that …")
 * or inside it ("That, where …, nations should …"), and an actor can sit
 * behind a comma ("That, as the Houthi rebels, we would …").
 */
function classifyThat(t: string): { type: MotionClass; contextLed: boolean } | null {
  let contextLed = false;
  let rest: string;
  if (/^that[\s,]/.test(t)) {
    rest = t.slice(4);
  } else {
    const lead = /^[^,]{3,160},\s*that[\s,]/.exec(t);
    if (!lead) return null;
    contextLed = true;
    rest = t.slice(lead[0].length - 1);
  }
  rest = rest.replace(/^[\s,]+/, '');

  // "as X, we would" — possibly behind a scene, which makes it context-led.
  const actor = /(?:^|,\s*)as\s+[^,]+,\s*we\s+(?:would|will|should)\b/.exec(rest);
  if (actor) return { type: 'Actor', contextLed: contextLed || actor.index > 0 };
  if (/^we\s*,?\s*as\s+[^,]+,?\s*(?:would|will|should)\b/.test(rest)) {
    return { type: 'Actor', contextLed };
  }

  const scene = SCENE.exec(rest);
  if (scene) {
    contextLed = true;
    rest = rest.slice(scene[0].length);
  }

  if (/^we (?:support|oppose|welcome)\b/.test(rest)) return { type: 'Stance', contextLed };
  if (/^we regret\b/.test(rest)) return { type: 'Regret', contextLed };
  if (/^we (?:prefer|hope)\b/.test(rest)) return { type: 'Preference', contextLed };
  if (/^we (?:believe|predict)\b/.test(rest)) return { type: 'Belief', contextLed };
  if (/^we\s/.test(rest)) return { type: 'Policy', contextLed };
  if (/\b(?:should|must|ought to)\b/.test(rest)) return { type: 'Policy', contextLed };
  return { type: 'Belief', contextLed };
}

function verbType(verb: string | undefined): MotionClass {
  if (!verb) return 'Unclassified';
  for (const [pattern, type] of VERB_TYPE) if (pattern.test(verb)) return type;
  return 'Unclassified';
}

export function classifyMotion(text: string, infoSlide?: string | null): MotionClassification {
  const hasInfo = typeof infoSlide === 'string' && infoSlide.trim().length > 0;
  // Format characters (a left-to-right mark pasted in from a document) and
  // quotes around the whole motion sit in front of the stem and hide it.
  // Quotes go before and after the round label: 'A: "THW …"'.
  const t = (text ?? '')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(EDGE_QUOTES, '')
    .trim()
    .replace(CHOICE_PREFIX, '')
    .replace(EDGE_QUOTES, '')
    .trim();

  if (!t) return { type: 'Unclassified', contextLed: false, infoSlide: hasInfo };

  if (isLeadingActor(t)) return { type: 'Actor', contextLed: false, infoSlide: hasInfo };

  // The earliest stem wins, so a motion quoting a second stem later on keeps
  // the type of the one it opens with.
  const long = LONG_STEM.exec(t);
  const compact = COMPACT_STEM.exec(t);
  const candidates = [
    long && {
      index: long.index,
      end: long.index + long[0].length,
      type: long[1] || long[2] ? ('Actor' as const) : verbType(long[4]),
    },
    compact && {
      index: compact.index,
      end: compact.index + compact[0].length,
      type: COMPACT_TYPE[compact[1]],
    },
  ].filter((c): c is { index: number; end: number; type: MotionClass } => !!c && !!c.type);

  if (candidates.length > 0) {
    const first = candidates.sort((a, b) => a.index - b.index)[0];
    const type = TRAILING_ACTOR.test(t.slice(first.end)) ? 'Actor' : first.type;
    // Context-led: the stem sits after an opening clause, whether that ends
    // in a comma ("In 2024, THW …") or is a sentence of its own ("Context:
    // X elected a populist. THW …"). A colon counts only after a clause long
    // enough to be one — "Round 1: THW …" is a label, not a setting.
    const lead = t.slice(0, first.index + 1);
    const contextLed =
      first.index > 0 &&
      (/[,.;]\s*$/.test(lead) || (/:\s*$/.test(lead) && lead.trim().split(' ').length > 5));
    return { type, contextLed, infoSlide: hasInfo };
  }

  const that = classifyThat(t);
  if (that) return { ...that, infoSlide: hasInfo };

  return { type: 'Unclassified', contextLed: false, infoSlide: hasInfo };
}
