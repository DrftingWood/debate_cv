/**
 * Parser soak: run the public-page parsers against many real Tabbycat
 * installs and record where they throw or come back empty.
 *
 * The unit suite feeds the parsers synthetic HTML; this feeds them the
 * live web. Tabbycat installs span many years and versions, so the
 * interesting signal is the tail — pages that parse to zero rows, or
 * blow up, on a shape no fixture covers.
 *
 * Skipped by default (network, slow). Run explicitly:
 *
 *   RUN_PARSER_SOAK=1 SOAK_TARGETS=<path to targets.json> \
 *   SOAK_LIMIT=25 SOAK_OUT=<path to report.json> \
 *   npx vitest run tests/__parsersoak.live.test.ts
 *
 * Throwaway harness, like __smoke.live.test.ts — the leading underscore
 * marks it as non-CI infrastructure. It does NOT use
 * fetchHtmlWithProvenance: that writes a SourceDocument row per fetch,
 * and this is a parser test, not a fetch-layer or database test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { extractNavigation } from '@/lib/calicotab/parseNav';
import {
  extractVueData,
  parseTeamTab,
  parseSpeakerTab,
  parseBreakPage,
  parseParticipantsList,
  parseRoundResults,
} from '@/lib/calicotab/parseTabs';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// 1500ms mirrors lib/calicotab/fetch.ts, but that figure is tuned for
// ingesting one tournament repeatedly in production. A sweep touches each
// host ~6 times in total and never twice at once, so the per-host interval
// is not what protects these servers — the tiny per-host request count is.
const MIN_HOST_INTERVAL_MS = Number(process.env.SOAK_HOST_INTERVAL_MS ?? 400);
const CONCURRENCY = Number(process.env.SOAK_CONCURRENCY ?? 24);
const REQ_TIMEOUT_MS = Number(process.env.SOAK_TIMEOUT_MS ?? 20_000);

/** Per-host politeness: never two in-flight requests to one host, and
 *  never closer together than MIN_HOST_INTERVAL_MS. */
const hostChain = new Map<string, Promise<unknown>>();
function perHost<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostChain.get(host) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const out = await fn();
      await new Promise((r) => setTimeout(r, MIN_HOST_INTERVAL_MS));
      return out;
    });
  hostChain.set(
    host,
    next.catch(() => {}),
  );
  return next as Promise<T>;
}

type Fetched = { ok: boolean; status: number; html: string; error?: string };

async function getHtml(url: string): Promise<Fetched> {
  const host = new URL(url).host;
  return perHost(host, async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, signal: ctrl.signal });
      const html = await res.text();
      return { ok: res.ok, status: res.status, html };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        html: '',
        error: err instanceof Error ? err.message.slice(0, 200) : 'fetch error',
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

type ParseOutcome = {
  page: string;
  url: string;
  status: number;
  bytes: number;
  rows: number | null;
  vueTables: number | null;
  threw: string | null;
};

/** Run one parser over one page, capturing a throw as data rather than
 *  letting it abort the sweep. */
async function probe(
  page: string,
  url: string,
  parse: (html: string, url: string) => number,
): Promise<ParseOutcome> {
  const f = await getHtml(url);
  if (!f.ok) {
    return {
      page,
      url,
      status: f.status,
      bytes: 0,
      rows: null,
      vueTables: null,
      threw: f.error ?? null,
    };
  }
  let vueTables: number | null = null;
  try {
    vueTables = extractVueData(f.html)?.length ?? 0;
  } catch {
    vueTables = -1;
  }
  try {
    return {
      page,
      url,
      status: f.status,
      bytes: f.html.length,
      rows: parse(f.html, url),
      vueTables,
      threw: null,
    };
  } catch (err) {
    return {
      page,
      url,
      status: f.status,
      bytes: f.html.length,
      rows: null,
      vueTables,
      threw: err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : String(err),
    };
  }
}

type TournamentReport = {
  root: string;
  rootStatus: number;
  navDiscovered: string[];
  navConstructed: string[];
  navThrew: string | null;
  breakTabsTotal: number;
  breakTabsBracket: number;
  pages: ParseOutcome[];
};

async function soakOne(root: string): Promise<TournamentReport> {
  const rep: TournamentReport = {
    root,
    rootStatus: 0,
    navDiscovered: [],
    navConstructed: [],
    navThrew: null,
    breakTabsTotal: 0,
    breakTabsBracket: 0,
    pages: [],
  };

  const home = await getHtml(root);
  rep.rootStatus = home.status;
  if (!home.ok) return rep;

  let nav;
  try {
    nav = extractNavigation(home.html, root);
    rep.navDiscovered = nav.meta.discovered;
    rep.navConstructed = nav.meta.constructed;
  } catch (err) {
    rep.navThrew = err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : String(err);
    return rep;
  }

  // parseBreakPage only understands /break/teams/<cat>/ and
  // /break/adjudicators/. extractNavigation also collects
  // /break/bracket/<cat>/ (a Vue bracket diagram with no table), which
  // ingest then fetches for nothing — count those separately rather than
  // spending the parse probe on them.
  const realBreakTabs = nav.breakTabs.filter((u) => !/\/break\/bracket\//i.test(u));
  rep.breakTabsTotal = nav.breakTabs.length;
  // Counted off the raw homepage rather than off nav: the fix removes these
  // from nav.breakTabs, and this is the number that says how many needless
  // fetches per tournament the fix saves.
  rep.breakTabsBracket = new Set(
    (home.html.match(/href="[^"]*\/break\/bracket\/[^"]*"/gi) ?? []).map((h) => h.toLowerCase()),
  ).size;

  const jobs: Array<Promise<ParseOutcome>> = [];
  if (nav.teamTab) jobs.push(probe('teamTab', nav.teamTab, (h) => parseTeamTab(h).length));
  if (nav.speakerTab) jobs.push(probe('speakerTab', nav.speakerTab, (h) => parseSpeakerTab(h).length));
  if (nav.participants)
    jobs.push(probe('participants', nav.participants, (h) => parseParticipantsList(h).length));
  for (const b of realBreakTabs.slice(0, 2))
    jobs.push(probe('breakTab', b, (h, u) => parseBreakPage(h, u).length));
  for (const r of nav.resultsRounds.slice(0, 2))
    jobs.push(
      probe('roundResults', r, (h, u) => {
        const d = parseRoundResults(h, u, nav.resultsRoundLabels[u] ?? null);
        return d.teamResults.length + d.judgeAssignments.length;
      }),
    );

  rep.pages = await Promise.all(jobs);
  return rep;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

describe.skipIf(!process.env.RUN_PARSER_SOAK)('parser soak against live Tabbycat installs', () => {
  it(
    'parses public tab pages across many tournaments',
    async () => {
      const targetsPath = process.env.SOAK_TARGETS;
      expect(targetsPath, 'SOAK_TARGETS must point at a JSON array of tournament roots').toBeTruthy();
      const all: string[] = JSON.parse(readFileSync(targetsPath!, 'utf-8'));
      const offset = Number(process.env.SOAK_OFFSET ?? 0);
      const limit = Number(process.env.SOAK_LIMIT ?? all.length);
      const targets = all.slice(offset, offset + limit);

      let done = 0;
      const reports = await pool(targets, CONCURRENCY, async (root) => {
        const r = await soakOne(root);
        done += 1;
        if (done % 10 === 0 || done === targets.length) {
          console.log(`[soak] ${done}/${targets.length}`);
        }
        return r;
      });

      const out = process.env.SOAK_OUT;
      if (out) writeFileSync(out, JSON.stringify(reports, null, 1), 'utf-8');

      // The sweep itself must complete; per-page failures are the payload,
      // not a reason to fail the run.
      expect(reports.length).toBe(targets.length);
    },
    Number(process.env.SOAK_TEST_TIMEOUT_MS ?? 3_600_000),
  );
});
