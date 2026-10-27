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
 * Qualifiers that make a name a different event, checked ONLY next to the
 * major token ("Pre-Worlds", "Novice EUDC", "Junior Australs", "Mini-Worlds",
 * "SEA Worlds", "Worlds Masters", "Worlds Schools"), never elsewhere in the
 * name: "EUDC 2023 Pre-Elimination" is still EUDC.
 */
const QUALIFIER_BEFORE = /\b(?:pre|novice|junior|mini|sea|schools?|masters?)\s*$/i;
const QUALIFIER_AFTER = /^\s*(?:masters?|schools?|junior|novice|forum)\b/i;

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
        `\\b(?:${hosts.map(escapeRegExp).join('|')})(?:\\s+city,?)?(?:\\s+(?:wudc|worlds?))?\\s+${year}\\b`,
    )
    .join('|'),
  'ig',
);

const MATCHERS = MAJORS.map((major) => ({
  major,
  pattern: new RegExp(`\\b(?:${major.aliases.map(escapeRegExp).join('|')})s?\\b`, 'ig'),
}));

/** For every occurrence of `pattern` in `name`: is a qualifier attached to it? */
function occurrences(name: string, pattern: RegExp): boolean[] {
  return [...name.matchAll(pattern)].map(
    (m) =>
      QUALIFIER_BEFORE.test(name.slice(0, m.index)) ||
      QUALIFIER_AFTER.test(name.slice(m.index + m[0].length)),
  );
}

/** The major a tournament name belongs to, or null. */
export function majorFor(tournamentName: string): Major | null {
  const name = normalize(tournamentName);
  const host = occurrences(name, HOST_PATTERN);
  const found = MATCHERS.map((m) => ({ major: m.major, hits: occurrences(name, m.pattern) }));
  // A qualifier on any major token makes the whole name a different event.
  if (host.some(Boolean) || found.some((f) => f.hits.some(Boolean))) return null;
  if (host.length) return MAJORS[0];
  return found.find((f) => f.hits.length)?.major ?? null;
}

export function isMajor(tournamentName: string): boolean {
  return majorFor(tournamentName) !== null;
}
