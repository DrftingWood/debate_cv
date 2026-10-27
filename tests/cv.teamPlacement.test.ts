import { describe, expect, test } from 'vitest';
import {
  breakDepth,
  breakSeed,
  compareBreakStrength,
  formatTopPercent,
  inTopShareOfTeamTab,
  placementHighlights,
  teamTabPlacement,
} from '@/lib/cv/teamPlacement';
import { computeSpeakerStats } from '@/lib/cv/speakerStats';
import { pickHeaderMetrics } from '@/lib/cv/headerMetrics';
import { milestones } from '@/lib/cv/milestones';
import { buildExportCsv, resolveExportFields } from '@/lib/cv/exportFields';
import { buildJsonResume } from '@/lib/cv/jsonResume';
import { makeCvData, makeSpeakerRow } from './setup/cv-fixtures';

// Owner rule (2026-10): how high the user placed is judged by TEAM rank, and
// the strength of a break by the furthest outround reached — never by the
// speaker tab.

describe('teamTabPlacement', () => {
  test('rank against teams, with the "top N%" a reader means', () => {
    expect(teamTabPlacement(4, 40)).toEqual({ rank: 4, of: 40, percentile: 90, topPercent: 10 });
    expect(teamTabPlacement(1, 40)?.topPercent).toBe(2.5);
    expect(teamTabPlacement(40, 40)?.percentile).toBe(0);
  });

  test('missing or inconsistent figures give no placement rather than an invented one', () => {
    expect(teamTabPlacement(null, 40)).toBeNull();
    expect(teamTabPlacement(3, null)).toBeNull();
    expect(teamTabPlacement(0, 40)).toBeNull();
    // A rank past the team count means the two came from different tabs.
    expect(teamTabPlacement(41, 40)).toBeNull();
  });

  test('top-10% uses ceil, so a 15-team tab still has a top-10% place', () => {
    expect(inTopShareOfTeamTab(4, 40)).toBe(true);
    expect(inTopShareOfTeamTab(5, 40)).toBe(false);
    expect(inTopShareOfTeamTab(2, 15)).toBe(true);
    expect(inTopShareOfTeamTab(3, 15)).toBe(false);
    expect(inTopShareOfTeamTab(null, 15)).toBe(false);
  });

  test('formatTopPercent never claims "top 0%"', () => {
    expect(formatTopPercent(0.4)).toBe('<1%');
    expect(formatTopPercent(7.5)).toBe('8%');
  });
});

describe('breakDepth and break strength', () => {
  test('depth is the furthest outround, across every bracket the team broke in', () => {
    expect(breakDepth(makeSpeakerRow({ eliminationReached: null }))).toBeNull();
    expect(breakDepth(makeSpeakerRow({ eliminationReached: 'Semifinals' }))?.stage).toBe('Semifinals');
    const eudc = makeSpeakerRow({
      eliminationReached: 'Octofinals',
      eliminationReachedByCategory: [
        { category: 'Open', stage: 'Octofinals' },
        { category: 'ESL', stage: 'ESL Grand Final' },
      ],
    });
    expect(breakDepth(eudc)).toMatchObject({ stage: 'ESL Grand Final', category: true });
  });

  test('a deeper run beats a better speaker rank, a better seed and a better team rank', () => {
    const quarters = makeSpeakerRow({
      tournamentName: 'Q',
      broke: true,
      eliminationReached: 'Quarterfinals',
      speakerRankOpen: 1,
      teamBreakRank: 1,
      teamRank: 1,
    });
    const semis = makeSpeakerRow({
      tournamentName: 'S',
      broke: true,
      eliminationReached: 'Semifinals',
      speakerRankOpen: 80,
      teamBreakRank: 8,
      teamRank: 8,
    });
    expect([quarters, semis].sort(compareBreakStrength).map((r) => r.tournamentName)).toEqual(['S', 'Q']);
  });

  test('at equal depth: Open before category, then a won final, then seed', () => {
    const eslFinal = makeSpeakerRow({ tournamentName: 'E', broke: true, eliminationReached: 'ESL Grand Final' });
    const openFinal = makeSpeakerRow({ tournamentName: 'O', broke: true, eliminationReached: 'Grand Final' });
    const wonFinal = makeSpeakerRow({ tournamentName: 'W', broke: true, eliminationReached: 'Grand Final', wonTournament: true });
    expect([eslFinal, openFinal, wonFinal].sort(compareBreakStrength).map((r) => r.tournamentName)).toEqual([
      'W',
      'O',
      'E',
    ]);
    const seed2 = makeSpeakerRow({ tournamentName: '2', eliminationReached: 'Octofinals', teamBreakRank: 2 });
    const seed9 = makeSpeakerRow({ tournamentName: '9', eliminationReached: 'Octofinals', teamBreakRank: 9 });
    expect([seed9, seed2].sort(compareBreakStrength).map((r) => r.tournamentName)).toEqual(['2', '9']);
  });

  test('Final and Grand Final tie on depth, so Open-first now applies between them (C8)', () => {
    const eslGf = makeSpeakerRow({ tournamentName: 'ESL GF', broke: true, eliminationReached: 'ESL Grand Final' });
    const openFinal = makeSpeakerRow({ tournamentName: 'Open F', broke: true, eliminationReached: 'Final' });
    expect([eslGf, openFinal].sort(compareBreakStrength).map((r) => r.tournamentName)).toEqual(['Open F', 'ESL GF']);
  });

  test('Pre-Semis counts as a quarterfinal: it ties a full quarterfinal on depth (C11)', () => {
    const pre = makeSpeakerRow({ tournamentName: 'pre', broke: true, eliminationReached: 'Pre-Semifinals', teamBreakRank: 1 });
    const full = makeSpeakerRow({ tournamentName: 'full', broke: true, eliminationReached: 'Quarterfinals', teamBreakRank: 5 });
    expect(breakDepth(pre)?.rank).toBe(breakDepth(full)?.rank);
    // Equal depth falls through to seed, so the better seed wins rather than the "full" label.
    expect([full, pre].sort(compareBreakStrength).map((r) => r.tournamentName)).toEqual(['pre', 'full']);
  });

  test('Gold, Silver and Bronze finals are final-level breaks ranked gold > silver > bronze', () => {
    const rows = ['Bronze', 'Gold', 'Silver'].map((tier) =>
      makeSpeakerRow({ tournamentName: tier, broke: true, eliminationReached: `${tier} Final` }),
    );
    expect(rows.sort(compareBreakStrength).map((r) => r.tournamentName)).toEqual(['Gold', 'Silver', 'Bronze']);
    expect(breakDepth(rows[0]!)?.rank).toBe(95);
    // A tier final is final-level, so it still outranks an Open semifinal.
    const semi = makeSpeakerRow({ tournamentName: 'Semi', broke: true, eliminationReached: 'Semifinals' });
    expect([semi, ...rows].sort(compareBreakStrength).map((r) => r.tournamentName).at(-1)).toBe('Semi');
  });

  test('break seed quotes the break size only when the team is on the Open break', () => {
    expect(breakSeed(makeSpeakerRow({ teamBreakRank: null }))).toBeNull();
    expect(
      breakSeed(makeSpeakerRow({ teamBreakRank: 3, openBreak: { teams: 16, userOnBreak: true, linePoints: 14, lineWins: null } })),
    ).toEqual({ rank: 3, of: 16 });
    expect(
      breakSeed(makeSpeakerRow({ teamBreakRank: 3, openBreak: { teams: 16, userOnBreak: false, linePoints: 14, lineWins: null } })),
    ).toEqual({ rank: 3, of: null });
  });
});

describe('placementHighlights', () => {
  test('top-10% is judged by TEAM rank against team count, not speaker rank', () => {
    const rows = [
      // Speaker #3 of a 40-team tab: the old rule called this a top-10% break
      // (3 ≤ ceil(40 × 0.1)) though the team finished 20th.
      makeSpeakerRow({ tournamentName: 'Speaker star', broke: true, speakerRankOpen: 3, teamRank: 20, totalTeams: 40 }),
      // Team 4th of 40 with a middling speaker rank: a genuine top-10% finish.
      makeSpeakerRow({ tournamentName: 'Team star', teamRank: 4, totalTeams: 40, speakerRankOpen: 30 }),
    ];
    const h = placementHighlights(rows);
    expect(h.topTeamFinishes).toEqual([{ tournamentName: 'Team star', year: 2025, rank: 4, totalTeams: 40 }]);
    expect(h.bestTeamFinish).toMatchObject({ tournamentName: 'Team star', rank: 4, totalTeams: 40, topPercent: 10 });
  });

  test('deepest breaks are ordered by outround reached', () => {
    const rows = [
      makeSpeakerRow({ tournamentName: 'Octos', broke: true, eliminationReached: 'Octofinals', speakerRankOpen: 1 }),
      makeSpeakerRow({ tournamentName: 'Final', broke: true, eliminationReached: 'Grand Final', speakerRankOpen: 60 }),
      makeSpeakerRow({ tournamentName: 'No break', broke: false }),
      makeSpeakerRow({ tournamentName: 'Broke, no draw', broke: true, eliminationReached: null }),
    ];
    expect(placementHighlights(rows).deepestBreaks.map((b) => [b.tournamentName, b.stage])).toEqual([
      ['Final', 'Grand Final'],
      ['Octos', 'Octofinals'],
      ['Broke, no draw', null],
    ]);
  });

  test('best team finish prefers the better share, then the bigger field', () => {
    const h = placementHighlights([
      makeSpeakerRow({ tournamentName: 'Small', teamRank: 1, totalTeams: 10 }),
      makeSpeakerRow({ tournamentName: 'Big', teamRank: 2, totalTeams: 20 }),
      makeSpeakerRow({ tournamentName: 'Huge', teamRank: 3, totalTeams: 200 }),
    ]);
    expect(h.bestTeamFinish?.tournamentName).toBe('Huge');
    expect(
      placementHighlights([
        makeSpeakerRow({ tournamentName: 'Small', teamRank: 1, totalTeams: 10 }),
        makeSpeakerRow({ tournamentName: 'Big', teamRank: 2, totalTeams: 20 }),
      ]).bestTeamFinish?.tournamentName,
    ).toBe('Big');
  });
});

describe('statistics: team context', () => {
  const rows = [
    makeSpeakerRow({ tournamentId: 1n, tournamentName: 'A', teamRank: 2, totalTeams: 40, speakerRankOpen: 70 }),
    makeSpeakerRow({ tournamentId: 2n, tournamentName: 'B', teamRank: 10, totalTeams: 50, eliminationReached: 'Quarterfinals', broke: true, teamBreakRank: 5, openBreak: { teams: 16, userOnBreak: true, linePoints: 12, lineWins: null } }),
    makeSpeakerRow({ tournamentId: 3n, tournamentName: 'C', teamRank: 6, totalTeams: 20 }),
    makeSpeakerRow({ tournamentId: 4n, tournamentName: 'No rank', teamRank: null, totalTeams: 30 }),
  ];

  test('average placement is team rank against teams, from rows with a usable rank', () => {
    const t = computeSpeakerStats({ speakerRows: rows, judgeRows: [] }).teamContext;
    expect(t.placements).toHaveLength(3);
    // top 5%, 20%, 30% → mean 18.33
    expect(t.meanTopPercent).toBeCloseTo((5 + 20 + 30) / 3);
    expect(t.meanPercentile).toBeCloseTo(100 - (5 + 20 + 30) / 3);
    expect(t.teamsFaced).toBe(110);
    expect(t.bestPlacement?.tournamentName).toBe('A');
    const b = t.placements.find((p) => p.tournamentName === 'B')!;
    expect(b).toMatchObject({ outround: 'Quarterfinals', breakRank: 5, breakingTeams: 16 });
  });

  test('the placement finding names the team tab and its sample', () => {
    const s = computeSpeakerStats({ speakerRows: rows, judgeRows: [] });
    const q = s.quirks.find((x) => x.id === 'team-percentile');
    expect(q?.text).toBe('Across your tournaments your team finishes in the top 18% of the team tab on average.');
    expect(q?.basis).toBe('3 tournaments · 110 teams ranked against');
  });
});

describe('surfaces', () => {
  test('header strip carries break depth and best team finish ahead of speaker figures', () => {
    const tiles = pickHeaderMetrics({
      totalTournaments: 10,
      breaks: 4,
      totalRoundsChaired: 0,
      outroundsChaired: 0,
      bestSpeakerRank: 2,
      bestSpeakerAverage: 78.1,
      speakerCount: 10,
      judgeCount: 0,
      activeYears: null,
      deepestBreak: 'Semifinals',
      bestTeamFinish: { rank: 3, totalTeams: 120, topPercent: 2.5 },
    });
    expect(tiles.map((t) => t.label)).toEqual(['Tournaments', 'Breaks', 'Best team finish', 'Best speaker avg']);
    expect(tiles[1].hint).toBe('40% of entries · deepest Semifinals');
    expect(tiles[2]).toMatchObject({ value: '#3', hint: 'of 120 teams · top 3%' });
  });

  test('a speaker-only header keeps the speaker-tab rank, labelled as such', () => {
    const tiles = pickHeaderMetrics({
      totalTournaments: 3,
      breaks: 0,
      totalRoundsChaired: 0,
      outroundsChaired: 0,
      bestSpeakerRank: 5,
      bestSpeakerAverage: null,
      speakerCount: 3,
      judgeCount: 0,
      activeYears: null,
    });
    expect(tiles.map((t) => t.label)).toEqual(['Tournaments', 'Best speaker-tab rank']);
  });

  test('milestones record the best team-tab rank separately from the speaker tab', () => {
    const m = milestones([
      makeSpeakerRow({ tournamentName: 'A', year: 2023, teamRank: 7, speakerRankOpen: 2 }),
      makeSpeakerRow({ tournamentName: 'B', year: 2024, teamRank: 3, speakerRankOpen: 9 }),
    ])!;
    expect(m.bestTeamRank).toEqual({ rank: 3, of: 2, at: [{ tournament: 'B', year: 2024 }] });
    expect(m.bestSpeakerRank?.rank).toBe(2);
  });

  test('export appends team placement and break rank at the tail', () => {
    const data = makeCvData({
      speakerRows: [
        makeSpeakerRow({
          teamRank: 4,
          totalTeams: 40,
          teamBreakRank: 2,
          openBreak: { teams: 8, userOnBreak: true, linePoints: 15, lineWins: null },
        }),
      ],
    });
    const { fields } = resolveExportFields(['team_placement', 'break_rank']);
    const lines = buildExportCsv(data, fields).trimEnd().split('\n');
    expect(lines[0]).toBe('section,team_placement,break_rank');
    expect(lines[1]).toBe('speaker,4/40 (top 10%),2/8');
  });

  test('JSON Resume award summary states the team placement', () => {
    const doc = buildJsonResume(
      makeCvData({
        speakerRows: [
          makeSpeakerRow({ broke: true, eliminationReached: 'Semifinals', teamName: 'Test A', teamRank: 3, totalTeams: 40 }),
        ],
      }),
      { now: new Date('2026-01-01T00:00:00Z') },
    );
    expect(doc.awards[0]).toMatchObject({
      title: 'Broke — reached Semifinals',
      summary: 'Team Test A; team ranked 3 of 40 after prelims',
    });
  });
});
