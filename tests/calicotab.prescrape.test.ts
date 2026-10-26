import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dedupeJudgeHits,
  judgeHitsFromRounds,
  publicTournamentBase,
  storedTournamentFresh,
  tournamentSlugsFromRootPage,
  expandRootSlugs,
  parseShard,
  shardOf,
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
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

  it('a stored tournament is fresh whatever its age (only missing rounds force a re-scrape)', () => {
    expect(storedTournamentFresh({ scrapedAt: daysAgo(10), year: 2026 })).toBe(true);
    expect(storedTournamentFresh({ scrapedAt: daysAgo(40), year: 2026 })).toBe(true);
    expect(storedTournamentFresh({ scrapedAt: daysAgo(400), year: 2024 })).toBe(true);
    expect(storedTournamentFresh({ scrapedAt: daysAgo(1500), year: null })).toBe(true);
  });

  it("Re-ingest all's epoch scrapedAt is never fresh, settled or not (#124)", () => {
    expect(storedTournamentFresh({ scrapedAt: new Date(0), year: 2023 })).toBe(false);
    expect(storedTournamentFresh({ scrapedAt: new Date(0), year: null })).toBe(false);
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

describe('shardOf: splitting the load so no site is hit from two shards at once', () => {
  const list = readFileSync('scripts/prescrape/stage-a-2023-2025.txt', 'utf8')
    .split(/\r?\n/)
    .map((l: string) => l.trim())
    .filter(Boolean) as string[];

  it('puts every tournament of one host in the same shard', () => {
    expect(shardOf('https://edudrift.calicotab.com/apdc2024/', 4)).toBe(shardOf('https://EDUDRIFT.calicotab.com/uadc2026/', 4));
  });

  it('is stable, and always inside 0..total-1', () => {
    for (const url of list) {
      const k = shardOf(url, 4);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(4);
      expect(shardOf(url, 4)).toBe(k);
    }
  });

  it('covers the real stage-A list exactly once, with no shard starved or swamped', () => {
    const counts = [0, 0, 0, 0];
    for (const url of list) counts[shardOf(url, 4)] += 1;
    expect(counts.reduce((a, b) => a + b, 0)).toBe(list.length);
    for (const c of counts) {
      expect(c).toBeGreaterThan(list.length * 0.1);
      expect(c).toBeLessThan(list.length * 0.45);
    }
  });

  it('one shard is the whole list', () => {
    for (const url of list) expect(shardOf(url, 1)).toBe(0);
  });

  it('rejects a bad shard count', () => {
    expect(() => shardOf('https://a.calicotab.com/t/', 0)).toThrow();
    expect(() => shardOf('https://a.calicotab.com/t/', 2.5)).toThrow();
  });
});

describe('parseShard', () => {
  it('reads "index/total"', () => {
    expect(parseShard('2/4')).toEqual({ index: 2, total: 4 });
    expect(parseShard(' 0/1 ')).toEqual({ index: 0, total: 1 });
  });
  it('is null when unset, and throws on nonsense rather than loading the wrong slice', () => {
    expect(parseShard(undefined)).toBeNull();
    expect(parseShard('')).toBeNull();
    expect(() => parseShard('4/4')).toThrow();
    expect(() => parseShard('x/4')).toThrow();
    expect(() => parseShard('1')).toThrow();
  });
});

describe('expandRootSlugs', () => {
  it('keeps every tournament up to the max year and drops later ones', () => {
    expect(expandRootSlugs(['tido2025', 'tido2026'], 2025)).toEqual(['tido2025']);
  });
  it('keeps all sub-tournaments of a root and slugs with no year', () => {
    expect(expandRootSlugs(['open', 'masters'], 2025)).toEqual(['open', 'masters']);
  });
  it('does not read a year out of a longer number', () => {
    expect(expandRootSlugs(['edition20267'], 2025)).toEqual(['edition20267']);
  });
});
