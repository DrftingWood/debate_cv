/**
 * Tags the distinct names in a corpus export as stand-in or real, using the
 * repo's own detector.
 *
 * scripts/seed-from-corpus.mjs needs to know which speaker-tab names are
 * shared placeholders ("Speaker 1", "Swing B", "<em>Redacted</em>") so it does
 * not mint a Person for them — the same rule ingest applies. It is a plain
 * .mjs script and cannot import the TypeScript detector, and re-implementing
 * PLACEHOLDER_NAME_PATTERN in a third dialect is exactly what the handoff
 * warns against. So the decision is made here, once, and written to disk.
 *
 *   RUN_TAG_PLACEHOLDERS=1 BUNDLE_IN=<bundle.json> TAG_OUT=<names.json> \
 *   npx vitest run tests/__tagplaceholders.live.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { isPlaceholderPersonName } from '@/lib/calicotab/names';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';

describe.skipIf(!process.env.RUN_TAG_PLACEHOLDERS)('tag stand-in names', () => {
  it('writes the normalized names a seed must not personify', () => {
    const bundle = JSON.parse(readFileSync(process.env.BUNDLE_IN!, 'utf-8'));

    const names = new Set<string>();
    for (const row of bundle.field ?? []) if (row.speaker_name) names.add(row.speaker_name);
    for (const row of bundle.breaks ?? []) if (row.entity_name) names.add(row.entity_name);

    const placeholders = new Set<string>();
    for (const name of names) {
      if (isPlaceholderPersonName(name)) placeholders.add(normalizePersonName(name));
    }

    console.log(`[tag] distinct names   : ${names.size}`);
    console.log(`[tag] stand-in names   : ${placeholders.size}`);

    writeFileSync(process.env.TAG_OUT!, JSON.stringify([...placeholders].sort(), null, 1), 'utf-8');
    expect(names.size).toBeGreaterThan(0);
  });
});
