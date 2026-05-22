import { describe, expect, test } from 'vitest';
import { outroundRank, outroundRankStrict } from '@/lib/calicotab/judgeStats';

// These tests pin the unification of the previous INGEST_STAGE_RANK
// (50-110 scale) and outroundRank (50-100 scale) onto a single scale
// (50-100). Ordering must be preserved; specific values are load-bearing
// for the champion-check rewrite in buildCvData.ts.

describe('outroundRankStrict — canonical "label → rank or null" helper', () => {
  test('returns null for missing or non-outround labels', () => {
    expect(outroundRankStrict(null)).toBeNull();
    expect(outroundRankStrict(undefined)).toBeNull();
    expect(outroundRankStrict('')).toBeNull();
    expect(outroundRankStrict('Round 4')).toBeNull();
    expect(outroundRankStrict('1')).toBeNull();
  });

  test('canonical stage values (champion-check anchors)', () => {
    expect(outroundRankStrict('Grand Final')).toBe(100);
    expect(outroundRankStrict('Final')).toBe(95);
    expect(outroundRankStrict('Semifinal')).toBe(90);
    expect(outroundRankStrict('Quarterfinal')).toBe(80);
    expect(outroundRankStrict('Octofinal')).toBe(70);
    expect(outroundRankStrict('Double Octofinals')).toBe(60);
    expect(outroundRankStrict('Triple Octofinals')).toBe(50);
  });

  test('category-prefixed Final equals plain Final under the unified scale', () => {
    // Previously INGEST_STAGE_RANK gave Grand Final a 110-vs-100 gap to
    // distinguish "Open Final" from a tournament's actual GF. classifyOutroundStage
    // already buckets them correctly into final vs grand_final, so the
    // headroom gap isn't load-bearing.
    expect(outroundRankStrict('Novice Final')).toBe(95);
    expect(outroundRankStrict('ESL Final')).toBe(95);
    expect(outroundRankStrict('Open Final')).toBe(95);
    expect(outroundRankStrict('Open Grand Final')).toBe(100);
    // Stage-specific patterns still beat the bare-final fallthrough.
    expect(outroundRankStrict('Novice Quarterfinals')).toBe(80);
    expect(outroundRankStrict('ESL Semifinals')).toBe(90);
  });

  test('agrees with outroundRank when label classifies', () => {
    // Sanity check: the strict variant returns the same value as the
    // structured outroundRank for any classifiable label.
    const labels = ['Grand Final', 'Final', 'Semifinal', 'Quarterfinal', 'Octofinal'];
    for (const label of labels) {
      const strict = outroundRankStrict(label);
      const structured = outroundRank({ roundLabel: label, roundNumber: null, isOutround: true });
      expect(strict).toBe(structured);
    }
  });
});

describe('outroundRank — champion-check semantics (load-bearing for buildCvData.ts:507 rewrite)', () => {
  const finalRank = outroundRank({ roundLabel: 'Final', roundNumber: null, isOutround: true });

  test('a participant whose deepest outround is "Final" is at the champion threshold', () => {
    const deepest = outroundRank({ roundLabel: 'Final', roundNumber: null, isOutround: true });
    expect(deepest >= finalRank).toBe(true);
  });

  test('a participant whose deepest outround is "Grand Final" is also at the champion threshold', () => {
    const deepest = outroundRank({ roundLabel: 'Grand Final', roundNumber: null, isOutround: true });
    expect(deepest >= finalRank).toBe(true);
  });

  test('a participant whose deepest outround is "Semifinal" is NOT at the champion threshold', () => {
    const deepest = outroundRank({ roundLabel: 'Semifinal', roundNumber: null, isOutround: true });
    expect(deepest >= finalRank).toBe(false);
  });

  test('category-prefixed Final is also at the threshold', () => {
    const deepest = outroundRank({ roundLabel: 'ESL Final', roundNumber: null, isOutround: true });
    expect(deepest >= finalRank).toBe(true);
  });
});
