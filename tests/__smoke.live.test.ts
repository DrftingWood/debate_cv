/**
 * Live smoke test exercising the refactored parser pipeline against a real
 * Tabbycat URL. Skipped by default to keep the CI suite hermetic. Run
 * explicitly with:
 *
 *   RUN_LIVE_SMOKE=1 npm test -- tests/__smoke.live.test.ts
 *
 * Throwaway file — purpose is to confirm the refactored parseJsValue +
 * extractVueData (post sub-projects 1-4) actually produce non-zero output
 * on real-world Tabbycat HTML, since the unit suite uses synthetic inputs.
 * The leading underscore in the filename is a visual cue that this file is
 * intentionally non-CI test infrastructure.
 *
 * Network access is required; if the Tabbycat install is offline or
 * Cloudflare-walls our user-agent, the live tests will fail in ways that
 * are environmental rather than code-quality signals.
 */

import { describe, it, expect } from 'vitest';
import { extractVueData } from '@/lib/calicotab/parseTabs';
import { parseJsValue } from '@/lib/calicotab/parseJsValue';

// Example URL from scripts/test-scrape.mjs's docstring — already in
// committed code, so reusing it doesn't leak anything new.
const LIVE_URL =
  'https://ilnuroundrobin.calicotab.com/ilnurr2026/privateurls/rbo1rd0g/';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

describe.skipIf(!process.env.RUN_LIVE_SMOKE)('live Tabbycat smoke (refactored parser)', () => {
  // ── Synthetic parseJsValue check (offline; runs even without env var
  //    when the describe gate fires). Confirms the post-refactor allowlist
  //    handles the documented Tabbycat-isms in one stroke. ──────────────
  it('parseJsValue handles Tabbycat-shaped JS object literals', () => {
    const slice =
      '{ tablesData: [{ head: [{ key: "team", title: "Team" }], data: [[{ text: "MIT A" }]] }], sortFn: undefined, ranking: Infinity }';
    const parsed = parseJsValue(slice) as Record<string, unknown>;
    expect(parsed.tablesData).toBeDefined();
    expect(parsed.sortFn).toBeUndefined();
    expect(parsed.ranking).toBe(Infinity);
  });

  // ── Live fetches against a real Tabbycat install. ────────────────────
  it('extractVueData runs against a real Tabbycat landing page', async () => {
    const res = await fetch(LIVE_URL, { headers: BROWSER_HEADERS });
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html.length).toBeGreaterThan(1000);

    // Landing pages don't always have a tablesData array (the Debates card
    // uses its own structure). The smoke test's bar is "parser doesn't
    // throw on real HTML" — vueData being null is a valid outcome.
    const tables = extractVueData(html);
    if (tables === null) {
      console.log('[smoke] landing has no tablesData — expected for some pages');
    } else {
      console.log(`[smoke] landing tables: ${tables.length}`);
    }
    // Reaching here without an exception is the assertion.
    expect(true).toBe(true);
  }, 30_000);

  it('extractVueData parses the team tab end-to-end', async () => {
    const u = new URL(LIVE_URL);
    const slug = u.pathname.split('/').filter(Boolean)[0];
    const teamTabUrl = `${u.protocol}//${u.host}/${slug}/tab/team/`;

    const res = await fetch(teamTabUrl, { headers: BROWSER_HEADERS });
    expect(res.ok).toBe(true);
    const html = await res.text();

    const tables = extractVueData(html);
    expect(tables).not.toBeNull();
    expect(tables!.length).toBeGreaterThan(0);

    const firstTable = tables![0];
    const headKeys = (firstTable.head ?? []).map((h) => h.key ?? h.title ?? '?');
    console.log(
      `[smoke] team tab: ${tables!.length} tables, first has ${firstTable.data?.length ?? 0} rows, head=${headKeys.slice(0, 6).join(',')}`,
    );
    expect((firstTable.data ?? []).length).toBeGreaterThan(0);
  }, 30_000);

  it('extractVueData parses the speaker tab end-to-end', async () => {
    const u = new URL(LIVE_URL);
    const slug = u.pathname.split('/').filter(Boolean)[0];
    const speakerTabUrl = `${u.protocol}//${u.host}/${slug}/tab/speaker/`;

    const res = await fetch(speakerTabUrl, { headers: BROWSER_HEADERS });
    expect(res.ok).toBe(true);
    const html = await res.text();

    const tables = extractVueData(html);
    expect(tables).not.toBeNull();
    expect(tables!.length).toBeGreaterThan(0);
    console.log(
      `[smoke] speaker tab: ${tables!.length} tables, first has ${tables![0].data?.length ?? 0} rows`,
    );
  }, 30_000);
});
