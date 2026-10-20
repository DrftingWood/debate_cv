import { describe, expect, test } from 'vitest';
import {
  detectFormatFromTeamSize,
  formatAbbrev,
  inferFormatFromStructure,
  inferTournamentFormat,
} from '@/lib/calicotab/format';

describe('detectFormatFromTeamSize', () => {
  test('2 → British Parliamentary', () => {
    expect(detectFormatFromTeamSize(2)).toBe('British Parliamentary');
  });

  test('3 → Asian Parliamentary', () => {
    expect(detectFormatFromTeamSize(3)).toBe('Asian Parliamentary');
  });

  test.each([0, 1, 4, 5, 12])('%d → unknown', (n) => {
    expect(detectFormatFromTeamSize(n)).toBe('unknown');
  });

  test.each([NaN, Infinity, -Infinity, -1, -2])('malformed input %s → unknown', (n) => {
    expect(detectFormatFromTeamSize(n)).toBe('unknown');
  });

  test('non-integers like 2.5 → unknown', () => {
    expect(detectFormatFromTeamSize(2.5)).toBe('unknown');
  });

  test('non-numbers via type-coercion bypass → unknown', () => {
    expect(detectFormatFromTeamSize('2' as unknown as number)).toBe('unknown');
    expect(detectFormatFromTeamSize(null as unknown as number)).toBe('unknown');
    expect(detectFormatFromTeamSize(undefined as unknown as number)).toBe('unknown');
  });
});

describe('formatAbbrev', () => {
  test('abbreviates the formats the ingest pipeline actually stores', () => {
    expect(formatAbbrev('British Parliamentary')).toBe('BP');
    expect(formatAbbrev('Asian Parliamentary')).toBe('AP');
    expect(formatAbbrev('World Schools')).toBe('WSDC');
    expect(formatAbbrev('Lincoln-Douglas')).toBe('LD');
    expect(formatAbbrev('Public Forum')).toBe('PF');
  });

  test('abbreviates the formats room shape can now produce', () => {
    expect(formatAbbrev('Australs')).toBe('Aus');
    expect(formatAbbrev('Two-team Parliamentary')).toBe('2v2');
  });

  test('is case- and whitespace-insensitive', () => {
    expect(formatAbbrev('  british parliamentary ')).toBe('BP');
  });

  test('passes an unrecognised format through rather than truncating it', () => {
    expect(formatAbbrev('Mace')).toBe('Mace');
  });

  test('absent or blank formats yield null so callers can render a Nil', () => {
    expect(formatAbbrev(null)).toBeNull();
    expect(formatAbbrev(undefined)).toBeNull();
    expect(formatAbbrev('   ')).toBeNull();
  });
});

// Room shapes and squad sizes taken from real tournaments in the 2026-09
// corpus. The side vocabulary is what each tab's results pages actually print.
const BP_ROOM = ['Opening Government', 'Opening Opposition', 'Closing Government', 'Closing Opposition'];

describe('inferFormatFromStructure', () => {
  test('four seats a room is British Parliamentary (WUDC 2024)', () => {
    expect(inferFormatFromStructure({ positions: BP_ROOM, squadSize: 2 })).toBe('British Parliamentary');
  });

  test('Government/Opposition with three a side is Asian Parliamentary (UADC 2021)', () => {
    expect(
      inferFormatFromStructure({ positions: ['Government', 'Opposition'], squadSize: 3 }),
    ).toBe('Asian Parliamentary');
  });

  test('Affirmative/Negative with three a side is Australs, not Asian Parliamentary (Australs 2022)', () => {
    expect(
      inferFormatFromStructure({
        positions: ['Affirmative', 'Negative'],
        squadSize: 3,
        tournamentName: 'Australs 2022',
      }),
    ).toBe('Australs');
  });

  // Tabbycat names the sides Affirmative/Negative unless the tab director
  // changes them, so the vocabulary alone is weak evidence of anything.
  test('Affirmative/Negative without an Australs-circuit name is not guessed', () => {
    expect(
      inferFormatFromStructure({ positions: ['Affirmative', 'Negative'], squadSize: 3 }),
    ).toBeNull();
  });

  test('Proposition/Opposition is World Schools (reddot2022)', () => {
    expect(
      inferFormatFromStructure({ positions: ['Proposition', 'Opposition'], squadSize: 4 }),
    ).toBe('World Schools');
  });

  // Proposition/Opposition is also NPDA's and Brazilian Parliamentary's
  // vocabulary, both two a side (Wikipedia, "Parliamentary debate").
  test('Proposition/Opposition with two a side is not World Schools', () => {
    expect(
      inferFormatFromStructure({ positions: ['Proposition', 'Opposition'], squadSize: 2 }),
    ).toBe('Two-team Parliamentary');
  });

  test('a World Schools squad of five still reads as World Schools (Oldham Pacific & Atlantic)', () => {
    expect(
      inferFormatFromStructure({ positions: ['Proposition', 'Opposition'], squadSize: 5 }),
    ).toBe('World Schools');
  });

  // Wikipedia ("Australia–Asia debating"): a fourth team member acting as an
  // adviser is commonplace at Australs, so a squad of four is not a signal
  // for World Schools on its own.
  test('an Australs squad with a fourth member stays Australs', () => {
    expect(
      inferFormatFromStructure({
        positions: ['Affirmative', 'Negative'],
        squadSize: 4,
        tournamentName: 'Australs 2019',
      }),
    ).toBe('Australs');
  });

  test('two-team with two a side is not British Parliamentary (Norams 2023)', () => {
    expect(
      inferFormatFromStructure({ positions: ['Affirmative', 'Negative'], squadSize: 2 }),
    ).toBe('Two-team Parliamentary');
  });

  test('two-team sides with an unknown squad size are not guessed', () => {
    expect(inferFormatFromStructure({ positions: ['Government', 'Opposition'], squadSize: null })).toBeNull();
    expect(inferFormatFromStructure({ positions: ['Affirmative', 'Negative'], squadSize: null })).toBeNull();
    expect(inferFormatFromStructure({ positions: ['Proposition', 'Opposition'], squadSize: null })).toBeNull();
  });

  test('abbreviated seat names are read too', () => {
    expect(inferFormatFromStructure({ positions: ['OG', 'OO', 'CG', 'CO'], squadSize: null })).toBe(
      'British Parliamentary',
    );
  });

  test('no readable positions yields null so callers fall back to other signals', () => {
    expect(inferFormatFromStructure({ positions: [], squadSize: 2 })).toBeNull();
    expect(inferFormatFromStructure({ positions: [null, '  '], squadSize: 3 })).toBeNull();
  });
});

describe('inferTournamentFormat', () => {
  const room = (...positions: string[]) => ({ teamResults: positions.map((position) => ({ position })) });
  const teams = (size: number, n = 6) =>
    Array.from({ length: n }, (_, i) => ({ speakers: Array.from({ length: size }, (_, j) => `T${i} S${j}`) }));
  const none = { teamRows: [], speakerRows: [], participantRows: [], registrationSpeakers: [], rounds: [] };

  // ── Behaviour that must survive the change ──────────────────────────────
  test('an explicit format in the name is honoured when no rooms were read', () => {
    expect(inferTournamentFormat({ ...none, tournamentName: 'ILNU BP 2023' })).toBe('British Parliamentary');
    expect(inferTournamentFormat({ ...none, tournamentName: 'Penn WSDC 2025' })).toBe('World Schools');
  });

  test('a well-known BP championship is BP by name when no rooms were read', () => {
    expect(inferTournamentFormat({ ...none, tournamentName: 'WUDC 2024' })).toBe('British Parliamentary');
  });

  test('team size is still the last resort when no rooms were read', () => {
    expect(
      inferTournamentFormat({ ...none, tournamentName: 'Some IV', registrationSpeakers: ['A', 'B', 'C'] }),
    ).toBe('Asian Parliamentary');
    expect(inferTournamentFormat({ ...none, tournamentName: 'Some IV', teamRows: teams(2) })).toBe(
      'British Parliamentary',
    );
  });

  test('nothing to go on yields null', () => {
    expect(inferTournamentFormat({ ...none, tournamentName: 'Some IV' })).toBeNull();
  });

  // ── What room shape changes ─────────────────────────────────────────────
  test('Australs is no longer read as Asian Parliamentary (Australs 2022)', () => {
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Australs 2022',
        teamRows: teams(3),
        registrationSpeakers: ['A', 'B', 'C'],
        rounds: [room('Affirmative', 'Negative'), room('Affirmative', 'Negative')],
      }),
    ).toBe('Australs');
  });

  test('a two-team, two-a-side tournament is no longer read as BP (Norams 2023)', () => {
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Norams 2023',
        teamRows: teams(2),
        rounds: [room('Affirmative', 'Negative')],
      }),
    ).toBe('Two-team Parliamentary');
  });

  test('World Schools squads are read from speaker-tab groups when the team tab is empty (Online DSDC 2021)', () => {
    const speakerRows = Array.from({ length: 12 }, (_, i) => ({ teamName: `Team ${Math.floor(i / 3)}`, roundScores: [] }));
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Online DSDC 2021',
        speakerRows,
        rounds: [room('Proposition', 'Opposition')],
      }),
    ).toBe('World Schools');
  });

  test('squads are read from the participants page when neither tab is public (UPenn Worlds 2021)', () => {
    // Real squad sizes at that tournament: 16 teams of 3, 18 of 4, 25 of 5.
    const sizes = [...Array(16).fill(3), ...Array(18).fill(4), ...Array(25).fill(5)];
    const participantRows = sizes.flatMap((n, t) =>
      Array.from({ length: n }, () => ({ role: 'speaker' as const, teamName: `Team ${t}` })),
    );
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'UPenn Worlds 2021',
        participantRows,
        rounds: [room('Proposition', 'Opposition')],
      }),
    ).toBe('World Schools');
  });

  test('adjudicators on the participants page do not count towards a squad', () => {
    const participantRows = Array.from({ length: 9 }, (_, i) => ({ role: 'adjudicator' as const, teamName: `Team ${i % 3}` }));
    expect(
      inferTournamentFormat({ ...none, tournamentName: 'Some IV', participantRows, rounds: [room('Proposition', 'Opposition')] }),
    ).toBeNull();
  });

  test('a specific format in the name beats the generic two-team reading', () => {
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'State Public Forum Open',
        teamRows: teams(2),
        rounds: [room('Affirmative', 'Negative')],
      }),
    ).toBe('Public Forum');
  });

  // ── Red-team findings, 2026-09 ──────────────────────────────────────────
  test('an explicit format in the name beats the two-team side-name family', () => {
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Penn WSDC 2025',
        teamRows: teams(3),
        rounds: [room('Government', 'Opposition')],
      }),
    ).toBe('World Schools');
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Asian Parliamentary Open',
        teamRows: teams(3),
        rounds: [room('Proposition', 'Opposition')],
      }),
    ).toBe('Asian Parliamentary');
  });

  test('the BP four-seat shape still outranks a name', () => {
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Penn WSDC 2025',
        teamRows: teams(2),
        rounds: [room(...BP_ROOM)],
      }),
    ).toBe('British Parliamentary');
  });

  // Affirmative/Negative is Tabbycat's default side naming, so plenty of
  // Asian Parliamentary tabs print it without anyone choosing it.
  test('Affirmative/Negative alone is not Australs', () => {
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: '2nd Aristotle Cup',
        teamRows: teams(3),
        rounds: [room('Affirmative', 'Negative')],
      }),
    ).toBe('Asian Parliamentary');
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'UADC 2023',
        teamRows: teams(3),
        rounds: [room('Affirmative', 'Negative')],
      }),
    ).toBe('Asian Parliamentary');
  });

  test('Affirmative/Negative with an Australs-circuit name is Australs', () => {
    for (const tournamentName of ['Monash Open 2024', 'Australian Easters 2023']) {
      expect(
        inferTournamentFormat({
          ...none,
          tournamentName,
          teamRows: teams(3),
          rounds: [room('Affirmative', 'Negative')],
        }),
      ).toBe('Australs');
    }
  });

  test.each([
    ['World Schools Debating Championship', 'World Schools'],
    ['Nepal Australs 2021', 'Australs'],
    ['APWSDC 2025', 'World Schools'],
    ['MalaysiaBP 2024', 'British Parliamentary'],
    ['HBP 2023', 'British Parliamentary'],
    ['SRBP 2022', 'British Parliamentary'],
    ['Pearl BPD 2024', 'British Parliamentary'],
    ['Diliman Schools AP', 'Asian Parliamentary'],
    ['UADC 2021', 'Asian Parliamentary'],
    ['Philippine Asians 2019', 'Asian Parliamentary'],
  ])('name keyword with no rooms read: %s → %s', (tournamentName, expected) => {
    expect(inferTournamentFormat({ ...none, tournamentName })).toBe(expected);
  });

  test.each(['Subpoena Cup', 'Webpage Open', 'Apex Invitational', 'Asianet Cup'])(
    'ordinary words are not format keywords: %s',
    (tournamentName) => {
      expect(inferTournamentFormat({ ...none, tournamentName })).toBeNull();
    },
  );

  test('two-team rooms with unrecognised side names are not BP at two a side', () => {
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Some IV',
        teamRows: teams(2),
        rounds: [room('Pro', 'Con'), room('Appellant', 'Respondent')],
      }),
    ).toBe('Two-team Parliamentary');
  });

  test('reserves do not inflate the squad size', () => {
    const teamRows = [...teams(2, 3), ...teams(3, 3)];
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Some IV',
        teamRows,
        rounds: [room('Government', 'Opposition')],
      }),
    ).toBe('Two-team Parliamentary');
  });

  test('squad size comes from the same source for room shape and the team-size rule', () => {
    // A two-a-side tab whose user registered a third member: the tab's median
    // must decide, not the one registration block.
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Some IV',
        teamRows: teams(2),
        registrationSpeakers: ['A', 'B', 'C'],
      }),
    ).toBe('British Parliamentary');
  });

  test('a single stray BP seat does not make two-team rooms BP', () => {
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Some IV',
        teamRows: teams(3),
        rounds: [room('Government', 'Opposition'), room('Government', 'Opposition'), room('OG', 'Opposition')],
      }),
    ).toBe('Asian Parliamentary');
  });

  test('BP rooms win over a three-person registration block', () => {
    expect(
      inferTournamentFormat({
        ...none,
        tournamentName: 'Some IV',
        registrationSpeakers: ['A', 'B', 'C'],
        rounds: [room('Opening Government', 'Opening Opposition', 'Closing Government', 'Closing Opposition')],
      }),
    ).toBe('British Parliamentary');
  });
});
