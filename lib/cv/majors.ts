/**
 * The majors: the one editable list of tournaments the CV treats as major
 * championships (owner decision C21, 2026-10-27). It replaces the old regex in
 * buildCvData, which missed the spelled-out names of Worlds, EUDC, Australs
 * and NAUDC, and PAUDC, ABP and "Worlds".
 *
 * TO EDIT: add, remove or reorder entries below. `id` is the short name the
 * CV shows; `aliases` are the spellings that appear in tournament names. A
 * name is a major when any alias appears in it as whole words, ignoring case
 * ("Worlds 2024" and "World Universities Debating Championship" both match
 * WUDC; "World Schools Debating Championships" matches nothing). Nothing else
 * in the code names a specific major.
 */
export type Major = { id: string; aliases: readonly string[] };

export const MAJORS: readonly Major[] = [
  {
    id: 'WUDC',
    aliases: [
      'wudc',
      'worlds',
      'world universities debating championship',
      'world university debating championship',
      'world university debating',
      'world debating',
    ],
  },
  {
    id: 'ABP',
    aliases: ['abp', 'asian bp', 'asian british parliamentary'],
  },
  {
    id: 'EUDC',
    aliases: ['eudc', 'european universities debating championship', 'european debating'],
  },
  {
    id: 'Australs',
    aliases: ['australs', 'australasian intervarsity debating championship'],
  },
  {
    id: 'UADC',
    aliases: ['uadc', 'united asian debating championship', 'asian debating'],
  },
  {
    id: 'PAUDC',
    aliases: ['paudc', 'pan african universities debating championship'],
  },
  {
    id: 'USUDC',
    aliases: ['usudc', 'united states universities debating championship'],
  },
  {
    id: 'NAUDC',
    aliases: [
      'naudc',
      'north american universities debating championship',
      'north american debating',
    ],
  },
];

/**
 * EXTENSION POINT, deliberately empty and unused: the owner plans a
 * "prestigious competitions per region" category (a regional tier below the
 * majors above). When it is built, list the entries here keyed by region (the
 * admin-approved tag in lib/tags/vocabulary.ts, as on CvSpeakerRow.region),
 * using the same `Major` shape, and add the matching/aggregation then. Nothing
 * reads this today.
 */
export const PRESTIGIOUS_BY_REGION: Readonly<Record<string, readonly Major[]>> = {};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MATCHERS = MAJORS.map((major) => ({
  major,
  pattern: new RegExp(`\\b(?:${major.aliases.map(escapeRegExp).join('|')})s?\\b`, 'i'),
}));

/** The major a tournament name belongs to, or null. */
export function majorFor(tournamentName: string): Major | null {
  return MATCHERS.find((m) => m.pattern.test(tournamentName))?.major ?? null;
}

export function isMajor(tournamentName: string): boolean {
  return majorFor(tournamentName) !== null;
}
