import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Regression guard: a 'use client' module must not transitively import a
 * server-only module, or Next bundles it (Prisma, googleapis...) for the
 * browser and the page dies at runtime ("sqltag is unable to run in this
 * browser environment"). Unit tests run in Node and never notice, so this
 * walks the import graph statically. Traversal stops at 'use server' files:
 * Server Actions are legitimately importable from client components.
 */
const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['components', 'app', 'lib'];
const SERVER_ONLY = [
  '@/lib/db',
  '@prisma/client',
  '@/lib/rateLimit',
  'googleapis',
  'next/server',
  '@/lib/queue',
  '@/lib/auth',
];
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '.next') sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function startsWithDirective(src: string, directive: string): boolean {
  const head = src.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  return new RegExp(`^['"]${directive}['"]`).test(head);
}

/** Value imports/re-exports only; `import type` / `export type` are erased. */
function valueSpecifiers(src: string): string[] {
  const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) if (!m[1]) out.push(m[2]);
  return out;
}

function resolveLocal(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const e of ['', ...EXTS]) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const isServerOnly = (spec: string) =>
  SERVER_ONLY.some((s) => spec === s || spec.startsWith(`${s}/`));

function findViolations(): string[] {
  const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/');
  const all = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)));
  const clients = all.filter((f) => startsWithDirective(readFileSync(f, 'utf8'), 'use client'));
  const violations: string[] = [];
  for (const client of clients) {
    const seen = new Set<string>();
    const stack: Array<[string, string[]]> = [[client, [rel(client)]]];
    while (stack.length) {
      const [file, chain] = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      if (file !== client && startsWithDirective(src, 'use server')) continue;
      for (const spec of valueSpecifiers(src)) {
        const next = resolveLocal(spec, file);
        // A Server Action is a valid client import; its body never ships.
        if (next && startsWithDirective(readFileSync(next, 'utf8'), 'use server')) continue;
        if (isServerOnly(spec)) {
          violations.push([...chain, spec].join(' -> '));
          continue;
        }
        if (next) stack.push([next, [...chain, rel(next)]]);
      }
    }
  }
  return violations;
}

describe('client bundle boundary', () => {
  it("no 'use client' module reaches a server-only module", () => {
    const violations = findViolations();
    expect(
      violations,
      `Client components must not import server modules (they get bundled for the browser):\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
