// Which tournaments would a phase-7 identity re-ingest change? Read-only and
// offline: it reads the pages exported by scripts/export-source-documents.mjs
// and runs the ingest parsers over them. No database, no network, no
// connection string.
//
//   node scripts/find-identity-affected-tournaments.mjs --in "$HOME/Documents/source-docs"
//
// Options:
//   --in <dir>     the export folder (index.jsonl + *.html.gz).
//                  Default: <home>/Documents/source-docs
//   --out <file>   the CSV. Default: <in>/identity-affected-tournaments.csv
//   --list <file>  affected tournament URLs, one per line (the re-ingest input).
//                  Default: <in>/identity-affected-tournaments.txt
//
// Both outputs default to the export folder, outside the repository: they
// hold participants' names, which are public tab data but have no business in
// git. What is counted, and why: lib/identity/affectedTournaments.ts. How to
// act on the result: docs/runbooks/identity-affected-tournaments.md.
//
// The parsers are TypeScript. This loads them through Vite (already installed
// with Vitest) with the repo's @/ alias, the same way the test suite does, so
// no build step and no new dependency.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
if (args.includes('--help') || args.includes('-h')) {
  console.log('node scripts/find-identity-affected-tournaments.mjs [--in <export dir>] [--out <csv>] [--list <txt>]');
  process.exit(0);
}

const inDir = resolve(value('--in', join(homedir(), 'Documents', 'source-docs')));
const outCsv = resolve(value('--out', join(inDir, 'identity-affected-tournaments.csv')));
const outList = resolve(value('--list', join(inDir, 'identity-affected-tournaments.txt')));
const indexPath = join(inDir, 'index.jsonl');
if (!existsSync(indexPath)) {
  console.error(`No index.jsonl in ${inDir}. Pass the export folder with --in.`);
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createServer } = await import('vite');
const vite = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const m = await vite.ssrLoadModule('/lib/identity/affectedTournaments.ts');

  const entries = [];
  let badLines = 0;
  for (const line of readFileSync(indexPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      badLines += 1;
    }
  }
  const tournaments = m.groupByTournament(entries);
  const read = (entry) => gunzipSync(readFileSync(join(inDir, entry.file))).toString('utf8');

  const reports = [];
  let done = 0;
  for (const t of tournaments) {
    const pagesRead = Object.keys(t.docs).sort();
    let findings = { emptyKeyNames: [], sharedKeys: [] };
    let error;
    try {
      findings = m.findIdentityIssues(m.parseTournamentDocuments(t.docs, read));
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 200) : String(e);
    }
    reports.push({ base: t.base, host: t.host, slug: t.slug, pagesRead, findings, error });
    done += 1;
    if (done % 25 === 0) process.stdout.write(`\rread ${done} of ${tournaments.length} tournaments`);
  }

  // A byte-order mark so Excel and Windows PowerShell 5.1 read the non-Latin
  // names as UTF-8 rather than the ANSI code page.
  writeFileSync(outCsv, '﻿' + m.toCsv(reports));
  writeFileSync(outList, m.affectedList(reports) + '\n');
  const s = m.summarise(reports);
  const u = m.exportUrlStats(entries, tournaments);
  const t = (x) => `${x.tournaments} tournaments, ${x.groups} groups`;
  // Printed only, never written to a file: the runbook explains each line.
  console.log(`\n
Documents in index:              ${u.documents}${badLines ? ` (${badLines} unreadable lines skipped)` : ''}
  distinct document URLs:        ${u.distinctUrls}
Tournament URLs with a tab page: ${u.tournamentUrls} (on ${u.hosts} hosts)
  slug case and http/https folded: ${u.foldedUrls}
  of which API-only next to a root-hosted tab: ${u.rootApiSplits} (so about ${u.foldedUrls - u.rootApiSplits} tournaments)
  These count tournament addresses in the export, not rows in "Tournament";
  see the runbook, "Why the export total is not the Tournament count".

Tournaments with a tab page:     ${s.tournaments}
Affected (a or real collision):  ${s.affected} of ${s.tournaments}   (union; each tournament counted once)
  (a) names with an empty key:   ${s.withEmptyKey} tournaments, ${s.emptyKeyNames} names
  (b) shared key in one list:    ${t({ tournaments: s.withSharedKey, groups: s.sharedKeyGroups })}
      real collisions (same-role or cross-role): ${s.withCollision} tournaments
      same-role:                 ${t(s.sameRole)}   (same role, different team or institution; counted)
      cross-role:                ${t(s.crossRole)}   (speaker and judge: two people, never one; counted)
        same institution:        ${t(s.crossRoleSameInstitution)}   (eyeball these: the only case where one person is plausible)
        different institution:   ${t(s.crossRoleDifferentInstitution)}
        institution unknown:     ${t(s.crossRoleUnknownInstitution)}   (one side names no institution)
      duplicate rows:            ${t(s.duplicate)}   (same role, same team and institution; not counted)
  judge role dropped by the participants merge: ${t(s.judgeRoleDropped)} (how a cross-role collision shows today; same cause, already in Affected)
Tournaments that failed to parse: ${s.errors}

CSV:  ${outCsv}
List: ${outList}`);
} finally {
  await vite.close();
}
