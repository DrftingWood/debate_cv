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
import { gzipSync } from 'node:zlib';
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

      let done = 0;
      const entries = await pool(targets, CONC, async (root): Promise<Entry> => {
        const idx = targets.indexOf(root);
        const home = await get(root);
        done += 1;
        if (done % 50 === 0) console.log(`[corpus] ${done}/${targets.length}`);
        if (home.status !== 200) return { root, rootStatus: home.status, pages: [] };

        const pages: PageRef[] = [
          { url: root, kind: 'home', status: 200, file: save(root, home.html) },
        ];

        // Depth tier: a deterministic slice, so re-runs fetch the same set.
        if (idx >= depthN) return { root, rootStatus: 200, pages };

        let nav;
        try {
          nav = extractNavigation(home.html, root);
        } catch {
          return { root, rootStatus: 200, pages };
        }
        const wanted: Array<[string, string | null]> = [
          ['teamTab', nav.teamTab],
          ['speakerTab', nav.speakerTab],
          ['participants', nav.participants],
          ['motionsTab', nav.motionsTab],
        ];
        for (const b of nav.breakTabs.slice(0, 3)) wanted.push(['breakTab', b]);
        for (const r of nav.resultsRounds.slice(0, 3)) wanted.push(['roundResults', r]);

        for (const [kind, u] of wanted) {
          if (!u) continue;
          const res = await get(u);
          pages.push({
            url: u,
            kind,
            status: res.status,
            file: res.status === 200 ? save(u, res.html) : null,
          });
        }
        return { root, rootStatus: 200, pages };
      });

      writeFileSync(join(dir, 'index.json'), JSON.stringify(entries, null, 1), 'utf-8');
      const saved = entries.reduce((n, e) => n + e.pages.filter((p) => p.file).length, 0);
      console.log(`[corpus] tournaments=${entries.length} savedPages=${saved}`);
      expect(saved).toBeGreaterThan(0);
    },
    Number(process.env.CORPUS_TIMEOUT_TOTAL_MS ?? 5_400_000),
  );
});
