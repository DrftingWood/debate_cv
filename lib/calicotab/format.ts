/**
 * Debate format derived from a team's speaker count alone.
 *
 * British Parliamentary teams seat 2 speakers; Asian Parliamentary (and
 * World Schools) teams seat 3. Other counts are returned as 'unknown'
 * rather than guessed. This is only the last-resort vocabulary: the stored
 * `Tournament.format` comes from `inferTournamentFormat` below, which layers
 * room shape and name keywords on top and can also produce World Schools,
 * Australs, Two-team Parliamentary, Policy, Lincoln-Douglas and Public Forum.
 */
export type DebateFormat =
  | 'British Parliamentary'
  | 'Asian Parliamentary'
  | 'unknown';

/**
 * Short display code for a stored `Tournament.format` string.
 *
 * The ledger prints the format on every row, and "British Parliamentary"
 * is 22 characters for a value that repeats down the whole column and is
 * the same for most debaters' entire record. Spelled out it was the third
 * widest column on the table and pushed the ledger past the viewport at
 * 1440px; as "BP" it costs a fifth of that. Callers must put the full
 * string in a `title` so the abbreviation stays hoverable — an unfamiliar
 * code with no way to expand it is worse than a wide column.
 *
 * Formats come from `inferTournamentFormat` below, so the table covers every
 * string it can return. Anything unrecognised passes through unchanged
 * rather than being truncated — a novel format should read oddly, not
 * wrongly.
 */
const FORMAT_ABBREV: Record<string, string> = {
  'british parliamentary': 'BP',
  'asian parliamentary': 'AP',
  'world schools': 'WSDC',
  australs: 'Aus',
  'two-team parliamentary': '2v2',
  'lincoln-douglas': 'LD',
  'public forum': 'PF',
  policy: 'Policy',
};

export function formatAbbrev(format: string | null | undefined): string | null {
  if (!format) return null;
  const trimmed = format.trim();
  if (!trimmed) return null;
  return FORMAT_ABBREV[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Map a team's member count to a debate format.
 *
 *   2  → "British Parliamentary"
 *   3  → "Asian Parliamentary"
 *   anything else (incl. NaN, negative, non-integer) → "unknown"
 *
 * Pure / side-effect free / safe to call with arbitrary input.
 */
export function detectFormatFromTeamSize(teamMemberCount: number): DebateFormat {
  if (typeof teamMemberCount !== 'number') return 'unknown';
  if (!Number.isFinite(teamMemberCount)) return 'unknown';
  if (!Number.isInteger(teamMemberCount)) return 'unknown';
  if (teamMemberCount < 0) return 'unknown';
  if (teamMemberCount === 2) return 'British Parliamentary';
  if (teamMemberCount === 3) return 'Asian Parliamentary';
  return 'unknown';
}

const BP_SEAT = /^(?:(?:opening|closing) (?:government|opposition)|og|oo|cg|co)$/;

/**
 * Tournament names that place an Affirmative/Negative tab on the Australs
 * circuit. Affirmative/Negative is Tabbycat's default side naming — a tab
 * director who never touches the setting gets it — so on its own it says
 * nothing about format; plenty of Asian Parliamentary IVs print it. The
 * vocabulary only means Australs alongside a name from that circuit.
 */
const AUSTRALS_HINT = /austral|\beasters\b|\bmonash\b/;

/**
 * Two-team side vocabularies, and the format each names when a side seats
 * three or more. The side names decide the family, squad size confirms it:
 *
 *   Government / Opposition   → Asian Parliamentary (UADC's "Asian 3-on-3")
 *   Affirmative / Negative    → Australs, but only with an AUSTRALS_HINT name
 *   Proposition / Opposition  → World Schools (WSDC)
 *
 * Every one of those vocabularies is also used by a two-a-side format —
 * APDA, NPDA, Canadian and Brazilian Parliamentary among them — which a tab
 * page cannot tell apart, so two a side is reported as the structure it is.
 * Squad size is a floor, not an exact match: WSDC squads register up to five
 * and a fourth "adviser" is commonplace at Australs (Wikipedia, "Australia–
 * Asia debating"), so four or five members never overrides the side names.
 */
const TWO_TEAM_SIDES: Array<[RegExp, string]> = [
  [/^(?:government|gov)$/, 'Asian Parliamentary'],
  [/^(?:affirmative|aff|negative|neg)$/, 'Australs'],
  [/^(?:proposition|prop)$/, 'World Schools'],
];

const readSeats = (positions: Array<string | null | undefined>): string[] =>
  positions.map((p) => (p ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean);

/**
 * Four-team rooms. A majority of seats, not any one: a single stray "OG" in
 * a two-team tab (a mistyped side, a one-off exhibition round) would
 * otherwise turn a whole Asian Parliamentary tournament into BP.
 */
const isBpShape = (seats: string[]): boolean =>
  seats.length > 0 && seats.filter((s) => BP_SEAT.test(s)).length * 2 > seats.length;

/**
 * Debate format from the shape of the tournament's rooms, which the results
 * pages state outright, rather than from team size alone.
 *
 * Team size cannot do this job by itself. Two a side is both four-team BP
 * and every two-team North American format, and three a side is Asian
 * Parliamentary, Australs and World Schools alike. What separates them is
 * how many teams share a room (BP seats four: Opening/Closing Government and
 * Opposition) and what the two sides of a two-team room are called.
 *
 * Two-team rooms whose sides aren't a recognised vocabulary (Pro/Con,
 * Appellant/Respondent) still rule BP out, so at two a side they read as
 * Two-team Parliamentary. At three they name no format, and neither does
 * Affirmative/Negative without an Australs-circuit name.
 *
 * Returns null when the rooms can't be read or the squad size needed to
 * confirm a two-team format is missing — callers fall back to other signals
 * rather than receive a guess.
 */
export function inferFormatFromStructure({
  positions,
  squadSize,
  tournamentName = '',
}: {
  positions: Array<string | null | undefined>;
  squadSize: number | null;
  tournamentName?: string;
}): string | null {
  const seats = readSeats(positions);
  if (seats.length === 0) return null;

  if (isBpShape(seats)) return 'British Parliamentary';

  let family: string | null = null;
  for (const [pattern, format] of TWO_TEAM_SIDES) {
    if (seats.some((s) => pattern.test(s))) {
      family = format;
      break;
    }
  }
  if (family === 'Australs' && !AUSTRALS_HINT.test(tournamentName.toLowerCase())) family = null;

  if (squadSize == null || !Number.isFinite(squadSize) || squadSize < 2) return null;
  if (squadSize === 2) return 'Two-team Parliamentary';
  return family;
}

/**
 * The lower of the two middle values. Teams that register a reserve pull
 * the upper middle up a size — [2, 2, 3, 3] has an upper median of 3 — and
 * a squad only ever reads larger than the number who actually speak.
 */
const lowerMedian = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
};

/**
 * Formats a tournament name states outright. Each abbreviation is anchored
 * so it can't fire inside an ordinary word: "bp" may end a word ("HBP",
 * "MalaysiaBP", "Pearl BPD") because no English word ends in it, while "ap"
 * and "asians" must stand alone ("Apex", "Asianet").
 */
const NAME_FORMATS: Array<[RegExp, string]> = [
  [/british parliamentary|bpd?(?![a-z])/, 'British Parliamentary'],
  [/asian parliamentary|\bap\b|\buadc\b|\basians\b/, 'Asian Parliamentary'],
  [/world'?s? schools|wsdc\b/, 'World Schools'],
  [/\baustrals\b/, 'Australs'],
  [/lincoln[-\s]?douglas|\bld\b/, 'Lincoln-Douglas'],
  [/public forum|\bpf\b/, 'Public Forum'],
];

/**
 * A tournament's format, from every signal a scrape yields, strongest first:
 *
 *   1. BP room shape — four teams a room is unmistakable.
 *   2. An explicit format in the tournament name — organisers rarely lie.
 *   3. Two-team room shape (inferFormatFromStructure): side names plus squad.
 *   4. Well-known BP championships by name.
 *   5. Team size alone, the old primary rule: 2 → BP, 3 → Asian Parliamentary.
 *
 * Structure displaced team size because team size was wrong for whole
 * circuits: every Australs-format tournament came out Asian Parliamentary,
 * and two-team two-a-side events (NorAms) came out British Parliamentary.
 * But only the four-seat shape outranks the name. Side names are a family
 * guess — "Penn WSDC" can run Government/Opposition rooms, an Asian
 * Parliamentary open can call its sides Proposition — and the organiser
 * naming the format knows better than the tab's side labels.
 */
export function inferTournamentFormat({
  tournamentName,
  teamRows,
  speakerRows,
  participantRows = [],
  registrationSpeakers,
  rounds,
}: {
  tournamentName: string;
  teamRows: { speakers: string[] }[];
  speakerRows: { teamName: string | null }[];
  participantRows?: { role: string; teamName: string | null }[];
  registrationSpeakers: string[];
  rounds: { teamResults: { position: string | null }[] }[];
}): string | null {
  const name = tournamentName.toLowerCase();

  // Squad size, most representative source first: a median over the whole
  // team tab, then over speaker-tab groupings, then over the participants
  // page (which some tournaments publish while hiding both tabs), then the
  // user's own team. One figure serves both room shape and the team-size
  // rule: the registration block is a single team, the one most likely to
  // carry a reserve, so it must not outvote the tab in one step and not the
  // other.
  const teamTabCounts = teamRows.map((r) => r.speakers.length).filter((n) => n > 0);
  const groupSizes = new Map<string, number>();
  for (const sp of speakerRows) {
    if (!sp.teamName) continue;
    groupSizes.set(sp.teamName, (groupSizes.get(sp.teamName) ?? 0) + 1);
  }
  const squadSizes = new Map<string, number>();
  for (const p of participantRows) {
    if (p.role !== 'speaker' || !p.teamName) continue;
    squadSizes.set(p.teamName, (squadSizes.get(p.teamName) ?? 0) + 1);
  }
  const medianOf = (counts: number[]) => (counts.length >= 3 ? lowerMedian(counts) : null);
  const squadSize =
    medianOf(teamTabCounts) ??
    medianOf([...groupSizes.values()]) ??
    medianOf([...squadSizes.values()]) ??
    (registrationSpeakers.length > 0 ? registrationSpeakers.length : null);

  const positions = rounds.flatMap((r) => r.teamResults.map((t) => t.position));

  // (1)
  if (isBpShape(readSeats(positions))) return 'British Parliamentary';

  // (2)
  for (const [pattern, format] of NAME_FORMATS) if (pattern.test(name)) return format;
  if (/\bpolicy\b/.test(name) && !/public\s*policy/.test(name)) return 'Policy';

  // (3) Rooms that were read but aren't BP have already ruled out 2 → BP:
  // at two a side this answers Two-team Parliamentary before (5) is reached.
  const structural = inferFormatFromStructure({ positions, squadSize, tournamentName });
  if (structural) return structural;

  // (4)
  if (/\bwudc\b|\beudc\b|\baudc\b|\bnaudc\b|\babp\b|\bbpp\b/.test(name)) {
    return 'British Parliamentary';
  }

  // (5)
  if (squadSize != null) {
    const detected = detectFormatFromTeamSize(squadSize);
    if (detected !== 'unknown') return detected;
  }

  return null;
}
