import { describe, it, expect } from 'vitest';
import { parseJsValue } from '@/lib/calicotab/parseJsValue';

describe('parseJsValue — accepts pure data shapes', () => {
  it('empty object and array literals', () => {
    expect(parseJsValue('{}')).toEqual({});
    expect(parseJsValue('[]')).toEqual([]);
  });

  it('JSON-style object with quoted keys', () => {
    expect(parseJsValue('{ "a": 1 }')).toEqual({ a: 1 });
  });

  it('unquoted keys (the documented Tabbycat case)', () => {
    expect(parseJsValue('{ a: 1, b: "two" }')).toEqual({ a: 1, b: 'two' });
  });

  it('single-quoted string values', () => {
    expect(parseJsValue("{ a: 'two' }")).toEqual({ a: 'two' });
  });

  it('array of primitives', () => {
    expect(parseJsValue('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('primitives null / true / false', () => {
    expect(parseJsValue('{ x: null, y: true, z: false }')).toEqual({ x: null, y: true, z: false });
  });

  it('nested objects and arrays', () => {
    expect(parseJsValue('{ rows: [{ a: 1 }, { a: 2 }] }')).toEqual({ rows: [{ a: 1 }, { a: 2 }] });
  });

  it('numbers — integer, float, negative, explicit positive', () => {
    expect(parseJsValue('[1, 3.14, -3.14, +5]')).toEqual([1, 3.14, -3.14, 5]);
  });

  it('strings with embedded escapes and quotes', () => {
    expect(parseJsValue('{ a: "he said \\"hi\\"" }')).toEqual({ a: 'he said "hi"' });
  });

  it('undefined → undefined', () => {
    expect(parseJsValue('{ a: undefined }')).toEqual({ a: undefined });
  });

  it('Infinity → Infinity', () => {
    expect(parseJsValue('{ a: Infinity }')).toEqual({ a: Infinity });
  });

  it('-Infinity → -Infinity', () => {
    expect(parseJsValue('{ a: -Infinity }')).toEqual({ a: -Infinity });
  });

  it('NaN → NaN', () => {
    const out = parseJsValue('{ a: NaN }') as { a: number };
    expect(Number.isNaN(out.a)).toBe(true);
  });

  it('sparse arrays — elided slots become null', () => {
    expect(parseJsValue('[1, , 3]')).toEqual([1, null, 3]);
  });

  it('mixed quoted and unquoted keys', () => {
    expect(parseJsValue('{ a: 1, "b-with-dash": 2 }')).toEqual({ a: 1, 'b-with-dash': 2 });
  });

  it('trailing commas in objects and arrays', () => {
    expect(parseJsValue('{ a: 1, }')).toEqual({ a: 1 });
    expect(parseJsValue('[1, 2,]')).toEqual([1, 2]);
  });
});

describe('parseJsValue — rejects anything outside the literal allowlist', () => {
  it('rejects function calls', () => {
    expect(() => parseJsValue('foo()')).toThrow();
    expect(() => parseJsValue('JSON.parse("x")')).toThrow();
  });

  it('rejects member access', () => {
    expect(() => parseJsValue('process.env')).toThrow();
    expect(() => parseJsValue('globalThis.x')).toThrow();
  });

  it('rejects template literals', () => {
    expect(() => parseJsValue('`hello ${1}`')).toThrow();
  });

  it('rejects arrow and function expressions', () => {
    expect(() => parseJsValue('() => 1')).toThrow();
    expect(() => parseJsValue('function() { return 1 }')).toThrow();
  });

  it('rejects binary expressions — no constant folding', () => {
    expect(() => parseJsValue('1 + 2')).toThrow();
    expect(() => parseJsValue('"a" + "b"')).toThrow();
  });

  it('rejects logical expressions', () => {
    expect(() => parseJsValue('true && 1')).toThrow();
  });

  it('rejects conditional / ternary', () => {
    // The Identifiers a/b/c also rejected, but the ConditionalExpression
    // is the structural rejection we're pinning here.
    expect(() => parseJsValue('true ? 1 : 2')).toThrow();
  });

  it('rejects spread elements', () => {
    expect(() => parseJsValue('{ ...{ a: 1 } }')).toThrow();
    expect(() => parseJsValue('[...[1, 2]]')).toThrow();
  });

  it('rejects computed object keys', () => {
    expect(() => parseJsValue('{ ["x"]: 1 }')).toThrow();
  });

  it('rejects unknown identifiers (not undefined/Infinity/NaN)', () => {
    expect(() => parseJsValue('{ a: process }')).toThrow();
    expect(() => parseJsValue('foo')).toThrow();
  });

  it('rejects new / class expressions', () => {
    expect(() => parseJsValue('new Map()')).toThrow();
    expect(() => parseJsValue('class X {}')).toThrow();
  });

  it('rejects sequence expressions', () => {
    expect(() => parseJsValue('1, 2')).toThrow();
  });
});

describe('parseJsValue — Tabbycat-shaped integration sanity', () => {
  it('parses a representative window.vueData shape with undefined field', () => {
    const slice = '{ tablesData: [{ head: [{ key: "a" }], data: [[{ text: "x" }]] }], otherField: undefined }';
    expect(parseJsValue(slice)).toEqual({
      tablesData: [{ head: [{ key: 'a' }], data: [[{ text: 'x' }]] }],
      otherField: undefined,
    });
  });
});
