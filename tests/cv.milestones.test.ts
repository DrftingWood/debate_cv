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
    expect(m.firstBreak).toEqual({ year: 2021, count: 2, tournament: null, undated: 0 });
  });

  test('undated tournaments never count as first, and are reported', () => {
    const m = milestones([
      row({ tournamentName: 'Undated', year: null, broke: true, eliminationReached: 'Grand Final', wonTournament: true }),
      row({ tournamentName: 'Dated', year: 2019 }),
    ])!;
    // An undated tournament could have come before it, so the season is the most that is known.
    expect(m.firstTournament).toEqual({ year: 2019, count: 1, tournament: null, undated: 1 });
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

  test('a first is named only when no undated tournament qualifies too', () => {
    const m = milestones([
      row({ tournamentName: 'NDO', year: 2021, broke: true, eliminationReached: 'Grand Final', wonTournament: false }),
      row({ tournamentName: 'Undated GF', year: null, broke: true, eliminationReached: 'Grand Finals', wonTournament: false }),
      row({ tournamentName: 'Dated break', year: 2020, broke: true, eliminationReached: 'Octofinals' }),
    ])!;
    expect(m.firstFinal).toEqual({ year: 2021, count: 1, tournament: null, undated: 1 });
    // The undated final is an undated break too, so the lone 2020 break goes unnamed as well.
    expect(m.firstBreak).toEqual({ year: 2020, count: 1, tournament: null, undated: 1 });
  });

  test('first final and title are the open bracket; category finals are counted apart', () => {
    const m = milestones([
      row({ tournamentName: 'ESL early', year: 2019, broke: true, eliminationReached: 'ESL Finals', wonTournament: true }),
      row({ tournamentName: 'Novice', year: 2020, broke: true, eliminationReached: 'Novice Grand Final', wonTournament: false }),
      row({ tournamentName: 'Open GF', year: 2021, broke: true, eliminationReached: 'Grand Final', wonTournament: false }),
      row({ tournamentName: 'Undated ESL', year: null, broke: true, eliminationReached: 'ESL Final', wonTournament: true }),
    ])!;
    expect(m.firstFinal).toMatchObject({ year: 2021, tournament: 'Open GF' });
    expect(m.firstTitle).toBeNull();
    expect(m.undatedFirsts).toMatchObject({ final: 0, title: 0 });
    expect(m.otherBracket).toEqual({ finals: 3, titles: 2, firstFinalYear: 2019, brackets: ['ESL', 'Novice'] });
    // A category break is still a break.
    expect(m.firstBreak).toMatchObject({ year: 2019, count: 1, undated: 1 });
  });

  test('a consolation bracket is never a break, a final or a title', () => {
    const m = milestones([
      row({ year: 2020, broke: true, eliminationReached: 'Consolation Final', wonTournament: true }),
      row({ year: 2020, broke: true, eliminationReached: 'Plate Final', wonTournament: false, teamBreakRank: 1 }),
      row({ year: 2021 }),
    ])!;
    expect(m.firstBreak).toBeNull();
    expect(m.firstFinal).toBeNull();
    expect(m.firstTitle).toBeNull();
    expect(m.otherBracket).toMatchObject({ finals: 0, titles: 0 });
    expect(m.bestBreakRank).toBeNull();
    expect(m.breakRun).toBeNull();
  });

  test('gold, silver and bronze finals are breaks and category finals (owner decision on C9)', () => {
    const m = milestones([
      row({ year: 2020, broke: true, eliminationReached: 'Silver Final', wonTournament: true }),
      row({ year: 2021, broke: true, eliminationReached: 'Bronze Final', wonTournament: false }),
      row({ year: 2022 }),
    ])!;
    expect(m.firstBreak).toMatchObject({ year: 2020 });
    expect(m.otherBracket).toMatchObject({ finals: 2, titles: 1 });
    // Owner rule: Gold/Silver/Bronze finals count as reaching a final (this
    // asserted null before, when only the open bracket counted).
    expect(m.firstFinal).toMatchObject({ year: 2020 });
  });

  test('Plate and Consolation finals still do not count as a first final; Bronze does', () => {
    const m = milestones([
      row({ year: 2019, broke: true, eliminationReached: 'Plate Final' }),
      row({ year: 2021, broke: true, eliminationReached: 'Bronze Final', wonTournament: false }),
    ])!;
    expect(m.firstFinal).toMatchObject({ year: 2021, tournament: expect.any(String) });
    // ESL stays out
    expect(milestones([row({ year: 2020, broke: true, eliminationReached: 'ESL Final' })])!.firstFinal).toBeNull();
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
      unbounded: 1,
      at: [{ tournament: 'A', year: 2024, round: 3 }],
    });
  });

  test('no prelim count: rounds past the last round with team points are outrounds', () => {
    const results = (n: number, outrounds: number[]) => [
      ...Array.from({ length: n }, (_, i) => ({ roundNumber: i + 1, position: 'OG', won: true, points: 3 })),
      ...outrounds.map((r) => ({ roundNumber: r, position: 'OG', won: true, points: null })),
    ];
    const m = milestones([
      row({
        tournamentName: 'Signal',
        prelimRoundCount: null,
        teamRoundResults: results(5, [6, 7]),
        roundScores: [s(2, 77), s(6, 85), s(7, 86)],
      }),
      // No team points at all: nothing separates prelims from outrounds, so the speech stays and is flagged.
      row({ tournamentName: 'Blind', prelimRoundCount: null, teamRoundResults: [], roundScores: [s(3, 78)] }),
    ])!;
    expect(m.bestSpeech).toEqual({
      score: 78,
      speeches: 2,
      unbounded: 1,
      at: [{ tournament: 'Blind', year: 2024, round: 3 }],
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
    expect(m.bestBreakRankOtherBracket).toBeNull();
  });

  test('a break rank without a break is not a break rank', () => {
    const m = milestones([
      row({ tournamentName: 'Stale', broke: false, teamBreakRank: 1 }),
      row({ tournamentName: 'Real', broke: true, teamBreakRank: 5 }),
    ])!;
    expect(m.bestBreakRank).toEqual({ rank: 5, of: 1, at: [{ tournament: 'Real', year: 2024 }] });
  });

  test('best team break rank is the open bracket; a better category rank is noted beside it', () => {
    const m = milestones([
      row({ tournamentName: 'Krabi', broke: true, eliminationReached: 'ESL Finals', teamBreakRank: 1 }),
      row({ tournamentName: 'Open', broke: true, eliminationReached: 'Semifinals', teamBreakRank: 3 }),
      row({ tournamentName: 'Unstaged', broke: true, eliminationReached: null, teamBreakRank: 4 }),
    ])!;
    expect(m.bestBreakRank).toEqual({ rank: 3, of: 2, at: [{ tournament: 'Open', year: 2024 }] });
    expect(m.bestBreakRankOtherBracket).toEqual({ rank: 1, of: 1, at: [{ tournament: 'Krabi', year: 2024 }] });

    // Not better than the open best: nothing to note.
    const tie = milestones([
      row({ tournamentName: 'ESL', broke: true, eliminationReached: 'ESL Finals', teamBreakRank: 1 }),
      row({ tournamentName: 'Open', broke: true, eliminationReached: 'Grand Final', teamBreakRank: 1 }),
    ])!;
    expect(tie.bestBreakRank!.at.map((a) => a.tournament)).toEqual(['Open']);
    expect(tie.bestBreakRankOtherBracket).toBeNull();
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
