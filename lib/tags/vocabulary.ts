/**
 * Fixed vocabularies for the moderated tag system (tournament region,
 * motion type, motion topic). Tags are community facts shared across
 * every user whose CV includes the tournament, so values are constrained
 * to these lists rather than free text — free text would fragment the
 * analytics slices ("IR" vs "Intl Relations" vs "international
 * relations") and turn admin review into copy-editing.
 *
 * Two independent dimensions per motion, per the product decision:
 *   - type:  the motion stem — THBT / THW / THO / THP / ... Mechanical,
 *            usually inferable from the text (see inferMotionType).
 *   - topic: the subject area — Economics, International Relations, ...
 *            A judgement call, always proposed by a human.
 *
 * Adding a value to a list here is the whole job: the propose API
 * validates against these arrays and the pickers render from them.
 * Renaming/removing a value needs a data migration for already-approved
 * rows — treat the lists as append-mostly.
 */

export const REGIONS = [
  'Africa',
  'Central Asia',
  'East Asia',
  'Europe',
  'Latin America & Caribbean',
  'Middle East & North Africa',
  'North America',
  'Oceania',
  'South Asia',
  'Southeast Asia',
  'International / Online',
] as const;
export type Region = (typeof REGIONS)[number];

export const MOTION_TYPES = ['THBT', 'THW', 'THS', 'THO', 'THR', 'THP', 'Other'] as const;
export type MotionType = (typeof MOTION_TYPES)[number];

/** Human-readable expansions for the picker UI. */
export const MOTION_TYPE_LABELS: Record<MotionType, string> = {
  THBT: 'This House Believes That',
  THW: 'This House Would',
  THS: 'This House Supports',
  THO: 'This House Opposes',
  THR: 'This House Regrets',
  THP: 'This House Prefers',
  Other: 'Other stem',
};

export const MOTION_TOPICS = [
  'Economics & Business',
  'International Relations',
  'Politics & Governance',
  'Law & Criminal Justice',
  'Ethics & Philosophy',
  'Social Movements & Minority Rights',
  'Gender & Feminism',
  'Religion & Culture',
  'Environment & Climate',
  'Science & Technology',
  'Media & Arts',
  'Education',
  'Health & Sport',
  'Conflict & Security',
] as const;
export type MotionTopic = (typeof MOTION_TOPICS)[number];

export type TagKind = 'region' | 'motion_type' | 'motion_topic';

/** The legal values for each tag kind — single lookup for API validation. */
export const TAG_VALUES: Record<TagKind, readonly string[]> = {
  region: REGIONS,
  motion_type: MOTION_TYPES,
  motion_topic: MOTION_TOPICS,
};

// Stem detection patterns, longest/most-specific first. Tab pages publish
// motions either spelled out ("This House would ban ...") or abbreviated
// ("THW ban ..."); both forms appear in the wild, sometimes prefixed by an
// info-slide marker. "believes that" must be checked before the bare
// "believes" form, and "TH" alone is deliberately NOT matched — it's too
// ambiguous to auto-suggest.
const STEM_PATTERNS: Array<[RegExp, MotionType]> = [
  [/^this house believes(\s+that)?\b/i, 'THBT'],
  [/^thbt?\.?\s/i, 'THBT'],
  [/^this house would\b/i, 'THW'],
  [/^thw\.?\s/i, 'THW'],
  [/^this house supports\b/i, 'THS'],
  [/^ths\.?\s/i, 'THS'],
  [/^this house opposes\b/i, 'THO'],
  [/^tho\.?\s/i, 'THO'],
  [/^this house regrets\b/i, 'THR'],
  [/^thr\.?\s/i, 'THR'],
  [/^this house prefers\b/i, 'THP'],
  [/^thp\.?\s/i, 'THP'],
];

/**
 * Auto-suggest a motion type from the motion text. Returns 'Other' for
 * recognizably-a-motion-but-unusual stems ("This House, as X, would ...")
 * and null when the text doesn't look like a This-House motion at all —
 * the picker leaves the field blank in that case rather than guessing.
 */
export function inferMotionType(text: string): MotionType | null {
  const trimmed = text.trim();
  for (const [pattern, type] of STEM_PATTERNS) {
    if (pattern.test(trimmed)) return type;
  }
  if (/^(this house|th\b)/i.test(trimmed)) return 'Other';
  return null;
}
