/**
 * Coverage report for lib/motions/classify.ts over a corpus export's motions.
 * The design bar is ≥ 98 % classified; misses are printed, not hidden, and a
 * few classified motions per type are sampled so precision can be read by eye
 * — a high coverage figure says nothing about whether the labels are right.
 *
 *   RUN_MOTION_CLASS=1 BUNDLE_IN=<bundle.json> \
 *   npx vitest run tests/__motionclass.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyMotion, type MotionClass } from '@/lib/motions/classify';

describe.skipIf(!process.env.RUN_MOTION_CLASS)('motion classifier coverage', () => {
  it('classifies the corpus', () => {
    const bundle = JSON.parse(readFileSync(process.env.BUNDLE_IN!, 'utf-8'));
    const motions = (bundle.motions as Array<{ text: string; info_slide: string | null }>).filter(
      (m) => m.text,
    );
    const byType = new Map<MotionClass, string[]>();
    let context = 0;
    let info = 0;
    for (const m of motions) {
      const c = classifyMotion(m.text, m.info_slide);
      byType.set(c.type, [...(byType.get(c.type) ?? []), m.text]);
      if (c.contextLed) context += 1;
      if (c.infoSlide) info += 1;
    }
    const unclassified = byType.get('Unclassified') ?? [];
    const coverage = 1 - unclassified.length / motions.length;

    console.log(`[motions] ${motions.length} motions, ${(coverage * 100).toFixed(1)} % classified`);
    for (const [t, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`[motions] ${String(list.length).padStart(4)}  ${t}`);
    }
    console.log(`[motions] context-led ${context}, with info slide ${info}`);
    for (const [t, list] of byType) {
      if (t === 'Unclassified') continue;
      const step = Math.max(1, Math.floor(list.length / 4));
      for (let i = 0; i < list.length && i < step * 4; i += step) {
        console.log(`[sample:${t}] ${list[i].replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
    for (const m of unclassified) console.log(`[miss] ${m.replace(/\s+/g, ' ').slice(0, 140)}`);
    expect(coverage).toBeGreaterThanOrEqual(0.98);
  });
});
