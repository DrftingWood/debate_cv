/**
 * Offline planner for the person-index pass.
 *
 * Finding a person with 50+ tournaments does not need the full depth tier —
 * it needs one page per tournament: /participants/, which lists every speaker
 * and adjudicator who attended. This reads the homepages already in the corpus,
 * extracts each tournament's participants URL, and reports exactly how many
 * are missing so the networked pass can be sized before it is authorised.
 *
 * No network. Reads the corpus, writes a target list.
 *
 *   RUN_PLAN_INDEX=1 CORPUS_DIR=<dir> PLAN_OUT=<file.json> \
 *   npx vitest run tests/__planindex.live.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { extractNavigation } from '@/lib/calicotab/parseNav';

const DIR = process.env.CORPUS_DIR ?? '';

type PageRef = { url: string; kind: string; status: number; file: string | null };
type Entry = { root: string; rootStatus: number; pages: PageRef[] };

const keyFor = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 16);

describe.skipIf(!process.env.RUN_PLAN_INDEX || !DIR)('plan the person-index pass', () => {
  it('lists the participants pages the corpus is missing', () => {
    const entries: Entry[] = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf-8'));

    let live = 0;
    let noNav = 0;
    let alreadyHave = 0;
    const toFetch: string[] = [];
    const haveFile: string[] = [];

    for (const e of entries) {
      if (e.rootStatus !== 200) continue;
      live += 1;

      // Prefer the participants URL the depth pass already recorded; fall back
      // to re-deriving it from the cached homepage for the tier-1-only slice.
      const recorded = e.pages.find((p) => p.kind === 'participants');
      let url = recorded?.url ?? null;

      if (!url) {
        const homeFile = e.pages.find((p) => p.kind === 'home')?.file;
        if (!homeFile || !existsSync(join(DIR, 'pages', homeFile))) {
          noNav += 1;
          continue;
        }
        try {
          const html = gunzipSync(readFileSync(join(DIR, 'pages', homeFile))).toString('utf-8');
          url = extractNavigation(html, e.root).participants;
        } catch {
          url = null;
        }
      }

      if (!url) {
        noNav += 1;
        continue;
      }

      if (existsSync(join(DIR, 'pages', `${keyFor(url)}.html.gz`))) {
        alreadyHave += 1;
        haveFile.push(url);
      } else {
        toFetch.push(url);
      }
    }

    console.log(`[plan] live tournaments      : ${live}`);
    console.log(`[plan] participants cached   : ${alreadyHave}`);
    console.log(`[plan] participants to fetch : ${toFetch.length}`);
    console.log(`[plan] no participants page  : ${noNav}`);

    if (process.env.PLAN_OUT) {
      writeFileSync(process.env.PLAN_OUT, JSON.stringify(toFetch, null, 1), 'utf-8');
      console.log(`[plan] wrote ${toFetch.length} targets to ${process.env.PLAN_OUT}`);
    }

    expect(live).toBeGreaterThan(0);
  });
});
