import { describe, it, expect } from 'vitest';
import { __test__ } from '@/lib/calicotab/parseTabs';

const { findBalancedJsRegion } = __test__;

describe('findBalancedJsRegion — locates the end of a balanced JS region', () => {
  it('empty object literal', () => {
    expect(findBalancedJsRegion('{}')).toBe(2);
  });

  it('empty array literal', () => {
    expect(findBalancedJsRegion('[]')).toBe(2);
  });

  it('object with content', () => {
    expect(findBalancedJsRegion('{a:1}')).toBe(5);
  });

  it('nested object containing an array', () => {
    expect(findBalancedJsRegion('{a:[1,2]}')).toBe(9);
  });

  it('double-quoted string containing a brace is opaque', () => {
    // The `}` inside "x}y" must NOT decrement depth. Final close is at position 8.
    expect(findBalancedJsRegion('{a:"x}y"}')).toBe(9);
  });

  it('escaped quote inside a string does not close the string early', () => {
    // The `\"` is a literal quote inside the string, so `"x\"y"` is one string.
    expect(findBalancedJsRegion('{a:"x\\"y"}')).toBe(10);
  });

  it('unbalanced input — missing close brace returns -1', () => {
    expect(findBalancedJsRegion('{a:1')).toBe(-1);
  });

  it('empty input returns -1', () => {
    expect(findBalancedJsRegion('')).toBe(-1);
  });

  it('whitespace-only input returns -1', () => {
    expect(findBalancedJsRegion('   ')).toBe(-1);
  });
});
