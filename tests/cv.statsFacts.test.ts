import { describe, expect, test } from 'vitest';
import { buildStatsFacts, proAmFor, seatKey, PRO_AM_GAP } from '@/lib/cv/statsFacts';
import { makeSpeakerRow, makeMotion } from './setup/cv-fixtures';

const scores = (...pairs: Array<[number, number | null]>) =>
  pairs.map(([roundNumber, score]) => ({ roundNumber, positionLabel: null, score }));
const rounds = (...rows: Array<[number, string | null, boolean | null, number | null]>) =>
  rows.map(([roundNumber, position, won, points]) => ({ roundNumber, position, won, points }));
const mate = (name: string, total: number | null, rs = scores()) => ({
  key: name,
  name,
  speakerScoreTotal: total,
  roundScores: rs,
});

describe('seatKey', () => {
  test.each([
    ['British Parliamentary', 'Closing Government', 'BP:CG'],
    ['British Parliamentary', 'OO', 'BP:OO'],
    ['Asian Parliamentary', 'Government', 'AP:Gov'],
    ['Asian Parliamentary', 'Opposition', 'AP:Opp'],
    ['Australs', 'Affirmative', 'Aus:Aff'],
    ['Australs', 'Negative', 'Aus:Neg'],
    ['World Schools', 'Proposition', 'WSDC:Prop'],
    // No side vocabulary of its own: one neutral pair for every two-team tab.
    ['Two-team Parliamentary', 'Affirmative', '2v2:Prop'],
  ])('%s + %s → %s', (format, position, expected) => {
    expect(seatKey(format, position)).toBe(expected);
  });

  test('a four-seat position is BP even when the format is unknown', () => {
    expect(seatKey(null, 'Opening Government')).toBe('BP:OG');
  });

  test('no position, no seat', () => {
    expect(seatKey('British Parliamentary', null)).toBeNull();
  });
});

describe('proAmFor', () => {
  test('threshold is 1.5', () => {
    expect(PRO_AM_GAP).toBe(1.5);
  });

  test.each([
    [78, [76], 'pro'],
    [76, [78], 'am'],
    [77, [76], 'peers'],
    [77.5, [76], 'peers'], // exactly 1.5 is peers
    [74.5, [76], 'peers'], // exactly −1.5 is peers
  ])('you %s vs %j → %s', (me, partners, expected) => {
    expect(proAmFor(me, partners).label).toBe(expected);
  });

  test('three a side compares with the mean of both teammates', () => {
    expect(proAmFor(78, [77, 75])).toEqual({ gap: 2, label: 'pro' });
    expect(proAmFor(76.5, [77, 76])).toEqual({ gap: 0, label: 'peers' });
  });

  test('any missing average leaves the pairing unlabelled', () => {
    expect(proAmFor(null, [76])).toEqual({ gap: null, label: null });
    expect(proAmFor(78, [null])).toEqual({ gap: null, label: null });
    expect(proAmFor(78, [])).toEqual({ gap: null, label: null });
  });
});

describe('buildStatsFacts — rounds', () => {
  const ap = makeSpeakerRow({
    tournamentId: 1n,
    tournamentName: 'Pairs Open',
    year: 2023,
    format: 'Asian Parliamentary',
    prelimRoundCount: 3,
    roundScores: scores([1, 78], [2, 79], [3, 80]),
    teammateDetails: [
      mate('Ann', 225, scores([1, 75], [2, 75], [3, 75])),
      mate('Bob', 228, scores([1, 76], [2, 76], [3, 76])),
    ],
    teammates: ['Ann', 'Bob'],
    teamRoundResults: rounds(
      [1, 'Government', true, null],
      [2, 'Opposition', false, null],
      [4, 'Government', true, null],
    ),
  });

  const facts = buildStatsFacts({
    speakerRows: [ap],
    taggedMotions: [
      makeMotion({ tournamentId: 1n, roundNumber: 1, text: 'THW ban zoos' }),
      makeMotion({
        tournamentId: 1n,
        roundNumber: 2,
        text: 'THBT zoos are bad',
        infoSlide: 'Zoos…',
      }),
    ],
  });

  test('one row per round the user debated, prelims and outrounds, in order', () => {
    expect(facts.rounds.map((r) => [r.round, r.isOutround])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, true],
    ]);
  });

  test('joins score, seat, outcome and the round motion', () => {
    expect(facts.rounds[0]).toMatchObject({
      tournamentId: '1',
      year: 2023,
      format: 'Asian Parliamentary',
      seat: 'AP:Gov',
      score: 78,
      partnerScores: [75, 76],
      won: true,
      points: null,
      motionType: 'Policy',
      infoSlide: false,
    });
    expect(facts.rounds[1]).toMatchObject({
      seat: 'AP:Opp',
      won: false,
      motionType: 'Belief',
      infoSlide: true,
    });
  });

  test('a round with a score but no result still appears, with a null outcome', () => {
    expect(facts.rounds[2]).toMatchObject({
      round: 3,
      score: 80,
      won: null,
      seat: null,
      motionType: null,
    });
  });

  test('pairing label and gap come from round-score means at that tournament', () => {
    // You 79.0; teammates 75.0 and 76.0 → mean 75.5; gap +3.5 → pro.
    for (const r of facts.rounds) {
      expect(r.partners).toEqual(['Ann', 'Bob']);
      expect(r.partnerGap).toBeCloseTo(3.5);
      expect(r.proAm).toBe('pro');
    }
  });

  // A tab total cannot be turned into an average without knowing how many
  // rounds that person spoke, and the tab does not say. Dividing by the prelim
  // count put a partner who sat out rounds 25 points below the user on a real
  // WUDC record. So a pairing is only labelled from scored speeches.
  test('without scored speeches for everyone, the pairing is unlabelled — not estimated from totals', () => {
    const f = buildStatsFacts({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 2n,
          format: 'British Parliamentary',
          prelimRoundCount: 9,
          speakerAvgScore: '77.0',
          prelimsSpoken: 9,
          roundScores: scores([1, 77], [2, 77]),
          teammateDetails: [mate('Cat', 468)], // spoke 6 of 9: 78.0 real, 52.0 if divided by 9
          teammates: ['Cat'],
          teamRoundResults: rounds([1, 'OG', true, 3]),
        }),
      ],
      taggedMotions: [],
    });
    expect(f.rounds[0]).toMatchObject({ seat: 'BP:OG', points: 3, proAm: null, partnerGap: null });
  });

  test('a partner who spoke fewer rounds is averaged over the rounds they spoke', () => {
    const f = buildStatsFacts({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 4n,
          format: 'British Parliamentary',
          prelimRoundCount: 3,
          roundScores: scores([1, 78], [2, 78], [3, 78]),
          teammateDetails: [mate('Eve', 150, scores([1, 75], [2, 75]))],
          teammates: ['Eve'],
          teamRoundResults: rounds([1, 'CO', false, 1]),
        }),
      ],
      taggedMotions: [],
    });
    expect(f.rounds[0]).toMatchObject({ partnerGap: 3, proAm: 'pro' });
  });

  test('a choice round takes a motion type only when every motion shares it', () => {
    const row = makeSpeakerRow({
      tournamentId: 3n,
      format: 'Australs',
      prelimRoundCount: 2,
      roundScores: scores([1, 75], [2, 75]),
      teammateDetails: [],
      teammates: [],
      teamRoundResults: rounds([1, 'Affirmative', true, null], [2, 'Negative', true, null]),
    });
    const f = buildStatsFacts({
      speakerRows: [row],
      taggedMotions: [
        makeMotion({ tournamentId: 3n, roundNumber: 1, seq: 0, text: 'A: That we support X' }),
        makeMotion({ tournamentId: 3n, roundNumber: 1, seq: 1, text: 'B: That we oppose Y' }),
        makeMotion({ tournamentId: 3n, roundNumber: 2, seq: 0, text: 'A: That we support X' }),
        makeMotion({ tournamentId: 3n, roundNumber: 2, seq: 1, text: 'B: That we should ban Y' }),
      ],
    });
    expect(f.rounds[0]!.motionType).toBe('Stance');
    expect(f.rounds[1]!.motionType).toBeNull();
  });
});

describe('buildStatsFacts — tournaments', () => {
  test('one row per speaking tournament with partner and break facts', () => {
    const f = buildStatsFacts({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 9n,
          tournamentName: 'Big IV',
          year: 2024,
          format: 'British Parliamentary',
          prelimRoundCount: 5,
          broke: true,
          teamBreakRank: 4,
          eliminationReached: 'Semifinals',
          wonTournament: null,
          speakerRankOpen: 12,
          teammates: ['Dee'],
          teammateDetails: [mate('Dee', 360, scores([1, 72], [2, 72]))],
          speakerAvgScore: '75.0',
          prelimsSpoken: 2,
          roundScores: scores([1, 75], [2, 75]),
          teamRoundResults: [],
        }),
      ],
      taggedMotions: [],
    });
    expect(f.tournaments).toEqual([
      expect.objectContaining({
        tournamentId: '9',
        name: 'Big IV',
        year: 2024,
        format: 'British Parliamentary',
        partners: ['Dee'],
        partnerGap: 3, // 75.0 vs 72.0
        proAm: 'pro',
        broke: true,
        breakRank: 4,
        deepestOutround: 'Semifinals',
        won: null,
        speakerRank: 12,
      }),
    ]);
  });
});

describe('red-team regressions', () => {
  test('the pro-am threshold compares the true gap, not a rounded one', () => {
    expect(proAmFor(76.504, [75]).label).toBe('pro');
    expect(proAmFor(77.5, [76]).label).toBe('peers');
  });

  test('a squad member who never spoke does not unlabel the pairing', () => {
    const f = buildStatsFacts({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 5n,
          format: 'World Schools',
          prelimRoundCount: 2,
          roundScores: scores([1, 78], [2, 78]),
          teammateDetails: [mate('Ann', 150, scores([1, 75], [2, 75])), mate('Reserve', null)],
          teammates: ['Ann', 'Reserve'],
          teamRoundResults: rounds([1, 'Proposition', true, null]),
        }),
      ],
      taggedMotions: [],
    });
    expect(f.tournaments[0]).toMatchObject({ partnerGap: 3, proAm: 'pro' });
  });

  test('info-slide and framing flags do not depend on the round having one motion type', () => {
    const f = buildStatsFacts({
      speakerRows: [
        makeSpeakerRow({
          tournamentId: 6n,
          format: 'British Parliamentary',
          prelimRoundCount: 2,
          roundScores: scores([1, 75], [2, 75]),
          teammateDetails: [],
          teammates: [],
          teamRoundResults: rounds([1, 'OG', true, 3], [2, 'OO', false, 0]),
        }),
      ],
      taggedMotions: [
        makeMotion({ tournamentId: 6n, roundNumber: 1, seq: 0, text: 'THW ban X', infoSlide: 'x' }),
        makeMotion({
          tournamentId: 6n,
          roundNumber: 1,
          seq: 1,
          text: 'THBT Y is bad',
          infoSlide: 'y',
        }),
      ],
    });
    expect(f.rounds[0]).toMatchObject({ motionType: null, hasMotion: true, infoSlide: true });
    expect(f.rounds[1]).toMatchObject({ hasMotion: false, infoSlide: false });
  });

  test('two-team sides share one key whatever the tab calls them', () => {
    expect(seatKey('Two-team Parliamentary', 'Government')).toBe(
      seatKey('Two-team Parliamentary', 'Proposition'),
    );
    expect(seatKey(null, 'Government')).toBe(seatKey(null, 'Proposition'));
    expect(seatKey('British Parliamentary', 'Side A')).toBe(
      seatKey('British Parliamentary', 'side a'),
    );
  });

  test('partners are keyed by person, so two people with one display name stay apart', () => {
    const row = (id: bigint, key: string) =>
      makeSpeakerRow({
        tournamentId: id,
        format: 'British Parliamentary',
        prelimRoundCount: 1,
        roundScores: scores([1, 75]),
        teammateDetails: [{ ...mate('[name withdrawn]', 75, scores([1, 75])), key }],
        teammates: ['[name withdrawn]'],
        teamRoundResults: rounds([1, 'OG', true, 3]),
      });
    const f = buildStatsFacts({ speakerRows: [row(7n, 'p1'), row(8n, 'p2')], taggedMotions: [] });
    expect(f.tournaments.map((t) => t.partners)).toEqual([['p1'], ['p2']]);
    expect(f.partnerNames).toEqual({ p1: '[name withdrawn]', p2: '[name withdrawn]' });
  });
});
