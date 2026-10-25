import { describe, expect, it } from 'vitest';
import {
  dedupeJudgeHits,
  judgeHitsFromRounds,
  publicTournamentBase,
  storedTournamentFresh,
  tournamentSlugsFromRootPage,
} from '@/lib/calicotab/prescrape';
import type { RoundDebate } from '@/lib/calicotab/parseTabs';

describe('publicTournamentBase', () => {
  it('reduces any page on a tournament to its public base', () => {
    expect(publicTournamentBase('https://wudc2024.calicotab.com/wudc/tab/team/')).toEqual({
      base: 'https://wudc2024.calicotab.com/wudc/',
      host: 'wudc2024.calicotab.com',
      slug: 'wudc',
    });
  });

  it('refuses a private URL: the pre-scrape reads public pages only', () => {
    expect(() => publicTournamentBase('https://wudc2024.calicotab.com/wudc/privateurls/abc123/')).toThrow(/private URL/);
  });

  it('refuses a root-hosted URL with no slug', () => {
    expect(() => publicTournamentBase('https://presido2026.calicotab.com/')).toThrow(/root-hosted/);
  });

  it('refuses hosts outside the tab allowlist, and non-https', () => {
    expect(() => publicTournamentBase('https://example.com/t/')).toThrow(/allowed tab host/);
    expect(() => publicTournamentBase('http://wudc2024.calicotab.com/wudc/')).toThrow(/allowed tab host/);
  });
});

describe('storedTournamentFresh', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

  it('any tournament is fresh for 30 days', () => {
    expect(storedTournamentFresh({ scrapedAt: daysAgo(10), year: 2026 }, now)).toBe(true);
    expect(storedTournamentFresh({ scrapedAt: daysAgo(40), year: 2026 }, now)).toBe(false);
  });

  it("a settled (earlier year's) tournament stays fresh for a year", () => {
    expect(storedTournamentFresh({ scrapedAt: daysAgo(200), year: 2024 }, now)).toBe(true);
    expect(storedTournamentFresh({ scrapedAt: daysAgo(400), year: 2024 }, now)).toBe(false);
  });

  it('a tournament with no year is not treated as settled', () => {
    expect(storedTournamentFresh({ scrapedAt: daysAgo(40), year: null }, now)).toBe(false);
  });

  it("Re-ingest all's epoch scrapedAt is never fresh, settled or not (#124)", () => {
    expect(storedTournamentFresh({ scrapedAt: new Date(0), year: 2023 }, now)).toBe(false);
  });
});

describe('judgeHitsFromRounds', () => {
  const round = (over: Partial<RoundDebate>): RoundDebate => ({
    roundLabel: 'Round 1',
    isOutround: false,
    roundNumber: 1,
    teamResults: [],
    judgeAssignments: [],
    ...over,
  });

  it('reads chair, panel and trainee seats, prelim rounds numbered, outrounds not', () => {
    const rounds = [
      round({ judgeAssignments: [{ personName: 'Ann', panelRole: 'chair' }, { personName: 'Bo', panelRole: 'panel' }] }),
      round({
        roundLabel: 'Grand Final',
        isOutround: true,
        roundNumber: 10,
        judgeAssignments: [{ personName: 'Ann', panelRole: 'panel' }, { personName: 'Cy', panelRole: 'trainee' }],
      }),
    ];
    const ann = judgeHitsFromRounds(rounds, (n) => n === 'Ann');
    expect(ann).toEqual([
      { stage: 'Round 1', role: 'chair', roundNumber: 1 },
      { stage: expect.stringMatching(/final/i), role: 'panellist', roundNumber: null },
    ]);
    expect(judgeHitsFromRounds(rounds, (n) => n === 'Cy')[0]!.role).toBe('trainee');
  });

  it('dedupes on stage, role and round, NULL rounds included', () => {
    const h = { stage: 'Grand Final', role: 'chair' as const, roundNumber: null };
    expect(dedupeJudgeHits([h, { ...h }, { ...h, role: 'panellist' as const }])).toHaveLength(2);
  });
});

describe('tournamentSlugsFromRootPage', () => {
  it('finds the one tournament a root page links, ignoring site furniture and other hosts', () => {
    const html = `
      <a href="/presido2026/">Pre SIDO 2026</a>
      <a href="/presido2026/tab/team/">Team tab</a>
      <a href="/accounts/login/">Log in</a>
      <a href="/static/x.css">css</a>
      <a href="https://other.calicotab.com/x/">elsewhere</a>`;
    expect(tournamentSlugsFromRootPage(html, 'presido2026.calicotab.com')).toEqual(['presido2026']);
  });

  it('reports every tournament on a multi-tournament root, so the caller can refuse to guess', () => {
    const html = `<a href="/open/">Open</a><a href="/novice/">Novice</a>`;
    expect(tournamentSlugsFromRootPage(html, 'x.calicotab.com').sort()).toEqual(['novice', 'open']);
  });
});
