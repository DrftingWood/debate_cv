/**
 * B9 condition C2: prove, on real pages, that a pre-scraped tournament is
 * matched by a later private-URL ingest — served from storage, one row, the
 * person linked — before anything is loaded into production. Skipped by
 * default; LOCAL throwaway database only.
 *
 *   RUN_PRESCRAPE_MATCH=1 PRESCRAPE_MATCH_URLS=<file, one PRIVATE URL per line> \
 *   PRESCRAPE_MATCH_REPORT=<out.json> POSTGRES_PRISMA_URL=<localhost db> \
 *   npx vitest run tests/__prescrapeMatch.live.test.ts
 *
 * For each private URL:
 *   1. pre-scrape its tournament from the PUBLIC base (host + slug);
 *   2. for the first URL only (PRESCRAPE_MATCH_BREAK=1/0 forces it on/off), break the stored fingerprint, so the match has
 *      to come from the host + slug fallback (C1) — the case a title that
 *      reads differently on the private page would hit;
 *   3. ingest the private URL: expect cached, one Tournament for the site,
 *      and the registration person linked;
 *   4. force a full re-ingest of the private URL: other judges' pre-scraped
 *      round_results rows must survive it (design, point 2).
 * Private URLs are never written to the report (host + slug only).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

const DB = process.env.POSTGRES_PRISMA_URL ?? '';
const enabled = process.env.RUN_PRESCRAPE_MATCH === '1';
if (enabled && !/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(DB)) {
  throw new Error('refusing: POSTGRES_PRISMA_URL is not localhost');
}

describe.runIf(enabled)('B9 C2: pre-scraped tournaments are matched by private URLs', () => {
  it(
    'matches',
    async () => {
      const { prisma } = await import('@/lib/db');
      const { prescrapeTournament, ingestPrivateUrl } = await import('@/lib/calicotab/ingest');
      const urls = readFileSync(process.env.PRESCRAPE_MATCH_URLS!, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const user = await prisma.user.upsert({
        where: { email: 'b9proof@local.test' },
        update: {},
        create: { email: 'b9proof@local.test', name: 'B9 Proof' },
      });
      const report: Array<Record<string, unknown>> = [];
      const save = () => writeFileSync(process.env.PRESCRAPE_MATCH_REPORT!, JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
      const failures: string[] = [];

      for (const [i, privateUrl] of urls.entries()) {
        const u = new URL(privateUrl);
        const slug = u.pathname.split('/').filter(Boolean)[0]!;
        const site = `https://${u.host}/${slug}/`;
        const entry: Record<string, unknown> = { site };
        const rowsForSite = () =>
          prisma.tournament.count({ where: { sourceUrlRaw: { startsWith: site, mode: 'insensitive' } } });
        try {
          const pre = await prescrapeTournament(site, { force: true });
          entry.prescrape = { status: pre.status, name: pre.name, teams: pre.totalTeams, participants: pre.totalParticipants, judgeRows: pre.judgesWritten };
          entry.rowsAfterPrescrape = await rowsForSite();

          if ((process.env.PRESCRAPE_MATCH_BREAK === '1' || (i === 0 && process.env.PRESCRAPE_MATCH_BREAK !== '0')) && pre.tournamentId != null) {
            // Simulate a title that reads differently on the private page: a
            // different (still hex — it keys an advisory lock) fingerprint.
            const flipped = [...pre.fingerprint].reverse().join('');
            await prisma.tournament.update({ where: { id: pre.tournamentId }, data: { fingerprint: flipped } });
            entry.fingerprintBroken = true;
          }

          // The user's DiscoveredUrl, as a Gmail scan would have written it:
          // the cache path links the registration person to it.
          await prisma.discoveredUrl.upsert({
            where: { userId_url: { userId: user.id, url: privateUrl } },
            update: { registrationPersonId: null },
            create: { userId: user.id, url: privateUrl, host: u.host, tournamentSlug: slug },
          });
          const t0 = Date.now();
          const r = await ingestPrivateUrl(privateUrl, user.id);
          const discovered = await prisma.discoveredUrl.findUnique({
            where: { userId_url: { userId: user.id, url: privateUrl } },
            select: { registrationPersonId: true, tournamentId: true },
          });
          entry.match = {
            cached: r.cached,
            sameTournament: r.tournamentId === pre.tournamentId,
            // Linked, not claimed: a new user confirms the claim in identity
            // review; the ingest only attaches the registration person.
            personLinked: discovered?.registrationPersonId != null,
            discoveredUrlOnTournament: discovered?.tournamentId === r.tournamentId,
            ms: Date.now() - t0,
          };
          entry.rowsAfterMatch = await rowsForSite();
          if (!r.cached) failures.push(`${site}: not served from storage`);
          if (r.tournamentId !== pre.tournamentId) failures.push(`${site}: matched a different tournament row`);
          if (entry.rowsAfterMatch !== 1) failures.push(`${site}: ${entry.rowsAfterMatch} tournament rows for one site`);
          if (discovered?.registrationPersonId == null) failures.push(`${site}: registration person not linked`);

          // Point 2: a full re-ingest by one user keeps other judges' rows.
          const others = (ownerId: bigint | null) =>
            prisma.judgeAssignment.count({
              where: { tournamentId: r.tournamentId, source: 'round_results', ...(ownerId ? { NOT: { personId: ownerId } } : {}) },
            });
          const owner = discovered?.registrationPersonId ?? null;
          const before = await others(owner);
          await ingestPrivateUrl(privateUrl, user.id, { force: true });
          const after = await others(owner);
          entry.otherJudgeRows = { before, after };
          if (after < before) failures.push(`${site}: full re-ingest dropped other judges' rows ${before} → ${after}`);
        } catch (err) {
          entry.error = (err as Error).message.slice(0, 300);
          failures.push(`${site}: ${entry.error}`);
        }
        report.push(entry);
        save();
      }
      await prisma.$disconnect();
      expect(failures).toEqual([]);
    },
    3 * 60 * 60 * 1000,
  );
});
