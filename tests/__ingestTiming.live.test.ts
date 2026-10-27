/**
 * Live measurement for the TABBYCAT_API_ROUNDS decision (B8 enablement):
 * real ingests of real private URLs into a LOCAL throwaway database, once
 * with the flag off and once on, recording wall time, outbound requests,
 * what the API served, and whether the resulting rows agree.
 *
 *   RUN_INGEST_TIMING=1 INGEST_TIMING_URLS=<file, one private URL per line> \
 *   INGEST_TIMING_REPORT=<out.json> POSTGRES_PRISMA_URL=<localhost db> \
 *   npx vitest run tests/__ingestTiming.live.test.ts
 *
 * Private URLs are read from a file at run time and never written to the
 * report (it records the host and slug only): they are people's identities.
 * Refuses any database that is not on localhost — it force-ingests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

const DB = process.env.POSTGRES_PRISMA_URL ?? '';
const enabled = process.env.RUN_INGEST_TIMING === '1';
if (enabled && !/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(DB)) {
  throw new Error('refusing: POSTGRES_PRISMA_URL is not localhost');
}

const label = (u: string) => {
  const p = new URL(u);
  return `${p.host}/${p.pathname.split('/').filter(Boolean)[0] ?? ''}`;
};

describe.runIf(enabled)('ingest wall time, TABBYCAT_API_ROUNDS off vs on', () => {
  it(
    'measures',
    async () => {
      const urls = readFileSync(process.env.INGEST_TIMING_URLS!, 'utf8')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const { prisma } = await import('@/lib/db');
      const { ingestPrivateUrl } = await import('@/lib/calicotab/ingest');
      const user = await prisma.user.upsert({
        where: { email: 'timing@local.test' },
        update: {},
        create: { email: 'timing@local.test', name: 'Timing Harness' },
      });

      // Count every outbound request, split by API vs HTML.
      const realFetch = globalThis.fetch;
      const counts = { api: 0, html: 0 };
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input instanceof Request ? input.url : input);
        if (u.includes('/api/v1/')) counts.api++;
        else counts.html++;
        return realFetch(input, init);
      }) as typeof fetch;
      // Capture ingest's own summary of what the API served.
      const realInfo = console.info;
      let lastRest: unknown = null;
      let lastTabs: unknown = null;
      console.info = (msg?: unknown, ...rest: unknown[]) => {
        if (msg === '[ingest] tabbycat api rounds') lastRest = rest[0];
        if (msg === '[ingest] tabbycat api') lastTabs = rest[0];
      };

      const rows = async (tournamentId: bigint) => ({
        teamResults: await prisma.teamResult.count({ where: { tournamentId } }),
        participants: await prisma.tournamentParticipant.count({ where: { tournamentId } }),
        eliminations: await prisma.eliminationResult.count({ where: { tournamentId } }),
        speakerScores: await prisma.speakerRoundScore.count({
          where: { participant: { tournamentId } },
        }),
        judgeAssignments: await prisma.judgeAssignment.count({ where: { tournamentId } }),
      });

      const report: unknown[] = [];
      try {
        for (const [i, url] of urls.entries()) {
          const entry: Record<string, unknown> = { tournament: label(url) };
          // Alternate which mode runs first, so warm-up (DNS, learned
          // host intervals, the row already existing) favours neither.
          const order = i % 2 === 0 ? (['off', 'on'] as const) : (['on', 'off'] as const);
          for (const mode of order) {
            if (mode === 'on') process.env.TABBYCAT_API_ROUNDS = '1';
            else delete process.env.TABBYCAT_API_ROUNDS;
            counts.api = 0;
            counts.html = 0;
            lastRest = null;
            lastTabs = null;
            const t0 = Date.now();
            try {
              const r = await ingestPrivateUrl(url, user.id, { force: true });
              entry[mode] = {
                ms: Date.now() - t0,
                requests: { ...counts },
                tabs: (lastTabs as { teams?: string; speakers?: string } | null) ?? null,
                rest: lastRest,
                rows: await rows(r.tournamentId),
                totals: { teams: r.totalTeams, participants: r.totalParticipants },
                warnings: r.warnings.length,
              };
            } catch (err) {
              entry[mode] = {
                ms: Date.now() - t0,
                requests: { ...counts },
                error: (err as Error).message.slice(0, 200),
              };
            }
            await new Promise((r) => setTimeout(r, 3_000));
          }
          report.push(entry);
          writeFileSync(process.env.INGEST_TIMING_REPORT!, JSON.stringify(report, null, 1));
          realInfo(JSON.stringify(entry).slice(0, 400));
        }
      } finally {
        globalThis.fetch = realFetch;
        console.info = realInfo;
        delete process.env.TABBYCAT_API_ROUNDS;
        await prisma.$disconnect();
      }
      expect(report.length).toBe(urls.length);
    },
    6 * 60 * 60 * 1000,
  );
});
