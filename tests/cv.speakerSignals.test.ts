import { describe, expect, test } from 'vitest';
import { deepestOutroundLabel, mergeSpeakerCvSignals } from '@/lib/cv/speakerSignals';

describe('speaker CV signal merge', () => {
  test('preserves private-URL outround evidence when the richer speaker-tab row has scores', () => {
    const merged = mergeSpeakerCvSignals([
      { eliminationReached: null, teamBreakRank: null },
      { eliminationReached: 'Quarterfinals', teamBreakRank: null },
    ]);

    expect(merged).toEqual({
      eliminationReached: 'Quarterfinals',
      teamBreakRank: null,
      broke: true,
    });
  });

  test('keeps the deepest spoken outround across claimed aliases', () => {
    expect(deepestOutroundLabel(['Quarterfinals', 'Semifinals', null])).toBe('Semifinals');
  });

  test('keeps the best break rank even without an outround room', () => {
    expect(
      mergeSpeakerCvSignals([
        { eliminationReached: null, teamBreakRank: 12 },
        { eliminationReached: null, teamBreakRank: 5 },
      ]),
    ).toEqual({
      eliminationReached: null,
      teamBreakRank: 5,
      broke: true,
    });
  });
});
