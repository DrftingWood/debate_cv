import { describe, expect, it } from 'vitest';
import {
  judgingCell,
  judgingSeries,
  speakingCell,
  speakingSeries,
  topSpeakerDetail,
} from '@/lib/cv/careerChart';

// The career charts' tier rules are owner decisions (2026-10-29), so each one
// gets a case here rather than being inferred from the chart's pixels.

type Speaking = Parameters<typeof speakingCell>[0];
type Judging = Parameters<typeof judgingCell>[0];

const spoke = (over: Partial<Speaking> = {}): Speaking => ({
  tournamentName: 'City Open',
  year: 2025,
  broke: false,
  eliminationReached: null,
  eliminationReachedByCategory: null,
  wonTournament: null,
  speakerRankOpen: null,
  speakerRankEsl: null,
  speakerRankEfl: null,
  ...over,
});

const judged = (over: Partial<Judging> = {}): Judging => ({
  tournamentName: 'City Open',
  year: 2025,
  judgeTypeTag: null,
  judgedOutroundStages: [],
  lastOutroundJudged: null,
  lastOutroundChaired: null,
  ...over,
});

describe('speakingCell', () => {
  it('puts a tournament without a break below the rule', () => {
    expect(speakingCell(spoke()).tier).toBe('none');
  });

  it('tiers a break by its furthest stage', () => {
    const tier = (stage: string) =>
      speakingCell(spoke({ broke: true, eliminationReached: stage })).tier;
    expect(tier('Octofinals')).toBe('qf');
    expect(tier('Quarterfinals')).toBe('qf');
    expect(tier('Semifinals')).toBe('sf');
    expect(tier('Grand Final')).toBe('f');
    expect(tier('ESL Semifinals')).toBe('sf');
  });

  it('keeps a break of unknown depth as a break', () => {
    expect(speakingCell(spoke({ broke: true }))).toMatchObject({ tier: 'qf', detail: 'Broke' });
  });

  it('makes an Open or category final win a champion, with the category named', () => {
    expect(
      speakingCell(spoke({ broke: true, eliminationReached: 'Grand Final', wonTournament: true })),
    ).toMatchObject({ tier: 'champion', detail: 'Champion' });
    expect(
      speakingCell(spoke({ broke: true, eliminationReached: 'ESL Final', wonTournament: true })),
    ).toMatchObject({ tier: 'champion', detail: 'ESL Champion' });
  });

  it('counts gold, silver and bronze finals as finals; only a gold win is a champion', () => {
    const won = (stage: string) =>
      speakingCell(spoke({ broke: true, eliminationReached: stage, wonTournament: true }));
    expect(won('Gold Final').tier).toBe('champion');
    expect(won('Silver Final')).toMatchObject({ tier: 'f', detail: 'Won the Silver Final' });
    expect(won('Bronze Final').tier).toBe('f');
    expect(speakingCell(spoke({ broke: true, eliminationReached: 'Silver Final' })).tier).toBe('f');
  });

  it('does not count a Plate run as a break', () => {
    expect(
      speakingCell(spoke({ broke: true, eliminationReached: 'Plate Final', wonTournament: true }))
        .tier,
    ).toBe('none');
  });

  it('marks majors', () => {
    expect(speakingCell(spoke({ tournamentName: 'Australs 2024' })).major).toBe(true);
    expect(speakingCell(spoke()).major).toBe(false);
  });
});

describe('topSpeakerDetail', () => {
  it('counts Open or ESL / EFL top 10, once per tournament', () => {
    expect(topSpeakerDetail(spoke({ speakerRankOpen: 4 }))).toBe('Open #4');
    expect(topSpeakerDetail(spoke({ speakerRankOpen: 30, speakerRankEsl: 2 }))).toBe('ESL #2');
    expect(topSpeakerDetail(spoke({ speakerRankOpen: 8, speakerRankEsl: 1 }))).toBe(
      'Open #8 · ESL #1',
    );
    expect(topSpeakerDetail(spoke({ speakerRankOpen: 11 }))).toBeNull();
  });
});

describe('judgingCell', () => {
  it('gives core its own tier, ahead of anything judged', () => {
    expect(
      judgingCell(judged({ judgeTypeTag: 'core', lastOutroundChaired: 'Grand Final' })).tier,
    ).toBe('core');
  });

  it("makes chairing a final judging's champion tier", () => {
    expect(judgingCell(judged({ lastOutroundChaired: 'Grand Final' }))).toMatchObject({
      tier: 'chairedFinal',
      detail: 'Chaired the Final',
    });
  });

  it('counts a chaired outround as judged when no judged stage is recorded', () => {
    expect(judgingCell(judged({ lastOutroundChaired: 'Semifinals' })).tier).toBe('sf');
  });

  it('otherwise tiers by the furthest outround judged', () => {
    expect(
      judgingCell(
        judged({
          lastOutroundChaired: 'Quarterfinals',
          judgedOutroundStages: ['Quarterfinals', 'Semifinals'],
        }),
      ),
    ).toMatchObject({ tier: 'sf', detail: 'Judged the Semifinals' });
    expect(judgingCell(judged({ lastOutroundJudged: 'Grand Final' })).tier).toBe('f');
    expect(judgingCell(judged({ judgedOutroundStages: ['Plate Final'] })).tier).toBe('none');
    expect(judgingCell(judged()).tier).toBe('none');
  });
});

describe('series', () => {
  it('runs every year from first to last, gaps included, and counts undated rows', () => {
    const s = speakingSeries([spoke({ year: 2022 }), spoke({ year: 2024 }), spoke({ year: null })]);
    expect(s.years.map((y) => y.year)).toEqual([2022, 2023, 2024]);
    expect(s.years[1].cells).toEqual([]);
    expect(s.undated).toBe(1);
  });

  it('stacks a year bottom to top by tier, majors first within a tier', () => {
    const s = speakingSeries([
      spoke({ tournamentName: 'B Open', broke: true, eliminationReached: 'Semifinals' }),
      spoke({ tournamentName: 'A Open' }),
      spoke({ tournamentName: 'Australs 2025' }),
      spoke({
        tournamentName: 'C Open',
        broke: true,
        eliminationReached: 'Grand Final',
        wonTournament: true,
      }),
    ]);
    expect(s.years[0].cells.map((c) => c.tournamentName)).toEqual([
      'Australs 2025',
      'A Open',
      'B Open',
      'C Open',
    ]);
  });

  it('collects stars per year: top-10 finishes speaking, chaired outrounds judging', () => {
    expect(
      speakingSeries([spoke({ speakerRankOpen: 3 }), spoke({ speakerRankOpen: 40 })]).years[0]
        .stars,
    ).toEqual([{ tournamentName: 'City Open', detail: 'Open #3' }]);
    expect(
      judgingSeries([judged({ lastOutroundChaired: 'Semifinals' }), judged()]).years[0].stars,
    ).toEqual([{ tournamentName: 'City Open', detail: 'Chaired the Semifinals' }]);
  });

  it('is empty when nothing is dated', () => {
    expect(judgingSeries([judged({ year: null })])).toEqual({ years: [], undated: 1 });
  });
});
