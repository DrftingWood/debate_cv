/**
 * Corpus builder — the ONLY networked step in the real-data test suite.
 *
 * Fetches real Tabbycat pages once and writes them to disk so every other
 * real-data test runs offline, reproducibly, and without touching anyone
 * else's servers again.
 *
 * Two tiers, because the two questions need different shapes of data:
 *
 *   tier 1 (breadth)  — every tournament's homepage. Cheap, and enough to
 *                       harvest the real vocabulary: round labels, break
 *                       category tokens, tournament names. Vocabulary bugs
 *                       are long-tail, so this wants all 655.
 *   tier 2 (depth)    — the full page set for a sample. Needed for parser
 *                       invariants and cross-source consistency, which
 *                       require the actual tables.
 *
 *   RUN_CORPUS=1 CORPUS_TARGETS=<targets.json> CORPUS_DIR=<dir> \
 *   CORPUS_DEPTH=100 npx vitest run tests/__corpus.live.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { extractNavigation } from '@/lib/calicotab/parseNav';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const INTERVAL = Number(process.env.CORPUS_HOST_INTERVAL_MS ?? 400);
const CONC = Number(process.env.CORPUS_CONCURRENCY ?? 24);
const TIMEOUT = Number(process.env.CORPUS_TIMEOUT_MS ?? 20_000);

const chain = new Map<string, Promise<unknown>>();
function perHost<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = chain.get(host) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const out = await fn();
    await new Promise((r) => setTimeout(r, INTERVAL));
    return out;
  });
  chain.set(host, next.catch(() => {}));
  return next as Promise<T>;
}

async function get(url: string): Promise<{ status: number; html: string }> {
  return perHost(new URL(url).host, async () => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: c.signal });
      return { status: res.status, html: await res.text() };
    } catch {
      return { status: 0, html: '' };
    } finally {
      clearTimeout(t);
    }
  });
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

/** Stable, filesystem-safe name for a URL. */
function keyFor(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

type PageRef = { url: string; kind: string; status: number; file: string | null };
type Entry = { root: string; rootStatus: number; pages: PageRef[] };

describe.skipIf(!process.env.RUN_CORPUS)('build real-data corpus', () => {
  it(
    'fetches tournament pages and writes them to disk',
    async () => {
      const dir = process.env.CORPUS_DIR!;
      expect(dir, 'CORPUS_DIR required').toBeTruthy();
      const pagesDir = join(dir, 'pages');
      if (!existsSync(pagesDir)) mkdirSync(pagesDir, { recursive: true });

      const targets: string[] = JSON.parse(readFileSync(process.env.CORPUS_TARGETS!, 'utf-8'));
      const depthN = Number(process.env.CORPUS_DEPTH ?? 100);

      const save = (url: string, html: string) => {
        const file = `${keyFor(url)}.html.gz`;
        writeFileSync(join(pagesDir, file), gzipSync(Buffer.from(html, 'utf-8')));
        return file;
      };

      // The corpus is built in widening passes: tier 1 over every tournament
      // first, then depth over a growing slice of them. Without this, raising
      // CORPUS_DEPTH re-fetches every page an earlier pass already saved —
      // thousands of requests to other people's servers for bytes sitting on
      // our own disk. A cache hit is recorded in index.json exactly as a fresh
      // 200 would be, which is what lets the passes compose.
      // Set CORPUS_REFETCH=1 to ignore the cache and rebuild from the network.
      let hits = 0;
      const fetchOrCached = async (url: string): Promise<{ status: number; file: string | null; html: string }> => {
        const file = `${keyFor(url)}.html.gz`;
        if (!process.env.CORPUS_REFETCH && existsSync(join(pagesDir, file))) {
          hits += 1;
          return { status: 200, file, html: gunzipSync(readFileSync(join(pagesDir, file))).toString('utf-8') };
        }
        const res = await get(url);
        return {
          status: res.status,
          file: res.status === 200 ? save(url, res.html) : null,
          html: res.html,
        };
      };

      let done = 0;
      const entries = await pool(targets, CONC, async (root): Promise<Entry> => {
        const idx = targets.indexOf(root);
        const home = await fetchOrCached(root);
        done += 1;
        if (done % 50 === 0) console.log(`[corpus] ${done}/${targets.length} (cached ${hits})`);
        if (home.status !== 200) return { root, rootStatus: home.status, pages: [] };

        const pages: PageRef[] = [
          { url: root, kind: 'home', status: 200, file: home.file },
        ];

        let nav;
        try {
          nav = extractNavigation(home.html, root);
        } catch {
          return { root, rootStatus: 200, pages };
        }

        // Depth tier: a deterministic slice, so re-runs fetch the same set.
        const wanted: Array<[string, string | null]> = [];
        if (idx >= depthN) {
          // Outside the depth slice there is still one page worth having:
          // /participants/ is what turns the corpus from a pile of tabs into a
          // person index, and at one request per tournament it is affordable
          // where the full depth tier (nine pages each) is not. Answering "who
          // has competed at 50+ tournaments" needs breadth over every
          // tournament, not depth over a hundred of them.
          if (!process.env.CORPUS_PARTICIPANTS) return { root, rootStatus: 200, pages };
          wanted.push(['participants', nav.participants]);
        } else {
          wanted.push(
            ['teamTab', nav.teamTab],
            ['speakerTab', nav.speakerTab],
            ['participants', nav.participants],
            ['motionsTab', nav.motionsTab],
          );
          for (const b of nav.breakTabs.slice(0, 3)) wanted.push(['breakTab', b]);
          // Three results rounds were enough to learn the page shapes; they are
          // not enough for statistics, where seat, win rate and momentum need
          // every round. CORPUS_ROUNDS=all (or a number) widens it; the cache
          // means rounds already on disk are not fetched again.
          const roundCap =
            process.env.CORPUS_ROUNDS === 'all'
              ? Infinity
              : Number(process.env.CORPUS_ROUNDS ?? 3);
          for (const r of nav.resultsRounds.slice(0, roundCap)) wanted.push(['roundResults', r]);
        }

        for (const [kind, u] of wanted) {
          if (!u) continue;
          const res = await fetchOrCached(u);
          pages.push({ url: u, kind, status: res.status, file: res.file });
        }
        return { root, rootStatus: 200, pages };
      });

      // A focused pass (one person's tournaments, say) shares the pages
      // directory with the main corpus but must not overwrite its index —
      // that file is the map from tournaments to the pages on disk, and a
      // 73-entry pass would otherwise erase the record of the other 582.
      const indexName = process.env.CORPUS_INDEX ?? 'index.json';
      writeFileSync(join(dir, indexName), JSON.stringify(entries, null, 1), 'utf-8');
      const saved = entries.reduce((n, e) => n + e.pages.filter((p) => p.file).length, 0);
      console.log(`[corpus] tournaments=${entries.length} pages=${saved} servedFromCache=${hits}`);
      expect(saved).toBeGreaterThan(0);
    },
    Number(process.env.CORPUS_TIMEOUT_TOTAL_MS ?? 5_400_000),
  );
});
