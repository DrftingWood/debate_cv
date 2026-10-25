import { describe, expect, it } from 'vitest';
import { writeReserveMs } from '@/lib/calicotab/ingest';

// Production write times (2026-10-25 Re-ingest all, `[ingest] write phase`):
// [participants, teams, measured writeMs]. The reserve must cover each with
// margin, or a tournament that passes the check is killed mid-write.
const MEASURED: Array<[number, number, number]> = [
  [60, 25, 1_800], [91, 29, 2_100], [125, 26, 3_400], [137, 31, 4_400],
  [146, 53, 5_000], [194, 43, 3_200], [211, 58, 5_300], [244, 87, 5_600],
  [273, 94, 5_800], [242, 94, 6_600], [274, 94, 8_500], [436, 192, 11_000],
  [1_062, 379, 18_094], // WUDC 2022, ingested successfully with a flat 15 s reserve
];

describe('writeReserveMs', () => {
  it('covers every measured production write', () => {
    for (const [p, t, ms] of MEASURED) {
      expect(writeReserveMs(p, t, undefined)).toBeGreaterThanOrEqual(ms);
    }
  });

  it('admits WUDC 2022, which works today: its ~23 s fetch leaves ~32 s of the 55 s deadline', () => {
    const reserve = writeReserveMs(1_062, 379, undefined);
    expect(reserve).toBeLessThan(55_000 - 23_000);
    // …and still covers its 18.1 s write with margin.
    expect(reserve).toBeGreaterThanOrEqual(18_094 * 1.25);
  });

  it('small tournaments reserve little', () => {
    expect(writeReserveMs(60, 25, undefined)).toBeLessThan(6_000);
  });

  it('unknown sizes fall back to the fixed base', () => {
    expect(writeReserveMs(null, null, undefined)).toBe(4_000);
  });

  it('INGEST_WRITE_RESERVE_MS overrides with a fixed value; junk is ignored', () => {
    expect(writeReserveMs(812, 300, '10000')).toBe(10_000);
    expect(writeReserveMs(812, 300, '0')).toBe(0);
    expect(writeReserveMs(60, 25, 'abc')).toBe(writeReserveMs(60, 25, undefined));
    expect(writeReserveMs(60, 25, '')).toBe(writeReserveMs(60, 25, undefined));
  });
});
