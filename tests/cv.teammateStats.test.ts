import { describe, expect, test } from 'vitest';
import { teammateStats } from '@/lib/cv/teammateStats';
import type { RoundFact, TournamentFact } from '@/lib/cv/statsFacts';

const round = (o: Partial<RoundFact>): RoundFact => ({
  tournamentId: '1',
  year: 2024,
  format: 'British Parliamentary',
  round: 1,
  isOutround: false,
  seat: 'BP:OG',
  partners: ['Ann'],
  partnerGap: 2,
  proAm: 'marked',
  motionType: null,
  hasMotion: true,
  contextLed: false,
  infoSlide: false,
  score: 78,
  partnerScores: [76],
  points: 3,
  won: true,
  ...o,
});
const tournament = (o: Partial<TournamentFact>): TournamentFact => ({
  tournamentId: '1',
  name: 'T1',
  year: 2024,
  format: 'British Parliamentary',
  partners: ['Ann'],
  partnerGap: 2,
  proAm: 'marked',
  broke: true,
  breakRank: 3,
  deepestOutround: null,
  won: null,
  speakerRank: null,
  ...o,
});

const facts = {
  partnerNames: {} as Record<string, string>,
  tournaments: [
    tournament({
      tournamentId: '1',
      partners: ['Ann'],
      partnerGap: 2,
      proAm: 'marked',
      broke: true,
    }),
    tournament({
      tournamentId: '2',
      partners: ['Ann'],
      partnerGap: 0.5,
      proAm: 'unmarked',
      broke: false,
    }),
    tournament({
      tournamentId: '3',
      partners: ['Bob', 'Cy'],
      partnerGap: -2,
      proAm: 'marked',
      broke: true,
    }),
    tournament({
      tournamentId: '4',
      partners: ['Bob'],
      partnerGap: null,
      proAm: null,
      broke: false,
    }),
  ],
  rounds: [
    round({ tournamentId: '1', score: 78, won: true }),
    round({ tournamentId: '1', round: 2, score: 80, won: false }),
    round({ tournamentId: '2', score: 76, won: true, partnerGap: 0.5, proAm: 'unmarked' }),
    round({
      tournamentId: '3',
      score: 74,
      won: false,
      partners: ['Bob', 'Cy'],
      partnerGap: -2,
      proAm: 'marked',
    }),
    round({
      tournamentId: '3',
      round: 9,
      isOutround: true,
      score: null,
      won: true,
      partners: ['Bob', 'Cy'],
    }),
    round({
      tournamentId: '4',
      score: 77,
      won: null,
      partners: ['Bob'],
      partnerGap: null,
      proAm: null,
    }),
  ],
};

describe('teammateStats — per partner', () => {
  const { partners } = teammateStats(facts);

  test('one row per partner, most tournaments first', () => {
    expect(partners.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Cy']);
  });

  test('tournaments, breaks and how many pairings the user marked pro-am', () => {
    expect(partners[0]).toMatchObject({
      tournaments: 2,
      breaks: 1,
      pairings: { marked: 1, unmarked: 1, unlabelled: 0 },
    });
    expect(partners[1]).toMatchObject({
      tournaments: 2,
      breaks: 1,
      pairings: { marked: 1, unmarked: 0, unlabelled: 1 },
    });
  });

  test('your prelim figures with them, and the mean gap over labelled tournaments', () => {
    // Ann: speeches 78, 80, 76 → 78.0; decided 3, won 2; gap mean of 2 and 0.5 → 1.25.
    expect(partners[0]).toMatchObject({ avgScore: 78, decided: 3, wins: 2, meanGap: 1.25 });
    expect(partners[0]!.winRate).toBeCloseTo(2 / 3);
    // Bob: tournament 4 has no gap, so only tournament 3's −2 counts; the outround is not a prelim.
    expect(partners[1]).toMatchObject({ avgScore: 75.5, decided: 1, wins: 0, meanGap: -2 });
  });
});

describe('teammateStats — by pairing', () => {
  const { pairings } = teammateStats(facts);

  test('a summary line per mark that occurs, marked first', () => {
    expect(pairings.map((p) => p.label)).toEqual(['marked', 'unmarked']);
    // Marked: tournaments 1 and 3. Speeches 78, 80 and 74 → 77.33; 3 decided, 1 won.
    expect(pairings[0]).toMatchObject({ tournaments: 2, breaks: 2, decided: 3, wins: 1 });
    expect(pairings[0]!.avgScore).toBeCloseTo(77.33, 1);
    expect(pairings[1]).toMatchObject({
      tournaments: 1,
      breaks: 0,
      avgScore: 76,
      decided: 1,
      wins: 1,
    });
  });
});
