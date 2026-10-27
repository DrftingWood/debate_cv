#!/usr/bin/env node
// Escape-hatch ratchet (Q1 phase 1; docs/CODE_STANDARDS_BASELINE-2026-10-27.md).
//
// Counts four patterns in the shipped source (app/, lib/, components/ and the
// root .ts files; tests and scripts are out of scope, as in the 2026-10-26
// metrics) and fails if any count is above the committed BASELINE below. It
// is a text scan, not a type-aware lint, so the numbers are approximate in the
// same way the metrics doc's were: comments and simple one-line string
// literals are stripped first, which removes the obvious false positives
// ("any row", "Done!"), and that is all. The point is the trend, and the scan
// is deterministic, so a rise means something new was added.
//
// When a count falls, lower the matching number here in the same PR so the
// ratchet only ever tightens. Raising a number needs a reason in the PR body.
//
// Run with `npm run ratchet`. Deliberately not part of `build`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BASELINE = {
  any: 0,
  asUnknownAs: 7,
  // Wider than the metrics doc's "~35": this pattern also counts `x!}` in JSX
  // and `x!,` arguments. Spot-checked; the hits are real assertions.
  // 75 -> 76 (2026-10-27, Q1 phase 1b): #167 removed two in buildCvData.ts and
  // #168 added three in lib/identity/affectedTournaments.ts, landing on main
  // before CI ran the ratchet. Raised so main is green; those three are the
  // first candidates when this number next falls.
  // 76 -> 73 (2026-10-27): those three are gone (the round-overlap rework of
  // affectedTournaments.ts).
  // 73 -> 72 (2026-10-27): t4 stats-charts UX work removed one more.
  nonNull: 72,
  eslintDisableUnexplained: 2,
};

const ROOT = process.cwd();
const DIRS = ['app', 'lib', 'components'];
const ROOT_FILES = ['middleware.ts', 'instrumentation.ts'];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// Remove block comments, line comments and single-line '...' / "..." strings.
// Template literals are left alone (they can nest code); none of the patterns
// below are likely to appear inside one by accident.
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PATTERNS = {
  // `: any`, `as any`, `<any>`, `any[]`, `Array<any>` and generic args.
  any: /(?::\s*any\b|\bas\s+any\b|<any\b|\bany\[\]|,\s*any\s*>)/g,
  asUnknownAs: /\bas\s+unknown\s+as\b/g,
  // Postfix non-null assertion followed by member access, index, call close,
  // comma, semicolon or closing brace. `!=` / `!==` never match.
  nonNull: /[\w)\]]!(?=[.[),;}])/g,
};

const files = [
  ...DIRS.flatMap((d) => walk(join(ROOT, d), [])),
  ...ROOT_FILES.map((f) => join(ROOT, f)),
];

const counts = { any: 0, asUnknownAs: 0, nonNull: 0, eslintDisableUnexplained: 0 };
const hits = { any: [], asUnknownAs: [], nonNull: [], eslintDisableUnexplained: [] };

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).split('\\').join('/');
  // eslint-disable directives live in comments, so scan the raw text. An
  // explained one carries a ` -- reason` description (ESLint's own syntax).
  raw.split('\n').forEach((line, i) => {
    if (/eslint-disable/.test(line) && !/eslint-disable[^\n]*\s--\s*\S/.test(line)) {
      counts.eslintDisableUnexplained++;
      hits.eslintDisableUnexplained.push(`${rel}:${i + 1}`);
    }
  });
  const code = strip(raw);
  for (const [key, re] of Object.entries(PATTERNS)) {
    for (const m of code.matchAll(re)) {
      counts[key]++;
      const line = code.slice(0, m.index).split('\n').length;
      hits[key].push(`${rel}:${line}`);
    }
  }
}

const verbose = process.argv.includes('--verbose');
let failed = false;
for (const key of Object.keys(BASELINE)) {
  const over = counts[key] > BASELINE[key];
  const under = counts[key] < BASELINE[key];
  if (over) failed = true;
  const note = over ? '  FAIL: above baseline' : under ? '  (below baseline: lower it)' : '';
  console.log(`${key.padEnd(26)} ${String(counts[key]).padStart(4)} / ${BASELINE[key]}${note}`);
  if (verbose || over) for (const h of hits[key]) console.log(`    ${h}`);
}
if (failed) {
  console.error('\nRatchet failed: a new escape hatch was added. Remove it, or explain why in the PR and raise the baseline.');
  process.exit(1);
}
