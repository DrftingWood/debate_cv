import { describe, expect, test } from 'vitest';
import {
  judgingLens,
  speakingVsJudging,
  type JudgeLensRow,
} from '@/lib/cv/judgingLens';

const judge = (o: Partial<JudgeLensRow>): JudgeLensRow => ({
  year: 2023,
  judgeTypeTag: 'normal',
  inroundsJudged: 5,
  inroundsChaired: 3,
  lastOutroundChaired: null,
  lastOutroundJudged: null,
  broke: false,
  ...o,
});

describe('judgingLens — chair rate by season', () => {
  const lens = judgingLens([
    judge({ year: 2022, inroundsJudged: 5, inroundsChaired: 5 }),
    judge({ year: 2022, inroundsJudged: 4, inroundsChaired: 2 }),
    // Ingest stores a zero chair count as null; with rounds judged on record it is 0 of 4.
    judge({ year: 2023, inroundsJudged: 4, inroundsChaired: null }),
    // No judged-round count: no denominator, so no rate — only its chair count survives.
    judge({ year: 2023, inroundsJudged: null, inroundsChaired: 3 }),
    judge({ year: 2023, inroundsJudged: null, inroundsChaired: null }),
    // More chaired than judged: the two sources disagree, so it is left out of the rate.
    judge({ year: 2023, inroundsJudged: 2, inroundsChaired: 4 }),
    judge({ year: null, inroundsJudged: 6, inroundsChaired: 6 }),
  ]);

  test('one row per dated season, oldest first, with its sample', () => {
    expect(lens.chair.seasons).toEqual([
      { year: 2022, tournaments: 2, measured: 2, roundsJudged: 9, roundsChaired: 7, chairRate: 7 / 9 },
      { year: 2023, tournaments: 4, measured: 1, roundsJudged: 4, roundsChaired: 0, chairRate: 0 },
    ]);
  });

  test('overall includes undated tournaments, and every exclusion is counted', () => {
    expect(lens.chair.overall).toEqual({ measured: 4, roundsJudged: 19, roundsChaired: 13, chairRate: 13 / 19 });
    expect(lens.chair.undated).toBe(1);
    expect(lens.chair.unmeasured).toBe(2);
    expect(lens.chair.inconsistent).toBe(1);
    expect(lens.chair.chairedWithoutCount).toEqual({ tournaments: 1, rounds: 3 });
  });

  test('a season with no measurable tournament has no rate rather than 0 %', () => {
    const only = judgingLens([judge({ year: 2020, inroundsJudged: null, inroundsChaired: null })]);
    expect(only.chair.seasons).toEqual([
      { year: 2020, tournaments: 1, measured: 0, roundsJudged: 0, roundsChaired: 0, chairRate: null },
    ]);
    expect(only.chair.overall.chairRate).toBeNull();
  });
});

describe('judgingLens — outround depth', () => {
  const lens = judgingLens([
    // "Octofinals" contains "final": ranked by stage, not substring.
    judge({ lastOutroundJudged: 'Octofinals', broke: true }),
    judge({ lastOutroundJudged: 'Grand Final', lastOutroundChaired: 'Grand Final', broke: true }),
    judge({ lastOutroundJudged: 'Novice Grand Final', broke: true }),
    judge({ lastOutroundJudged: 'Open Quarter Finals', lastOutroundChaired: 'Open Quarter Finals', broke: true }),
    judge({ lastOutroundJudged: 'Pre-Semi Finals', broke: true }),
    judge({ lastOutroundJudged: 'Showcase Debate', broke: true }),
    // Broke per the break page, but no outround stage stored.
    judge({ lastOutroundJudged: null, broke: true }),
    judge({ lastOutroundJudged: null, broke: false }),
  ]);

  test('buckets deepest first, then unrecognised, unstaged breaks, and no outround', () => {
    expect(lens.depth.buckets.map((b) => [b.key, b.tournaments])).toEqual([
      ['grand_final', 2],
      ['quarterfinal', 1],
      // The stage lexicon reads "Pre-Semi" as the partial round beneath the semis.
      ['partial_quarterfinal', 1],
      ['octofinal', 1],
      ['unrecognised', 1],
      ['broke_unstaged', 1],
      ['none', 1],
    ]);
  });

  test('a secondary bracket is counted, but "Open" is the main bracket', () => {
    const gf = lens.depth.buckets.find((b) => b.key === 'grand_final')!;
    expect(gf.secondaryBracket).toBe(1);
    expect(lens.depth.buckets.find((b) => b.key === 'quarterfinal')!.secondaryBracket).toBe(0);
    expect(lens.depth.secondaryBracket).toBe(1);
  });

  test('tournaments with a stored outround, and those with an outround chair on record', () => {
    expect(lens.depth.withOutround).toBe(6);
    expect(lens.depth.chairedOutround).toBe(2);
  });
});

describe('judgingLens — appointments and breaks', () => {
  const lens = judgingLens([
    judge({ judgeTypeTag: 'invited', broke: true }),
    judge({ judgeTypeTag: 'invited', broke: false }),
    judge({ judgeTypeTag: 'core', broke: false }),
    judge({ judgeTypeTag: 'normal', broke: true }),
    judge({ judgeTypeTag: 'normal', broke: true }),
    judge({ judgeTypeTag: 'normal', broke: false }),
    judge({ judgeTypeTag: null, broke: false }),
    judge({ judgeTypeTag: 'Adjudicator', broke: true }),
  ]);

  test('one row per appointment, most tournaments first, with breaks', () => {
    expect(lens.appointments.map((a) => [a.key, a.tournaments, a.broke])).toEqual([
      ['normal', 3, 2],
      ['invited', 2, 1],
      ['core', 1, 0],
      ['unstated', 2, 1],
    ]);
    expect(lens.appointments[0]!.label).toBe('Institutional');
    expect(lens.appointments[2]!.label).toMatch(/core/i);
  });

  test('judge breaks over every judged tournament', () => {
    expect(lens.tournaments).toBe(8);
    expect(lens.breaks).toEqual({ tournaments: 8, broke: 4, rate: 0.5 });
  });

  test('empty input', () => {
    const empty = judgingLens([]);
    expect(empty.tournaments).toBe(0);
    expect(empty.breaks.rate).toBeNull();
    expect(empty.depth.buckets).toEqual([]);
  });
});

describe('speakingVsJudging', () => {
  const s = (year: number | null) => ({ year });

  test('per season counts, undated excluded and counted', () => {
    const out = speakingVsJudging(
      [s(2020), s(2020), s(2021), s(null), s(null)],
      [s(2021), s(2021), s(2022), s(null)],
    );
    expect(out.seasons).toEqual([
      { year: 2020, spoken: 2, judged: 0, lean: 'spoken' },
      { year: 2021, spoken: 1, judged: 2, lean: 'judged' },
      { year: 2022, spoken: 0, judged: 1, lean: 'judged' },
    ]);
    expect(out.undatedSpoken).toBe(2);
    expect(out.undatedJudged).toBe(1);
    expect(out.turnedIn).toBe(2021);
    expect(out.turnedSeasons).toBe(2);
    expect(out.judgedMoreSeasons).toBe(2);
    expect(out.alwaysJudgedMore).toBe(false);
  });

  test('the turn must hold to the latest season: a lapse resets it', () => {
    const out = speakingVsJudging(
      [s(2020), s(2021), s(2021), s(2023)],
      [s(2020), s(2020), s(2022), s(2023), s(2023), s(2024)],
    );
    // 2020 judged, 2021 spoke, 2022 judged, 2023 judged, 2024 judged → turned in 2022.
    expect(out.turnedIn).toBe(2022);
    expect(out.turnedSeasons).toBe(3);
    expect(out.judgedMoreSeasons).toBe(4);
  });

  test('an even season breaks the run; a latest season spoken means no turn', () => {
    expect(speakingVsJudging([s(2020), s(2021)], [s(2020), s(2020), s(2021)]).turnedIn).toBeNull();
    expect(speakingVsJudging([s(2021)], [s(2020), s(2020)]).turnedIn).toBeNull();
  });

  test('judged more in every season is not a turn', () => {
    const out = speakingVsJudging([], [s(2020), s(2021)]);
    expect(out.turnedIn).toBeNull();
    expect(out.alwaysJudgedMore).toBe(true);
  });
});
