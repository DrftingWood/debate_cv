import { describe, expect, test } from 'vitest';
import { breakRunBounds, milestones } from '@/lib/cv/milestones';
import type { CvSpeakerRow, CvSpeakerRoundScore } from '@/lib/cv/buildCvData';

let id = 0;
const row = (o: Partial<CvSpeakerRow>): CvSpeakerRow =>
  ({
    tournamentId: BigInt(++id),
    tournamentName: `T${id}`,
    year: 2024,
    format: 'British Parliamentary',
    roundScores: [] as CvSpeakerRoundScore[],
    prelimRoundCount: 9,
    speakerRankOpen: null,
    teamBreakRank: null,
    eliminationReached: null,
    broke: false,
    wonTournament: null,
    ...o,
  }) as CvSpeakerRow;
const s = (roundNumber: number, score: number | null, positionLabel: string | null = '1'): CvSpeakerRoundScore => ({
  roundNumber,
  score,
  positionLabel,
});

describe('milestones — firsts', () => {
  test('empty input has nothing to show', () => {
    expect(milestones([])).toBeNull();
  });

  test('a lone tournament in the earliest qualifying season is named', () => {
    const m = milestones([
      row({ tournamentName: 'Later', year: 2022, broke: true }),
      row({ tournamentName: 'Opener', year: 2020 }),
      row({ tournamentName: 'Breakthrough', year: 2021, broke: true }),
    ])!;
    expect(m.firstTournament).toMatchObject({ year: 2020, count: 1, tournament: 'Opener' });
    expect(m.firstBreak).toMatchObject({ year: 2021, count: 1, tournament: 'Breakthrough' });
    expect(m.firstFinal).toBeNull();
    expect(m.firstTitle).toBeNull();
  });

  test('several qualifying tournaments in that season: the year and a count, no name', () => {
    const m = milestones([
      row({ year: 2021, broke: true }),
      row({ year: 2021, broke: true }),
      row({ year: 2023, broke: true }),
    ])!;
    expect(m.firstBreak).toEqual({ year: 2021, count: 2, tournament: null });
  });

  test('undated tournaments never count as first, and are reported', () => {
    const m = milestones([
      row({ tournamentName: 'Undated', year: null, broke: true, eliminationReached: 'Grand Final', wonTournament: true }),
      row({ tournamentName: 'Dated', year: 2019 }),
    ])!;
    expect(m.firstTournament).toMatchObject({ year: 2019, tournament: 'Dated' });
    expect(m.firstBreak).toBeNull();
    expect(m.firstTitle).toBeNull();
    expect(m.undated).toBe(1);
    // …but a title that exists only undated must not read as "no title".
    expect(m.undatedFirsts).toEqual({ tournament: 1, break: 1, final: 1, title: 1 });
  });

  test('a final is Final or Grand Final (not Quarterfinal); a title implies one', () => {
    const m = milestones([
      row({ year: 2020, broke: true, eliminationReached: 'Quarterfinals' }),
      row({ year: 2020, broke: true, eliminationReached: 'Octofinals' }),
      row({ tournamentName: 'GF', year: 2021, broke: true, eliminationReached: 'Grand Final', wonTournament: false }),
      row({ tournamentName: 'Champ', year: 2022, broke: true, eliminationReached: null, wonTournament: true }),
    ])!;
    expect(m.firstFinal).toMatchObject({ year: 2021, tournament: 'GF' });
    expect(m.firstTitle).toMatchObject({ year: 2022, tournament: 'Champ' });
  });
});

describe('milestones — records', () => {
  test('best speech is a scored prelim only: no averages, outrounds, or round 0', () => {
    const m = milestones([
      row({
        tournamentName: 'A',
        prelimRoundCount: 5,
        roundScores: [s(1, 76), s(3, 79), s(6, 83), s(2, 90, 'average'), s(0, 88), s(4, null)],
      }),
      row({ tournamentName: 'B', prelimRoundCount: null, roundScores: [s(7, 78)] }),
    ])!;
    expect(m.bestSpeech).toEqual({
      score: 79,
      speeches: 3,
      at: [{ tournament: 'A', year: 2024, round: 3 }],
    });
  });

  test('best speech ties list every occurrence', () => {
    const m = milestones([
      row({ tournamentName: 'A', roundScores: [s(1, 80)] }),
      row({ tournamentName: 'B', roundScores: [s(2, 80), s(3, 75)] }),
    ])!;
    expect(m.bestSpeech!.at.map((a) => a.tournament)).toEqual(['A', 'B']);
  });

  test('best speaker rank and best team break rank take the smallest, with every holder', () => {
    const m = milestones([
      row({ tournamentName: 'A', speakerRankOpen: 12, broke: true, teamBreakRank: 4 }),
      row({ tournamentName: 'B', speakerRankOpen: 3, broke: true, teamBreakRank: 1 }),
      row({ tournamentName: 'C', speakerRankOpen: 3 }),
      row({ tournamentName: 'D' }),
    ])!;
    expect(m.bestSpeakerRank).toEqual({ rank: 3, of: 3, at: [{ tournament: 'B', year: 2024 }, { tournament: 'C', year: 2024 }] });
    expect(m.bestBreakRank).toEqual({ rank: 1, of: 2, at: [{ tournament: 'B', year: 2024 }] });
  });

  test('nothing to show when no row carries any milestone', () => {
    // A dated row is always a first tournament, so only an all-undated record is empty.
    expect(milestones([row({ year: null })])).toBeNull();
  });
});

describe('breakRunBounds — order within a season is unknown', () => {
  // Each season is [breaks, misses].
  test('whole seasons broken chain into a certain run', () => {
    expect(breakRunBounds([[3, 0], [2, 0]])).toEqual({ certain: 5, possible: 5 });
  });

  test('a season with one miss: at least ceil(b/2), at most b', () => {
    expect(breakRunBounds([[3, 1]])).toEqual({ certain: 2, possible: 3 });
  });

  test('a mixed season can extend a run from either side', () => {
    // 2021 all broke (2); 2022 three breaks, one miss; 2023 all broke (1).
    // Possible: 2 + 3 = 5 (miss last in 2022) — or 3 + 1 = 4; best is 5.
    // Certain: the adversary ordering B M B B in 2022 caps runs at max(2+1, 2+1) = 3.
    expect(breakRunBounds([[2, 0], [3, 1], [1, 0]])).toEqual({ certain: 3, possible: 5 });
  });

  test('two adjacent one-miss seasons still guarantee a cross-season pair', () => {
    // Four breaks, two misses: some run of two survives any order (B M B | M B B);
    // M B B | B B M lines up all four.
    expect(breakRunBounds([[2, 1], [2, 1]])).toEqual({ certain: 2, possible: 4 });
  });

  test('misses enough to separate every break', () => {
    expect(breakRunBounds([[2, 3]])).toEqual({ certain: 1, possible: 2 });
    expect(breakRunBounds([[0, 4]])).toEqual({ certain: 0, possible: 0 });
    expect(breakRunBounds([])).toEqual({ certain: 0, possible: 0 });
  });

  test('matches brute force over every within-season order on small records', () => {
    const perms = (b: number, m: number): boolean[][] => {
      if (b === 0 && m === 0) return [[]];
      const out: boolean[][] = [];
      if (b > 0) for (const p of perms(b - 1, m)) out.push([true, ...p]);
      if (m > 0) for (const p of perms(b, m - 1)) out.push([false, ...p]);
      return out;
    };
    const longest = (xs: boolean[]) => {
      let best = 0;
      let cur = 0;
      for (const x of xs) {
        cur = x ? cur + 1 : 0;
        best = Math.max(best, cur);
      }
      return best;
    };
    const seasonsList: Array<Array<[number, number]>> = [
      [[1, 1], [2, 2], [1, 0]],
      [[3, 2], [0, 1], [2, 1]],
      [[2, 1], [1, 0], [2, 1]],
      [[4, 1], [1, 1]],
      [[1, 2], [3, 0], [0, 0], [2, 2]],
    ];
    for (const seasons of seasonsList) {
      let orders: boolean[][] = [[]];
      for (const [b, m] of seasons) orders = orders.flatMap((o) => perms(b, m).map((p) => [...o, ...p]));
      const runs = orders.map(longest);
      expect(breakRunBounds(seasons)).toEqual({ certain: Math.min(...runs), possible: Math.max(...runs) });
    }
  });

  test('milestones reads runs over dated tournaments by season, excluding undated ones', () => {
    const m = milestones([
      row({ year: 2020, broke: true }),
      row({ year: 2020, broke: true }),
      row({ year: 2021, broke: true }),
      row({ year: 2021, broke: false }),
      row({ year: null, broke: true }),
    ])!;
    // 2020: B B; 2021: B and a miss in unknown order → 2 for certain, 3 if the break came first.
    expect(m.breakRun).toEqual({ certain: 2, possible: 3, dated: 4 });
  });
});
