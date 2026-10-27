/**
 * Live survey for the TABBYCAT_API_ROUNDS decision (B8 enablement): across
 * many public tournaments, which linked pages the API path would serve and
 * which it would hand back to HTML, and why — without fetching the HTML
 * pages themselves. No database.
 *
 *   RUN_API_COVERAGE=1 API_COVERAGE_URLS=<file, one tournament base URL per line> \
 *   API_COVERAGE_REPORT=<out.json> npx vitest run tests/__apiCoverage.live.test.ts
 *
 * Requests are spaced 1.5 s apart, gentler than ingest's per-host floor.
 */
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { extractNavigation } from '@/lib/calicotab/parseNav';
import { fetchTabsFromApi } from '@/lib/calicotab/tabbycatApi';
import { fetchRestFromApi } from '@/lib/calicotab/tabbycatApiRounds';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.runIf(process.env.RUN_API_COVERAGE === '1')('tabbycat API coverage', () => {
  it(
    'surveys',
    async () => {
      const urls = readFileSync(process.env.API_COVERAGE_URLS!, 'utf8')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const report: unknown[] = [];
      for (const base of urls) {
        let requests = 0;
        const fetcher = async (u: string) => {
          await sleep(1_500);
          requests++;
          return fetch(u, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
          });
        };
        try {
          const landing = await fetcher(base).then((r) => (r.ok ? r.text() : null));
          if (!landing) {
            report.push({ base, error: 'landing not fetched' });
            continue;
          }
          const nav = extractNavigation(landing, base);
          const before = requests;
          const tabs = await fetchTabsFromApi(base, fetcher);
          const tabRequests = requests - before;
          const rest = await fetchRestFromApi(base, nav, fetcher);
          const restRequests = requests - before - tabRequests;
          const reasons = (xs: Iterable<{ source: string; reason?: string }>) => {
            const m: Record<string, number> = {};
            for (const x of xs) {
              const k =
                x.source === 'api'
                  ? 'api'
                  : `${x.source}: ${(x.reason ?? '').replace(/round \d+|\d+ drawn/g, 'N')}`;
              m[k] = (m[k] ?? 0) + 1;
            }
            return m;
          };
          report.push({
            base,
            nav: {
              rounds: nav.resultsRounds.length,
              breaks: nav.breakTabs.length,
              participants: !!nav.participants,
            },
            tabs: { teams: tabs.teams.source, speakers: tabs.speakers.source },
            rounds: reasons(rest.rounds.values()),
            breaks: reasons(rest.breaks.values()),
            participants: rest.participants ? reasons([rest.participants]) : null,
            requests: { tabs: tabRequests, rest: restRequests },
          });
        } catch (err) {
          report.push({ base, error: (err as Error).message.slice(0, 200) });
        }
        writeFileSync(process.env.API_COVERAGE_REPORT!, JSON.stringify(report, null, 1));
      }
    },
    4 * 60 * 60 * 1000,
  );
});
