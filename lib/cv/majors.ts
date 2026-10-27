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
 * WUDC; "World Schools Debating Championships", "Pre-Worlds" and "Junior
 * Australs" match nothing: see EXCLUDED below). Nothing else
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
      'world university debating championship',
    ],
  },
  {
    id: 'ABP',
    aliases: [
      'abp',
      'asian bp',
      'asian british parliamentary',
      // The historical name of ABP (Asian Universities Debating Championship).
      'audc',
      'asian universities debating championship',
    ],
  },
  {
    id: 'EUDC',
    aliases: ['eudc', 'european universities debating championship'],
  },
  {
    id: 'Australs',
    aliases: ['australs', 'australasian intervarsity debating championship'],
  },
  {
    id: 'UADC',
    aliases: ['uadc', 'united asian debating championship'],
  },
  {
    id: 'PAUDC',
    aliases: ['paudc', 'pan african universities debating championship'],
  },
  {
    id: 'USUDC',
    aliases: [
      'usudc',
      'united states universities debating championship',
      'us universities debating championship',
    ],
  },
  {
    id: 'NAUDC',
    aliases: ['naudc', 'north american universities debating championship'],
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

/**
 * Names that LOOK like a major but are a different event: a qualifier before
 * the major ("Pre-Worlds", "Novice Worlds", "Junior Australs", "Mini-Worlds",
 * "Worlds Masters"), World Schools and the World Debating Forum, and the
 * South East / East Asian championships (not UADC). Checked first.
 */
const EXCLUDED =
  /\b(?:pre|novice|junior|schools?|mini|masters?|forum|(?:south ?east|east) asian)\b/i;

/** Hyphens read as spaces ("Pan-African", "Pre-Worlds"). */
const normalize = (name: string) => name.replace(/-/g, ' ');

/**
 * Sources (accessed 2026-10-27): English Wikipedia, "World Universities
 * Debating Championship" (official name; hosts 2021 South Korea, 2022 Serbia
 * (both online), 2023 Madrid, 2024 Ho Chi Minh City, 2025 Panama City, 2026
 * Sofia), "United Asian Debating Championships" (UADC; formed from the
 * Asian Universities Debating Championship and the All-Asian Intervarsity
 * Debating Championships), "US Universities Debating Championship",
 * "Australasian Intervarsity Debating Championships" ("Australs"). The owner
 * gives Hanoi for 2024 where Wikipedia says Ho Chi Minh City: both are kept.
 * Not NAUDC: the winter "North American Debating Championship" (NorthAms),
 * a separate event. PAUDC and NAUDC pages could not be fetched.
 */

/**
 * WUDC hosts by year. A tab is often named for its host ("Korea WUDC 2021",
 * "Madrid 2023") rather than "Worlds". A host counts only with its own year,
 * written right next to it (optionally with WUDC / Worlds between), so
 * "Madrid Open 2023" or "Korea Open 2021" are not Worlds.
 */
export const WUDC_HOSTS: Readonly<Record<number, readonly string[]>> = {
  2021: ['korea', 'south korea'],
  2022: ['belgrade', 'serbia'],
  2023: ['madrid'],
  2024: ['vietnam', 'hanoi', 'ho chi minh'],
  2025: ['panama'],
  2026: ['sofia'],
};

const HOST_PATTERN = new RegExp(
  Object.entries(WUDC_HOSTS)
    .map(
      ([year, hosts]) =>
        `\\b(?:${hosts.map(escapeRegExp).join('|')})(?:\\s+(?:wudc|worlds?))?\\s+${year}\\b`,
    )
    .join('|'),
  'i',
);

const MATCHERS = MAJORS.map((major) => ({
  major,
  pattern: new RegExp(`\\b(?:${major.aliases.map(escapeRegExp).join('|')})s?\\b`, 'i'),
}));

/** The major a tournament name belongs to, or null. */
export function majorFor(tournamentName: string): Major | null {
  const name = normalize(tournamentName);
  if (EXCLUDED.test(name)) return null;
  if (HOST_PATTERN.test(name)) return MAJORS[0];
  return MATCHERS.find((m) => m.pattern.test(name))?.major ?? null;
}

export function isMajor(tournamentName: string): boolean {
  return majorFor(tournamentName) !== null;
}
