import { describe, expect, it } from 'vitest';
import {
  compareToBaseline,
  countByRule,
  presetRuleIds,
  // @ts-expect-error plain .mjs script, no type declarations
} from '../scripts/ratchet-type-aware.mjs';

type Counts = Record<string, number>;
type Row = { rule: string; count: number; baseline: number; status: string };
const compare = compareToBaseline as (
  c: Counts,
  b: Counts,
) => { rows: Row[]; failed: boolean; total: number; baselineTotal: number };
const count = countByRule as (r: unknown[], ids: Set<string>) => Counts;
const ids = presetRuleIds as (c: { rules?: Record<string, unknown> }[]) => Set<string>;

describe('presetRuleIds', () => {
  it('collects rule ids across configs, ignoring configs without rules', () => {
    const s = ids([{}, { rules: { a: 'warn', b: 'off' } }, { rules: { b: 'warn', c: 'warn' } }]);
    expect([...s].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('countByRule', () => {
  it('counts only the wanted rules and skips null ruleIds', () => {
    const results = [
      { messages: [{ ruleId: 'a' }, { ruleId: 'a' }, { ruleId: 'other' }, { ruleId: null }] },
      { messages: [{ ruleId: 'b' }] },
      {},
    ];
    expect(count(results, new Set(['a', 'b']))).toEqual({ a: 2, b: 1 });
  });
});

describe('compareToBaseline', () => {
  it('passes when equal or lower, flags lower as under', () => {
    const r = compare({ a: 3, b: 1 }, { a: 3, b: 2 });
    expect(r.failed).toBe(false);
    expect(r.rows.map((x) => x.status)).toEqual(['ok', 'under']);
    expect(r.total).toBe(4);
    expect(r.baselineTotal).toBe(5);
  });
  it('fails when any rule goes up', () => {
    const r = compare({ a: 4 }, { a: 3 });
    expect(r.failed).toBe(true);
    expect(r.rows[0].status).toBe('over');
  });
  it('treats a rule missing from the baseline as 0, so a new hit fails', () => {
    const r = compare({ a: 1, newRule: 1 }, { a: 1 });
    expect(r.failed).toBe(true);
    expect(r.rows.find((x) => x.rule === 'newRule')).toMatchObject({ baseline: 0, status: 'over' });
  });
  it('a baseline rule that now has no hits counts as 0 (under)', () => {
    const r = compare({}, { a: 2 });
    expect(r.failed).toBe(false);
    expect(r.rows[0]).toMatchObject({ count: 0, status: 'under' });
  });
});
