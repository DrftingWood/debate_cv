/**
 * Probe: does /motions/ carry what /tab/motions/ used to?
 *
 *   RUN_MOTIONS_PROBE=1 npx vitest run tests/__motionsprobe.live.test.ts
 */
import { describe, it } from 'vitest';
import { parseMotionsTab } from '@/lib/calicotab/parseMotions';

const CASES = [
  'https://mace.calicotab.com/bso2021/motions/',
  'https://mace.calicotab.com/bso2021/motions/statistics/',
  'https://ndsa.calicotab.com/ndo2021/motions/',
  'https://astanaopen.calicotab.com/_/motions/',
];

describe.skipIf(!process.env.RUN_MOTIONS_PROBE)('motions page shape', () => {
  it('parses each candidate URL', async () => {
    for (const url of CASES) {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) {
        console.log(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const rows = parseMotionsTab(html);
      console.log(`\n${url}`);
      console.log(`  bytes=${html.length} motions=${rows.length}`);
      for (const r of rows.slice(0, 3)) {
        console.log(
          `   round=${JSON.stringify(r.roundLabel)} n=${r.roundNumber} seq=${r.seq} text=${JSON.stringify(r.text.slice(0, 70))}`,
        );
      }
    }
  }, 180_000);
});
