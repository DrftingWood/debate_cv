/**
 * End-to-end check that the category column survives the parser, against a
 * real speaker tab rather than a fixture.
 *
 *   RUN_CAT_PROBE=1 npx vitest run tests/__catprobe.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parseSpeakerTab } from '@/lib/calicotab/parseTabs';

const DIR = process.env.CORPUS_DIR ?? '';

describe.skipIf(!process.env.RUN_CAT_PROBE || !DIR)('speaker categories on real tabs', () => {
  it('parses categories out of the corpus', () => {
    type Entry = { rootStatus: number; pages: Array<{ url: string; kind: string; file: string | null }> };
    const entries: Entry[] = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf-8'));
    const key = (u: string) => createHash('sha1').update(u).digest('hex').slice(0, 16);

    let pages = 0;
    let withCats = 0;
    let speakersWithCats = 0;
    const seen = new Map<string, number>();

    for (const e of entries) {
      for (const p of e.pages) {
        if (p.kind !== 'speakerTab' || !p.file) continue;
        const f = join(DIR, 'pages', `${key(p.url)}.html.gz`);
        if (!existsSync(f)) continue;
        pages += 1;
        const rows = parseSpeakerTab(gunzipSync(readFileSync(f)).toString('utf-8'));
        const n = rows.filter((r) => r.categories.length > 0).length;
        if (n > 0) withCats += 1;
        speakersWithCats += n;
        for (const r of rows) for (const c of r.categories) seen.set(c, (seen.get(c) ?? 0) + 1);
      }
    }

    console.log(`[cat] speaker tabs=${pages} withCategories=${withCats} speakersTagged=${speakersWithCats}`);
    console.log(
      `[cat] distinct=${seen.size} top=${[...seen.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([c, n]) => `${c}:${n}`)
        .join(', ')}`,
    );
    expect(withCats).toBeGreaterThan(50);
    expect(speakersWithCats).toBeGreaterThan(1000);
  }, 300_000);
});
