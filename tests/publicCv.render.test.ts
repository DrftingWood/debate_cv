import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// The public CV (/u/<slug>) server-rendered against stubbed data: the phone
// cards (PUB-1), the wrapping desktop ledger (PUB-2), the dead theme toggle
// (PUB-3), visible team placement (PUB-4), the empty record (PUB-6) and the
// header count (PUB-8). See docs/UI_UX_AUDIT-2026-10-27.md §8.

function speakerRow(over: Partial<CvSpeakerRow> = {}): CvSpeakerRow {
  return {
    tournamentId: 1n,
    tournamentName: 'World Universities Debating Championship 2024',
    year: 2024,
    emailDate: null,
    format: 'British Parliamentary',
    region: null,
    totalTeams: 40,
    sourceUrl: 'https://wudc2024.calicotab.com/wudc2024/',
    myName: 'Maya Rao',
    teammates: ['Lena Park'],
    teammateDetails: [],
    teamName: 'Oxford Union Society Debating Team A',
    teamRank: 3,
    teamPoints: '18',
    teamWins: null,
    teamFirsts: null,
    teamSeconds: null,
    speakerAvgScore: '74.2',
    prelimsSpoken: 9,
    prelimRoundCount: 9,
    speakerRankOpen: 12,
    speakerRankEsl: null,
    speakerRankEfl: null,
    speakerCategories: [],
    teamBreakRank: 3,
    eliminationReached: 'Semifinals',
    eliminationReachedByCategory: null,
    broke: true,
    openBreak: null,
    wonTournament: false,
    hasOpenReport: false,
    partlyLoaded: false,
    roundScores: [],
    teamRoundResults: [],
    ...over,
  };
}

function judgeRow(over: Partial<CvJudgeRow> = {}): CvJudgeRow {
  return {
    tournamentId: 2n,
    tournamentName: 'Cambridge IV',
    year: 2023,
    format: 'British Parliamentary',
    region: null,
    totalTeams: 60,
    sourceUrl: 'https://cambridgeiv.calicotab.com/civ2023/',
    myName: 'Maya Rao',
    judgeTypeTag: null,
    inroundsJudged: 5,
    inroundsChaired: 3,
    judgedRoundNumbers: [],
    judgedOutroundStages: [],
    lastOutroundChaired: 'Quarterfinals',
    lastOutroundJudged: 'Semifinals',
    broke: true,
    hasOpenReport: false,
    partlyLoaded: false,
    ...over,
  };
}

describe('partly loaded mark', () => {
  const TEXT = 'Partly loaded';

  it('shows on speaker and judge phone cards only when the row is partly loaded', async () => {
    const { PublicSpeakerCard, PublicJudgeCard } = await import('@/app/u/[slug]/PublicRecordCards');
    const on = { partlyLoaded: true };
    expect(
      renderToStaticMarkup(React.createElement(PublicSpeakerCard, { r: speakerRow(on) })),
    ).toContain(TEXT);
    expect(
      renderToStaticMarkup(React.createElement(PublicJudgeCard, { r: judgeRow(on) })),
    ).toContain(TEXT);
    expect(
      renderToStaticMarkup(React.createElement(PublicSpeakerCard, { r: speakerRow() })),
    ).not.toContain(TEXT);
  });

  it('shows in the public desktop tables too, with the tooltip copy as a title', async () => {
    const { PublicSpeakingTable, PublicJudgingTable } = await import('@/app/u/[slug]/PublicLedger');
    const speaking = renderToStaticMarkup(
      React.createElement(PublicSpeakingTable, {
        rows: [speakerRow({ partlyLoaded: true })],
        label: 'x',
        proAm: new Set<string>(),
      }),
    );
    expect(speaking).toContain(TEXT);
    const judging = renderToStaticMarkup(
      React.createElement(PublicJudgingTable, {
        rows: [judgeRow({ partlyLoaded: true })],
        label: 'x',
      }),
    );
    expect(judging).toContain(TEXT);
    expect(judging).toContain(
      'Some pages of this tournament&#x27;s tab didn&#x27;t load, so some of its figures may be incomplete.',
    );
  });
});

describe('partly loaded description', () => {
  const SENTENCE =
    'Some pages of this tournament&#x27;s tab didn&#x27;t load, so some of its figures may be incomplete.';

  // The badge must be focusable and its aria-describedby must resolve to an
  // sr-only element holding the verbatim sentence (cards and tables).
  function expectDescribed(html: string) {
    const badge = html.match(/<span[^>]*tabindex="0"[^>]*>Partly loaded<\/span>/)?.[0];
    expect(badge).toBeDefined();
    const id = badge!.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`<span id="${id}" class="sr-only">${SENTENCE}</span>`);
  }

  it('is focusable and described on cards and in tables', async () => {
    const { PublicSpeakerCard, PublicJudgeCard } = await import('@/app/u/[slug]/PublicRecordCards');
    const { PublicSpeakingTable, PublicJudgingTable } = await import('@/app/u/[slug]/PublicLedger');
    const on = { partlyLoaded: true };
    expectDescribed(
      renderToStaticMarkup(React.createElement(PublicSpeakerCard, { r: speakerRow(on) })),
    );
    expectDescribed(
      renderToStaticMarkup(React.createElement(PublicJudgeCard, { r: judgeRow(on) })),
    );
    expectDescribed(
      renderToStaticMarkup(
        React.createElement(PublicSpeakingTable, {
          rows: [speakerRow(on)],
          label: 'x',
          proAm: new Set<string>(),
        }),
      ),
    );
    expectDescribed(
      renderToStaticMarkup(
        React.createElement(PublicJudgingTable, { rows: [judgeRow(on)], label: 'x' }),
      ),
    );
  });

  it('wraps the card tooltip but leaves the default tooltip single-line', async () => {
    const { Tooltip } = await import('@/components/ui/Tooltip');
    const wrapped = renderToStaticMarkup(
      React.createElement(
        Tooltip,
        { content: 'x', wrap: true } as React.ComponentProps<typeof Tooltip>,
        'c',
      ),
    );
    expect(wrapped).toContain('max-w-[16rem]');
    const plain = renderToStaticMarkup(
      React.createElement(Tooltip, { content: 'x' } as React.ComponentProps<typeof Tooltip>, 'c'),
    );
    expect(plain).toContain('whitespace-nowrap');
    expect(plain).not.toContain('max-w-[16rem]');
  });
});

describe('public CV phone cards', () => {
  it('shows every result a recipient needs, with the team placement and its field', async () => {
    const { PublicSpeakerCard } = await import('@/app/u/[slug]/PublicRecordCards');
    const out = renderToStaticMarkup(React.createElement(PublicSpeakerCard, { r: speakerRow() }));
    expect(out).toContain('World Universities Debating Championship 2024');
    expect(out).toContain('#3 of 40');
    expect(out).toContain('top 8% of the team tab');
    // The speaker tab is labelled as the speaker tab (PR #167), never as placement.
    expect(out).toContain('Speaker rank');
    expect(out).toContain('#12');
    expect(out).toContain('74.2');
    expect(out).toContain('Oxford Union Society Debating Team A');
    expect(out).toContain('Semifinals');
    // Touch never shows a title tooltip, so nothing is clipped into one.
    expect(out).not.toContain('truncate');
    expect(out).not.toContain('title=');
    expect(out).toContain('(opens in new tab)');
  });

  it('puts the outround inside the break badge instead of a second "Broke" badge', async () => {
    const { PublicSpeakerCard } = await import('@/app/u/[slug]/PublicRecordCards');
    const out = renderToStaticMarkup(React.createElement(PublicSpeakerCard, { r: speakerRow() }));
    expect(out).not.toContain('>Broke<');
    const noStage = renderToStaticMarkup(
      React.createElement(PublicSpeakerCard, {
        r: speakerRow({ eliminationReached: null }),
      }),
    );
    expect(noStage).toContain('>Broke<');
  });

  it('shows a bare team rank when the tab published no team count', async () => {
    const { PublicSpeakerCard } = await import('@/app/u/[slug]/PublicRecordCards');
    const out = renderToStaticMarkup(
      React.createElement(PublicSpeakerCard, { r: speakerRow({ totalTeams: null }) }),
    );
    expect(out).toContain('#3');
    expect(out).not.toContain(' of ');
    expect(out).not.toContain('top ');
  });

  it('renders judging cards with the rounds chaired and judged', async () => {
    const { PublicJudgeCard } = await import('@/app/u/[slug]/PublicRecordCards');
    const out = renderToStaticMarkup(React.createElement(PublicJudgeCard, { r: judgeRow() }));
    expect(out).toContain('Cambridge IV');
    expect(out).toContain('Prelims chaired');
    expect(out).toContain('Quarterfinals');
    expect(out).toContain('Semifinals');
  });
});

describe('PublicCvPage', () => {
  const findUnique = vi.fn();
  const buildCvData = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    findUnique.mockReset();
    buildCvData.mockReset();
    vi.doMock('@/lib/db', () => ({ prisma: { user: { findUnique } } }));
    vi.doMock('@/lib/cv/buildCvData', () => ({ buildCvData }));
    vi.doMock('@/lib/cv/speakerStats', () => ({
      computeSpeakerStats: () => ({ scoreProfile: { mean: 73.4, speeches: 18 } }),
    }));
    vi.doMock('@/components/DownloadPdfButton', () => ({ DownloadPdfButton: () => null }));
    vi.doMock('next/navigation', () => ({
      notFound: () => {
        throw new Error('NEXT_NOT_FOUND');
      },
    }));
    findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Maya Rao',
      image: null,
      publicCvEnabled: true,
      publicAvatarEnabled: false,
    });
  });

  async function render(speakerRows: CvSpeakerRow[], judgeRows: CvJudgeRow[], tab?: string) {
    buildCvData.mockResolvedValue({
      speakerRows,
      judgeRows,
      summary: { totalTournaments: speakerRows.length + judgeRows.length, breaks: 0 },
      highlights: { deepestBreaks: [], activeYears: null },
    });
    const { default: PublicCvPage } = await import('@/app/u/[slug]/page');
    const el = await PublicCvPage({
      params: Promise.resolve({ slug: 'maya-rao' }),
      searchParams: Promise.resolve(tab ? { tab } : {}),
    });
    return renderToStaticMarkup(el);
  }

  it('renders phone cards beside the md-and-up ledger', async () => {
    const out = await render([speakerRow()], [judgeRow()]);
    expect(out).toMatch(/<ul class="space-y-3 md:hidden" aria-label="Speaking record, \d{4}">/);
    // Only the selected tab is built (owner review 2026-10-29).
    const judging = await render([speakerRow()], [judgeRow()], 'adjudication');
    expect(judging).toMatch(/<ul class="space-y-3 md:hidden" aria-label="Judging record, \d{4}">/);
    expect(out).toContain('panel hidden overflow-hidden md:block');
  });

  it('lets the ledger fit its sheet and shows placement inline, not in a tooltip only', async () => {
    const out = await render([speakerRow()], []);
    expect(out).not.toContain('min-w-max');
    expect(out).toContain('#3<span class="text-ink-soft">/40</span>');
    // The PR #167 wording survives on the headers and the cell.
    expect(out).toContain('Speaker rank');
    expect(out).toContain('3 of 40 teams · top 8%');
  });

  // The page follows the visitor's theme now (owner decision 3); it still
  // carries no theme control of its own.
  it('has no theme toggle', async () => {
    const out = await render([speakerRow()], []);
    expect(out.toLowerCase()).not.toContain('theme');
  });

  it('counts tournaments from the record, as the Tournaments tile does', async () => {
    const out = await render([speakerRow()], [judgeRow()]);
    expect(out).toContain('2 tournaments, each linked to its tab');
  });

  it('builds the record without the tournaments the owner hid (C101)', async () => {
    findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Maya Rao',
      image: null,
      publicCvEnabled: true,
      publicAvatarEnabled: false,
      publicHiddenTournamentIds: [7n],
    });
    await render([], []);
    expect(buildCvData).toHaveBeenCalledWith('u1', {
      includeFieldStats: false,
      excludeTournamentIds: [7n],
    });
  });

  it('says so when an enabled record has no rows', async () => {
    const out = await render([], []);
    expect(out).toContain('No tournaments on this record yet');
  });
});
