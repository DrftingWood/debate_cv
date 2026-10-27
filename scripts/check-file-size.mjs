#!/usr/bin/env node
// File-size gate (docs/CODING_STANDARDS.md ST-1; docs/CI_PLAN-2026-10-27.md).
//
// Blocks NEW or newly-grown source files over 800 lines. It compares the
// branch with its merge base, so existing oversize files do not fail until
// someone makes them bigger:
//
//   - A file ADDED on this branch fails if it has more than LIMIT lines.
//   - A file that already had more than LIMIT lines at the merge base fails if
//     it now has more lines than it did (any growth; shrinking is fine).
//   - A file that crosses LIMIT in this branch (was at or under, now over)
//     fails too.
//   - Escape hatch: an entry in scripts/file-size-allowlist.json with
//     `"allowGrowth": true` and a `growthReason`. The entries there today are the
//     dated inventory of existing oversize files, each with a split note; they
//     are NOT exempt from the growth check. Add allowGrowth only with a reason
//     in the PR body.
//
// Lines are physical lines (what `wc -l` and an editor show), not ESLint's
// counted lines, so the gate is cheap and unambiguous. Generated files,
// lockfiles, migrations, fixtures and docs are not counted (isCountedFile).
//
// Usage:
//   node scripts/check-file-size.mjs              compare HEAD with origin/main
//   node scripts/check-file-size.mjs --base REF   compare with another ref
//   node scripts/check-file-size.mjs --inventory  list every counted file over
//                                                 the limit
// In CI, actions/checkout needs fetch-depth: 0 (the merge base must exist).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIMIT = 800;
export const ALLOWLIST_PATH = 'scripts/file-size-allowlist.json';

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const EXCLUDED = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)\.claude\//,
  /^docs\//,
  /^prisma\/migrations\//,
  /(^|\/)fixtures\//,
  /(^|\/)__fixtures__\//,
  /(^|\/)generated\//,
  /\.generated\./,
  /\.d\.ts$/,
  /\.min\./,
  /(^|\/)package-lock\.json$/,
];

/** True for a path whose line count the gate cares about. */
export function isCountedFile(path) {
  const p = path.split('\\').join('/');
  return SOURCE_EXT.test(p) && !EXCLUDED.some((re) => re.test(p));
}

/** Physical line count; a trailing newline does not add a line. */
export function countLines(text) {
  if (text === '') return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

/**
 * Parse `git diff --name-status -M` output into
 * [{ status: 'A'|'M'|'R', path, oldPath }]. Deleted files are dropped.
 */
export function parseNameStatus(output) {
  const rows = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [code, a, b] = line.split('\t');
    const status = code[0];
    if (status === 'D') continue;
    if (status === 'R') rows.push({ status: 'R', path: b, oldPath: a });
    else if (status === 'C') rows.push({ status: 'A', path: b, oldPath: null });
    else rows.push({ status, path: a, oldPath: status === 'M' ? a : null });
  }
  return rows;
}

/**
 * Decide which changed files break the rule.
 * @param changes  parseNameStatus() rows
 * @param headLines  Map path -> line count on this branch
 * @param baseLines  Map path -> line count at the merge base (keyed by old path)
 * @param allowlist  parsed scripts/file-size-allowlist.json
 * @returns [{ path, kind, lines, baseLines }]
 */
export function findViolations({ changes, headLines, baseLines, allowlist = {}, limit = LIMIT }) {
  const out = [];
  for (const c of changes) {
    if (!isCountedFile(c.path)) continue;
    const lines = headLines.get(c.path);
    if (lines === undefined || lines <= limit) continue;
    const entry = allowlist[c.path];
    if (entry && entry.allowGrowth === true && entry.growthReason) continue;
    const before = c.oldPath ? baseLines.get(c.oldPath) : undefined;
    if (before === undefined) {
      out.push({ path: c.path, kind: 'new file over limit', lines, baseLines: null });
    } else if (before <= limit) {
      out.push({ path: c.path, kind: 'grew past limit', lines, baseLines: before });
    } else if (lines > before) {
      out.push({ path: c.path, kind: 'oversize file grew', lines, baseLines: before });
    }
  }
  return out;
}

/** Allowlist entries must carry a date and a split note; returns problems. */
export function validateAllowlist(allowlist) {
  const problems = [];
  for (const [path, e] of Object.entries(allowlist)) {
    if (!e || typeof e.note !== 'string' || !e.note.trim()) problems.push(`${path}: missing note`);
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '')) problems.push(`${path}: missing date`);
    if (e && e.allowGrowth === true && !e.growthReason)
      problems.push(`${path}: allowGrowth needs growthReason`);
  }
  return problems;
}

// ---- git / filesystem glue (thin; the logic above is what the tests cover) ----

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', '.claude'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function inventory(root) {
  const rows = [];
  for (const f of walk(root, [])) {
    const rel = relative(root, f).split('\\').join('/');
    if (!isCountedFile(rel)) continue;
    const lines = countLines(readFileSync(f, 'utf8'));
    if (lines > LIMIT) rows.push([rel, lines]);
  }
  return rows.sort((a, b) => b[1] - a[1]);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--inventory')) {
    for (const [p, n] of inventory(process.cwd())) console.log(`${String(n).padStart(6)}  ${p}`);
    return 0;
  }
  const bi = argv.indexOf('--base');
  const baseRef = bi >= 0 ? argv[bi + 1] : 'origin/main';
  const allowlist = existsSync(ALLOWLIST_PATH)
    ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
    : {};
  const problems = validateAllowlist(allowlist);
  const mergeBase = git(['merge-base', baseRef, 'HEAD']).trim();
  const changes = parseNameStatus(git(['diff', '--name-status', '-M', `${mergeBase}...HEAD`]));
  const headLines = new Map();
  const baseLines = new Map();
  for (const c of changes) {
    if (!isCountedFile(c.path)) continue;
    headLines.set(c.path, countLines(git(['show', `HEAD:${c.path}`])));
    if (c.oldPath) {
      try {
        baseLines.set(c.oldPath, countLines(git(['show', `${mergeBase}:${c.oldPath}`])));
      } catch {
        /* absent at base: treated as new */
      }
    }
  }
  const violations = findViolations({ changes, headLines, baseLines, allowlist });
  console.log(
    `file-size: ${changes.length} changed files vs ${baseRef} (${mergeBase.slice(0, 8)}), limit ${LIMIT}`,
  );
  for (const p of problems) console.error(`  allowlist problem: ${p}`);
  for (const v of violations) {
    const was = v.baseLines === null ? '' : ` (was ${v.baseLines})`;
    console.error(`  FAIL ${v.path}: ${v.kind}, ${v.lines} lines${was}`);
  }
  if (violations.length || problems.length) {
    console.error(
      `\nFile-size check failed. Split the file, or (for an existing oversize file that must grow) add "allowGrowth": true and a "growthReason" to ${ALLOWLIST_PATH} and explain in the PR body.`,
    );
    return 1;
  }
  console.log('file-size: ok');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
