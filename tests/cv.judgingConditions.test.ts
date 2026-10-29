/**
 * Statistics' new sections (redesign owner decision 19, part 2): judging by
 * format and by motion topic (lib/cv/judgingConditions.ts) and the Top-10
 * finishes list (lib/cv/topSpeakerFinishes.ts).
 */
import { describe, expect, it } from 'vitest';
import { judgingByFormat, judgingByTopic } from '@/lib/cv/judgingConditions';
import { topSpeakerFinishes } from '@/lib/cv/topSpeakerFinishes';
import { makeJudgeRow, makeSpeakerRow } from './setup/cv-fixtures';

describe('judgingByFormat', () => {
  it('counts tournaments and breaks per format, with a chair rate from measured rows only', () => {
    const out = judgingByFormat([
      makeJudgeRow({
        format: 'British Parliamentary',
        broke: true,
        inroundsJudged: 6,
        inroundsChaired: 3,
      }),
      makeJudgeRow({ format: 'British Parliamentary', inroundsJudged: 4, inroundsChaired: 1 }),
      // More chairs than rounds judged: inconsistent, so it adds no rounds.
      makeJudgeRow({ format: 'British Parliamentary', inroundsJudged: 2, inroundsChaired: 5 }),
      makeJudgeRow({ format: 'Asian Parliamentary', inroundsJudged: null }),
    ]);
    expect(out[0]).toMatchObject({
      format: 'BP',
      tournaments: 3,
      broke: 1,
      roundsJudged: 10,
      roundsChaired: 4,
      chairRate: 0.4,
    });
    expect(out[1]).toMatchObject({ format: 'AP', tournaments: 1, chairRate: null });
  });
});

describe('judgingByTopic', () => {
  it('counts judged prelim rounds by their motion topic, skipping mixed or missing topics', () => {
    const rows = [makeJudgeRow({ tournamentId: 5n, judgedRoundNumbers: [1, 2, 3, 4] })];
    const motions = [
      { tournamentId: 5n, roundNumber: 1, topic: 'Economics' },
      { tournamentId: 5n, roundNumber: 2, topic: 'Economics' },
      // A choice round with two topics has none.
      { tournamentId: 5n, roundNumber: 3, topic: 'Economics' },
      { tournamentId: 5n, roundNumber: 3, topic: 'Feminism' },
      // An outround motion has no round number and never counts.
      { tournamentId: 5n, roundNumber: null, topic: 'Economics' },
    ];
    expect(judgingByTopic(rows, motions)).toEqual({
      topics: [{ topic: 'Economics', rounds: 2, tournaments: 1 }],
      roundsJudged: 4,
      withTopic: 2,
    });
  });
});

describe('topSpeakerFinishes', () => {
  it('lists each top-10 finish once per tournament, newest first, majors first in a year', () => {
    const { finishes, tournaments } = topSpeakerFinishes([
      makeSpeakerRow({ tournamentName: 'City IV', year: 2025, speakerRankOpen: 7 }),
      makeSpeakerRow({
        tournamentName: 'World Universities Debating Championship 2025',
        year: 2025,
        speakerRankOpen: 30,
        speakerRankEsl: 4,
      }),
      makeSpeakerRow({
        tournamentName: 'Old Open',
        year: 2022,
        speakerRankOpen: 1,
        speakerRankEsl: 1,
      }),
      makeSpeakerRow({ tournamentName: 'No Finish', year: 2025, speakerRankOpen: 40 }),
    ]);
    expect(finishes.map((f) => [f.tournamentName, f.detail])).toEqual([
      ['World Universities Debating Championship 2025', 'ESL #4'],
      ['City IV', 'Open #7'],
      ['Old Open', 'Open #1 · ESL #1'],
    ]);
    expect(tournaments).toBe(4);
  });
});
