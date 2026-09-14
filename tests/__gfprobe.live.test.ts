/**
 * One-off probe: what does parseRoundResults make of a real GRAND FINAL
 * results page? The offline corpus only holds prelim round pages, so the
 * outround case had to be observed directly.
 *
 *   RUN_GF_PROBE=1 npx vitest run tests/__gfprobe.live.test.ts
 */
import { describe, it } from 'vitest';
import { parseRoundResults } from '@/lib/calicotab/parseTabs';

const URLS = [
  'https://15thiitbombaydebate.calicotab.com/15thiitbombaydebate2023/results/round/10/',
  'https://16thiitbombaydebate.calicotab.com/16thiitb/results/round/11/',
];

describe.skipIf(!process.env.RUN_GF_PROBE)('grand final probe', () => {
  it('reports what the parser extracts from a grand final', async () => {
    for (const url of URLS) {
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
      const d = parseRoundResults(await res.text(), url, null);
      console.log(`\n${url}`);
      console.log(`  roundLabel=${d.roundLabel} isOutround=${d.isOutround}`);
      for (const t of d.teamResults) {
        console.log(`   team=${JSON.stringify(t.teamName)} pos=${JSON.stringify(t.position)} points=${t.points} won=${t.won}`);
      }
      for (const j of d.judgeAssignments.slice(0, 4)) {
        console.log(`   judge=${JSON.stringify(j.personName)} role=${j.panelRole}`);
      }
    }
  }, 120_000);
});
