/**
 * How many tournaments actually yield motions now?
 *
 * The corpus holds /motions/statistics/ pages, because that is what nav
 * resolved to when it was built. This re-fetches the real motions list for
 * the depth-tier tournaments to get a corpus-wide number.
 *
 *   RUN_MOTIONS_SWEEP=1 CORPUS_DIR=<dir> npx vitest run tests/__motionsweep.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMotionsTab } from '@/lib/calicotab/parseMotions';

const DIR = process.env.CORPUS_DIR ?? '';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe.skipIf(!process.env.RUN_MOTIONS_SWEEP || !DIR)('motions sweep', () => {
  it('counts motions across the depth tier', async () => {
    type Entry = { root: string; rootStatus: number; pages: Array<{ kind: string; file: string | null }> };
    const entries: Entry[] = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf-8'));
    const targets = entries
      .filter((e) => e.rootStatus === 200 && e.pages.some((p) => p.kind === 'motionsTab' && p.file))
      .map((e) => `${e.root.replace(/\/$/, '')}/motions/`);

    let ok = 0;
    let withMotions = 0;
    let total = 0;
    let withInfoSlide = 0;
    const labels = new Set<string>();

    let i = 0;
    await Promise.all(
      Array.from({ length: 16 }, async () => {
        for (;;) {
          const k = i++;
          if (k >= targets.length) return;
          const url = targets[k]!;
          try {
            const res = await fetch(url, { headers: HEADERS });
            if (!res.ok) continue;
            ok += 1;
            const rows = parseMotionsTab(await res.text());
            if (rows.length > 0) withMotions += 1;
            total += rows.length;
            for (const r of rows) {
              labels.add(r.roundLabel);
              if (r.infoSlide) withInfoSlide += 1;
            }
          } catch {
            /* a dead host is not what this measures */
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }),
    );

    console.log(`[motions] fetched=${ok}/${targets.length} pagesWithMotions=${withMotions}`);
    console.log(`[motions] motions=${total} withInfoSlide=${withInfoSlide} distinctRoundLabels=${labels.size}`);
    expect(ok).toBeGreaterThan(0);
  }, 900_000);
});
