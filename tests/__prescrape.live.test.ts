/**
 * B9 runner: pre-scrape a list of tournaments from their public pages into
 * the database POSTGRES_PRISMA_URL points at. Skipped by default.
 *
 *   RUN_PRESCRAPE=1 PRESCRAPE_LIST=<file, one tournament URL per line> \
 *   PRESCRAPE_REPORT=<out.json> POSTGRES_PRISMA_URL=... \
 *   npx vitest run tests/__prescrape.live.test.ts
 *
 * - Refuses a database that is not on localhost unless
 *   PRESCRAPE_ALLOW_REMOTE=1: loading production is the owner's step.
 * - Resumable and version-aware: a stored tournament that is fresh and at
 *   the current PARSER_VERSION is skipped (status "current"), so a re-run
 *   after an interruption or a parser bump does only what is left.
 *   PRESCRAPE_FORCE=1 re-scrapes everything listed.
 * - Sequential, one tournament at a time, with PRESCRAPE_PAUSE_MS between
 *   them (default 5000) on top of ingest's own per-host throttle.
 * - A root-hosted entry (no slug) is resolved from its root page when that
 *   page links exactly one tournament, and skipped otherwise.
 * - Ends with the duplicates check (design C1): any host + slug stored
 *   under more than one fingerprint fails the run.
 * - Storage guard: before each tournament, stops cleanly (status
 *   "stopped-storage") once pg_database_size reaches PRESCRAPE_MAX_DB_BYTES
 *   (default 0.85 GB). Neon's free plan FAILS writes past 1 GB — users'
 *   ingests included — so the load must stop well short of it. Resumable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

const DB = process.env.POSTGRES_PRISMA_URL ?? '';
const enabled = process.env.RUN_PRESCRAPE === '1';
if (
  enabled &&
  !/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(DB) &&
  process.env.PRESCRAPE_ALLOW_REMOTE !== '1'
) {
  throw new Error(
    'refusing: POSTGRES_PRISMA_URL is not localhost (set PRESCRAPE_ALLOW_REMOTE=1 to load a remote database)',
  );
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.runIf(enabled)('B9 pre-scrape runner', () => {
  it(
    'loads the list',
    async () => {
      const { prisma } = await import('@/lib/db');
      const { prescrapeTournament } = await import('@/lib/calicotab/ingest');
      const { tournamentSlugsFromRootPage, expandRootSlugs, parseShard, shardOf } =
        await import('@/lib/calicotab/prescrape');
      const pause = Number(process.env.PRESCRAPE_PAUSE_MS ?? 5_000);
      const all = readFileSync(process.env.PRESCRAPE_LIST!, 'utf8')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      // PRESCRAPE_SHARD="2/4": only this shard's tournaments, split by host.
      const shard = parseShard(process.env.PRESCRAPE_SHARD);
      const urls = shard ? all.filter((u) => shardOf(u, shard.total) === shard.index) : all;
      console.log(
        `[prescrape] ${shard ? `shard ${shard.index}/${shard.total}: ` : ''}${urls.length} of ${all.length} tournaments`,
      );
      const report: Array<Record<string, unknown>> = [];
      const save = () =>
        writeFileSync(
          process.env.PRESCRAPE_REPORT!,
          JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1),
        );

      const maxDbBytes = Number(process.env.PRESCRAPE_MAX_DB_BYTES ?? 0.85 * 1024 ** 3);
      const dbBytes = async () =>
        Number(
          (
            await prisma.$queryRaw<
              Array<{ b: bigint }>
            >`SELECT pg_database_size(current_database()) AS b`
          )[0]!.b,
        );
      report.push({ dbBytesBefore: await dbBytes(), maxDbBytes });

      // Refuse to write over a slow link. Ingest's write phase makes hundreds of
      // sequential queries inside one 45 s transaction, so it only finishes when
      // the database is close: the first production attempt, from a laptop 300 ms
      // from Neon, failed every tournament with "Transaction not found". Say so in
      // the first second instead of after a stream of errors.
      const rtts: number[] = [];
      for (let i = 0; i < 8; i++) {
        const t = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        rtts.push(Date.now() - t);
      }
      rtts.sort((a, b) => a - b);
      const medianRoundTripMs = rtts[Math.floor(rtts.length / 2)]!;
      const maxLatencyMs = Number(process.env.PRESCRAPE_MAX_LATENCY_MS ?? 120);
      report.push({ medianRoundTripMs, maxLatencyMs });
      if (medianRoundTripMs > maxLatencyMs && process.env.PRESCRAPE_ALLOW_SLOW !== '1') {
        save();
        throw new Error(
          `database round trip is ${medianRoundTripMs} ms (limit ${maxLatencyMs} ms): the write transaction cannot finish over this link. ` +
            'Run it from a GitHub Actions runner (docs/runbooks/B9-prescrape-load.md), or set PRESCRAPE_ALLOW_SLOW=1 at your own risk.',
        );
      }
      for (const raw of urls) {
        const size = await dbBytes();
        if (size >= maxDbBytes) {
          report.push({ url: raw, status: 'stopped-storage', dbBytes: size, maxDbBytes });
          save();
          break;
        }
        const t0 = Date.now();
        // A root-hosted entry expands to every tournament its root page
        // links (up to PRESCRAPE_MAX_YEAR, default 2025); anything else is one.
        let targets = [raw];
        try {
          const u = new URL(raw);
          if (u.pathname.split('/').filter(Boolean).length === 0) {
            const res = await fetch(raw, {
              headers: { 'User-Agent': UA },
              signal: AbortSignal.timeout(20_000),
            });
            const slugs = res.ok
              ? expandRootSlugs(
                  tournamentSlugsFromRootPage(await res.text(), u.host),
                  Number(process.env.PRESCRAPE_MAX_YEAR ?? 2025),
                )
              : [];
            if (slugs.length === 0) {
              report.push({
                url: raw,
                status: 'skipped',
                reason: 'root page links no tournaments',
              });
              save();
              continue;
            }
            targets = slugs.map((s) => `https://${u.host}/${s}/`);
          }
        } catch (err) {
          report.push({
            url: raw,
            status: 'error',
            error: (err as Error).message.slice(0, 300),
            ms: Date.now() - t0,
          });
          save();
          continue;
        }
        for (const url of targets) {
          const t1 = Date.now();
          try {
            const r = await prescrapeTournament(url, {
              force: process.env.PRESCRAPE_FORCE === '1',
            });
            report.push({
              url: raw,
              resolved: url !== raw ? url : undefined,
              ...r,
              ms: Date.now() - t1,
              warnings: r.warnings.length,
            });
          } catch (err) {
            report.push({
              url: raw,
              resolved: url !== raw ? url : undefined,
              status: 'error',
              error: (err as Error).message.slice(0, 300),
              ms: Date.now() - t1,
            });
          }
          save();
          if (report.at(-1)?.status !== 'current') await sleep(pause);
        }
      }

      // C1: one fingerprint per host + slug, or the load created duplicates.
      const dupes = await prisma.$queryRaw<Array<{ site: string; n: bigint }>>`
        SELECT lower(regexp_replace(substring("sourceUrlRaw" from '^https?://[^/]+/[^/]+/'), '^https?://', '')) AS site,
               count(DISTINCT fingerprint) AS n
        FROM "Tournament"
        -- A row with no slug (a site root) has no host + slug to share; it
        -- would otherwise group with every other such row as one "site".
        WHERE "sourceUrlRaw" ~* '^https?://[^/]+/[^/]+/'
        GROUP BY 1
        HAVING count(DISTINCT fingerprint) > 1`;
      report.push({
        duplicates: dupes.map((d) => ({ site: d.site, fingerprints: Number(d.n) })),
        dbBytesAfter: await dbBytes(),
      });
      save();
      await prisma.$disconnect();
      expect(dupes).toEqual([]);
    },
    12 * 60 * 60 * 1000,
  );
});
