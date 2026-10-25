/**
 * Filters a tab-separated "name<TAB>count" list through the repo's own
 * stand-in detector, so a shortlist of prolific people cannot be polluted by
 * "Speaker 1" / "<em>Redacted</em>" / "Swing B" — the shared placeholders that
 * otherwise top every frequency count in the corpus.
 *
 * Reimplementing PLACEHOLDER_NAME_PATTERN in SQL is exactly the mistake the
 * handoff warns about, so this asks names.ts directly. No network, no DB.
 *
 *   RUN_CANDIDATES=1 CANDIDATES_IN=<file.tsv> \
 *   npx vitest run tests/__candidates.live.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPlaceholderPersonName, isRedactedName } from '@/lib/calicotab/names';

describe.skipIf(!process.env.RUN_CANDIDATES)('shortlist real people', () => {
  it('drops stand-ins from the frequency count', () => {
    const lines = readFileSync(process.env.CANDIDATES_IN!, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const kept: Array<[string, number]> = [];
    const dropped: Array<[string, string]> = [];

    for (const line of lines) {
      const [name, count] = line.split('\t');
      if (!name || !count) continue;
      if (isPlaceholderPersonName(name)) dropped.push([name, 'placeholder']);
      else if (isRedactedName(name)) dropped.push([name, 'redacted']);
      else kept.push([name, Number(count)]);
    }

    console.log(`\n[candidates] real people over the threshold: ${kept.length}`);
    for (const [n, c] of kept) console.log(`  ${String(c).padStart(4)}  ${n}`);
    console.log(`\n[candidates] stand-ins dropped: ${dropped.length}`);
    for (const [n, why] of dropped) console.log(`        ${n}  (${why})`);

    expect(kept.length).toBeGreaterThan(0);
  });
});
