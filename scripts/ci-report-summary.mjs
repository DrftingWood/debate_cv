#!/usr/bin/env node
// Turns the report-only checks' raw output in .reports/ into one Markdown
// table (Q1 phase 1b; docs/CI_PLAN-2026-10-27.md). CI appends it to the job
// summary; locally, run the checks and then `node scripts/ci-report-summary.mjs`
// to get the same numbers the baseline doc records.
//
// Every input is optional. A check that did not run, or whose output did not
// parse, shows as "not run" rather than failing this script: the point of the
// report job is that it never blocks a merge, and a missing number is itself
// worth seeing in the summary.

import { existsSync, readFileSync } from 'node:fs';

const DIR = '.reports';

function readJson(name) {
  const p = `${DIR}/${name}`;
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readText(name) {
  const p = `${DIR}/${name}`;
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

const rows = [];

// knip --reporter json: { files: [...]?, issues: [{ file, exports: [...], types: [...], dependencies: [...], ... }] }
const knip = readJson('knip.json');
if (knip) {
  const count = (key) =>
    (knip.issues ?? []).reduce((n, issue) => {
      const v = issue[key];
      if (Array.isArray(v)) return n + v.length;
      if (v && typeof v === 'object') return n + Object.keys(v).length;
      return n;
    }, 0);
  const unusedFiles = Array.isArray(knip.files) ? knip.files.length : count('files');
  rows.push(['knip: unused files', unusedFiles]);
  rows.push(['knip: unused exports', count('exports')]);
  rows.push(['knip: unused exported types', count('types')]);
  rows.push([
    'knip: unused dependencies (prod + dev)',
    count('dependencies') + count('devDependencies'),
  ]);
  rows.push(['knip: unlisted dependencies', count('unlisted')]);
} else rows.push(['knip', 'not run']);

// jscpd json reporter: statistics.total.{percentage, clones, duplicatedLines, lines}
const jscpd = readJson('jscpd/jscpd-report.json');
const total = jscpd?.statistics?.total;
if (total) {
  rows.push([
    'jscpd: duplicated lines',
    `${total.duplicatedLines} of ${total.lines} (${Number(total.percentage).toFixed(2)}%)`,
  ]);
  rows.push(['jscpd: clones', total.clones]);
} else rows.push(['jscpd', 'not run']);

// dependency-cruiser --output-type json: summary.violations[].rule.name
const dep = readJson('depcruise.json');
if (dep?.summary) {
  const byRule = {};
  for (const v of dep.summary.violations ?? [])
    byRule[v.rule.name] = (byRule[v.rule.name] ?? 0) + 1;
  for (const name of ['no-circular', 'no-prisma-outside-lib', 'lib-not-to-app-or-components']) {
    rows.push([`dependency-cruiser: ${name}`, byRule[name] ?? 0]);
  }
} else rows.push(['dependency-cruiser', 'not run']);

// prettier --list-different: one path per line.
const pretty = readText('prettier.txt');
if (pretty !== null) {
  rows.push(['prettier: files not formatted', pretty.split('\n').filter((l) => l.trim()).length]);
} else rows.push(['prettier', 'not run']);

// npm audit --json: metadata.vulnerabilities
const audit = readJson('audit.json');
const vulns = audit?.metadata?.vulnerabilities;
if (vulns) {
  rows.push([
    'npm audit (all deps): critical / high / moderate / low',
    `${vulns.critical} / ${vulns.high} / ${vulns.moderate} / ${vulns.low}`,
  ]);
} else rows.push(['npm audit', 'not run']);

// gitleaks --report-format json: an array of findings (already redacted).
const leaks = readJson('gitleaks.json');
if (Array.isArray(leaks)) rows.push(['gitleaks: findings (history)', leaks.length]);
else rows.push(['gitleaks', 'not run']);

const out = [
  '## Report-only checks',
  '',
  'These never block a merge. Compare with the baseline in `docs/CODE_STANDARDS_BASELINE-2026-10-27.md`: a number above it means this change added to it.',
  '',
  '| Check | Count |',
  '|---|---:|',
  ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  '',
];
console.log(out.join('\n'));
