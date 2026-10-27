import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no type declarations
import * as mod from '../scripts/check-file-size.mjs';

const { isCountedFile, countLines, parseNameStatus, findViolations, validateAllowlist, LIMIT } =
  mod as {
    isCountedFile: (p: string) => boolean;
    countLines: (t: string) => number;
    parseNameStatus: (o: string) => { status: string; path: string; oldPath: string | null }[];
    findViolations: (a: {
      changes: { status: string; path: string; oldPath: string | null }[];
      headLines: Map<string, number>;
      baseLines: Map<string, number>;
      allowlist?: Record<string, unknown>;
    }) => { path: string; kind: string }[];
    validateAllowlist: (a: Record<string, unknown>) => string[];
    LIMIT: number;
  };

type Change = { status: string; path: string; oldPath: string | null };
const add = (path: string): Change => ({ status: 'A', path, oldPath: null });
const mod_ = (path: string): Change => ({ status: 'M', path, oldPath: path });

describe('isCountedFile', () => {
  it('counts source files', () => {
    expect(isCountedFile('lib/a.ts')).toBe(true);
    expect(isCountedFile('app/(app)/cv/page.tsx')).toBe(true);
    expect(isCountedFile('scripts/x.mjs')).toBe(true);
    expect(isCountedFile('tests/foo.test.ts')).toBe(true);
  });
  it('skips generated, lockfile, migrations, fixtures, docs, declarations', () => {
    expect(isCountedFile('package-lock.json')).toBe(false);
    expect(isCountedFile('prisma/migrations/2026/migration.sql')).toBe(false);
    expect(isCountedFile('tests/fixtures/big.ts')).toBe(false);
    expect(isCountedFile('docs/x.ts')).toBe(false);
    expect(isCountedFile('lib/generated/client.ts')).toBe(false);
    expect(isCountedFile('lib/foo.generated.ts')).toBe(false);
    expect(isCountedFile('next-env.d.ts')).toBe(false);
    expect(isCountedFile('README.md')).toBe(false);
    expect(isCountedFile('node_modules/x/index.js')).toBe(false);
  });
  it('handles backslash paths', () => {
    expect(isCountedFile('tests\\fixtures\\a.ts')).toBe(false);
  });
});

describe('countLines', () => {
  it('ignores one trailing newline', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\n\n')).toBe(2);
  });
});

describe('parseNameStatus', () => {
  it('reads A, M, R and drops D', () => {
    const out = 'A\tlib/a.ts\nM\tlib/b.ts\nD\tlib/c.ts\nR087\tlib/old.ts\tlib/new.ts\n';
    expect(parseNameStatus(out)).toEqual([
      { status: 'A', path: 'lib/a.ts', oldPath: null },
      { status: 'M', path: 'lib/b.ts', oldPath: 'lib/b.ts' },
      { status: 'R', path: 'lib/new.ts', oldPath: 'lib/old.ts' },
    ]);
  });
});

describe('findViolations', () => {
  const run = (
    changes: Change[],
    head: Record<string, number>,
    base: Record<string, number>,
    allowlist: Record<string, unknown> = {},
  ) =>
    findViolations({
      changes,
      headLines: new Map(Object.entries(head)),
      baseLines: new Map(Object.entries(base)),
      allowlist,
    });

  it('limit is 800', () => expect(LIMIT).toBe(800));

  it('fails a new file over 800, passes exactly 800', () => {
    expect(run([add('lib/a.ts')], { 'lib/a.ts': 801 }, {})).toEqual([
      expect.objectContaining({ path: 'lib/a.ts', kind: 'new file over limit' }),
    ]);
    expect(run([add('lib/a.ts')], { 'lib/a.ts': 800 }, {})).toEqual([]);
  });
  it('fails an oversize file that grows by one line', () => {
    const v = run([mod_('lib/b.ts')], { 'lib/b.ts': 1501 }, { 'lib/b.ts': 1500 });
    expect(v).toEqual([expect.objectContaining({ kind: 'oversize file grew' })]);
  });
  it('passes an oversize file that stays the same or shrinks', () => {
    expect(run([mod_('lib/b.ts')], { 'lib/b.ts': 1500 }, { 'lib/b.ts': 1500 })).toEqual([]);
    expect(run([mod_('lib/b.ts')], { 'lib/b.ts': 900 }, { 'lib/b.ts': 1500 })).toEqual([]);
  });
  it('fails a file that crosses the limit', () => {
    const v = run([mod_('lib/c.ts')], { 'lib/c.ts': 805 }, { 'lib/c.ts': 790 });
    expect(v).toEqual([expect.objectContaining({ kind: 'grew past limit' })]);
  });
  it('passes small files and uncounted paths', () => {
    expect(run([add('lib/s.ts')], { 'lib/s.ts': 50 }, {})).toEqual([]);
    expect(run([add('tests/fixtures/big.ts')], { 'tests/fixtures/big.ts': 5000 }, {})).toEqual([]);
  });
  it('a rename keeps the old size as its baseline', () => {
    const rename: Change = { status: 'R', path: 'lib/new.ts', oldPath: 'lib/old.ts' };
    expect(run([rename], { 'lib/new.ts': 1000 }, { 'lib/old.ts': 1000 })).toEqual([]);
    expect(run([rename], { 'lib/new.ts': 1001 }, { 'lib/old.ts': 1000 })).toHaveLength(1);
  });
  it('allowGrowth with a reason waives; without a reason it does not', () => {
    const ch = [mod_('lib/b.ts')];
    const head = { 'lib/b.ts': 1600 };
    const base = { 'lib/b.ts': 1500 };
    expect(
      run(ch, head, base, { 'lib/b.ts': { allowGrowth: true, growthReason: 'hotfix' } }),
    ).toEqual([]);
    expect(run(ch, head, base, { 'lib/b.ts': { allowGrowth: true } })).toHaveLength(1);
    expect(
      run(ch, head, base, { 'lib/b.ts': { note: 'split me', date: '2026-10-27' } }),
    ).toHaveLength(1);
  });
});

describe('validateAllowlist', () => {
  it('requires note and date', () => {
    expect(validateAllowlist({ 'a.ts': { note: 'x', date: '2026-10-27' } })).toEqual([]);
    expect(validateAllowlist({ 'a.ts': {} })).toHaveLength(2);
    expect(
      validateAllowlist({ 'a.ts': { note: 'x', date: '2026-10-27', allowGrowth: true } }),
    ).toHaveLength(1);
  });
});
