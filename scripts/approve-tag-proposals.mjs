// Approve the pending tag proposals from a terminal, set-based, without the
// admin page. The page's "approve all" (POST /api/admin/tag-proposals/
// approve-all) caps at 300 per request and runs one transaction per proposal,
// which does not finish over a backlog of ~10k.
//
//   node scripts/approve-tag-proposals.mjs                  # dry run (default): counts only
//   node scripts/approve-tag-proposals.mjs --apply          # perform the writes
//   node scripts/approve-tag-proposals.mjs --kind region    # one kind only (region|motion_type|motion_topic)
//   node scripts/approve-tag-proposals.mjs --out ./tag-approval-output --batch 2000
//
// Runbook: docs/runbooks/approve-tag-proposals.md.
//
// The connection string comes from POSTGRES_URL_NON_POOLING set in the shell,
// or a hidden prompt; .env files are ignored. A pooled string is switched to
// the direct host. It is never printed.
//
// Semantics are those of lib/tags/approve.ts approveProposalTx: the value is
// written through to Tournament.region / Motion.motionType / Motion.topic and
// every pending proposal with that same value for that target is approved.
// Only targets whose pending proposals all agree on ONE value are approved;
// targets with two or more pending values (conflicts) stay pending and are
// listed in <out>/conflicts-<stamp>.csv for a human. Nothing but
// TagProposal.status, TagProposal.reviewedAt and those three columns is
// written. Every proposal approved by one run gets the same reviewedAt (the
// run stamp printed at the start), which is how a run is found again later.
//
// Idempotent and resumable: each batch re-checks agreement against live data
// and only touches rows still pending, so a re-run after an interruption
// picks up where the last one stopped and a second full run changes nothing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveConnectionString } from './lib/neon-connection.mjs';
import {
  KIND_NAMES,
  parseArgs,
  classifyPending,
  summarisePlan,
  chunk,
  buildApplySql,
  batchParams,
  conflictCsv,
  beforeCsv,
} from './lib/tag-approval-plan.mjs';

// Read the shell before the database library loads: importing @prisma/client also
// reads any .env file in the repo into process.env, which must not be used by accident.
const shellUrl = process.env.POSTGRES_URL_NON_POOLING;
const { PrismaClient } = await import('@prisma/client');

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}

const url = await resolveConnectionString(shellUrl);
const prisma = new PrismaClient({ datasources: { db: { url } } });
const kinds = opts.kind ? [opts.kind] : KIND_NAMES;
const out = resolve(opts.out);
const now = new Date();
const runStamp = now.toISOString(); // e.g. 2026-10-27T10:15:00.123Z, the reviewedAt of every row this run approves
const fileStamp = runStamp.replace(/[:.]/g, '-');

async function statusCounts() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT kind, status::text AS status, count(*)::int AS n FROM "TagProposal" GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  return rows;
}

function printStatusCounts(title, rows) {
  console.log(title);
  if (rows.length === 0) console.log('  (no proposals)');
  for (const r of rows) console.log(`  ${r.kind.padEnd(14)} ${r.status.padEnd(9)} ${String(r.n).padStart(7)}`);
}

async function loadPlan() {
  // One row per (target, value) among pending proposals, with the target's
  // current canonical value so the dry run can say how many writes would
  // overwrite an existing tag.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT p.kind,
            p."tournamentId"::text AS "tournamentId",
            p."motionId"::text     AS "motionId",
            p.value,
            count(*)::int          AS n,
            CASE p.kind WHEN 'region' THEN t.region
                        WHEN 'motion_type' THEN m."motionType"
                        WHEN 'motion_topic' THEN m.topic END AS current,
            t.name AS "tournamentName"
       FROM "TagProposal" p
       JOIN "Tournament" t ON t.id = p."tournamentId"
       LEFT JOIN "Motion" m ON m.id = p."motionId"
      WHERE p.status = 'pending' AND p.kind = ANY($1::text[])
      GROUP BY 1, 2, 3, 4, 6, 7`,
    kinds,
  );
  return classifyPending(rows);
}

function printPlan(plan) {
  const s = summarisePlan(plan);
  console.log('\nPending targets');
  for (const k of kinds) {
    const x = s[k];
    console.log(
      `  ${k.padEnd(14)} one value: ${x.agreedTargets} targets (${x.agreedProposals} proposals; ` +
        `${x.wouldSet} unset, ${x.wouldOverwrite} would overwrite a different value, ${x.alreadyEqual} already equal)` +
        ` | conflicts (2+ values): ${x.conflictTargets} targets (${x.conflictProposals} proposals)` +
        (x.malformedTargets ? ` | skipped as malformed: ${x.malformedTargets} targets (${x.malformedProposals} proposals)` : ''),
    );
  }
  if (plan.ignored) console.log(`  (${plan.ignored} pending proposals of other kinds are not touched)`);
}

try {
  printStatusCounts('Proposals by kind and status', await statusCounts());
  const plan = await loadPlan();
  printPlan(plan);

  mkdirSync(out, { recursive: true });
  const conflictsPath = join(out, `conflicts-${fileStamp}.csv`);
  writeFileSync(conflictsPath, conflictCsv(plan));
  console.log(`\nConflicting and skipped targets listed in ${conflictsPath}`);

  if (!opts.apply) {
    console.log('\nDry run: nothing was written to the database. Add --apply to approve the one-value targets.');
  } else {
    // Snapshot what each canonical column held before this run, so a rollback
    // knows what to restore. Written before the first write.
    const beforePath = join(out, `canonical-before-${fileStamp}.csv`);
    writeFileSync(beforePath, beforeCsv(plan.agreed));
    console.log(`Previous canonical values saved to ${beforePath}`);
    console.log(`Run stamp (reviewedAt of every row approved by this run): ${runStamp}\n`);

    const totals = { targets: 0, canonical: 0, proposals: 0, skipped: 0 };
    for (const kind of kinds) {
      const targets = plan.agreed.filter((a) => a.kind === kind);
      if (targets.length === 0) continue;
      const sql = buildApplySql(kind);
      let done = 0;
      for (const part of chunk(targets, opts.batch)) {
        const [r] = await prisma.$transaction(
          (tx) => tx.$queryRawUnsafe(sql, ...batchParams(part), kind, runStamp),
          { timeout: 120_000, maxWait: 10_000 },
        );
        done += part.length;
        totals.targets += r.targets;
        totals.canonical += r.canonical;
        totals.proposals += r.proposals;
        totals.skipped += part.length - r.targets;
        console.log(
          `  ${kind.padEnd(14)} ${done}/${targets.length} targets checked | approved ${r.proposals} proposals on ${r.targets} targets` +
            (part.length - r.targets ? ` | ${part.length - r.targets} skipped (no longer one value, or already done)` : ''),
        );
      }
    }
    console.log(
      `\nApplied. targets ${totals.targets} | canonical rows written ${totals.canonical} | proposals approved ${totals.proposals} | skipped ${totals.skipped}`,
    );
    printStatusCounts('\nProposals by kind and status, after', await statusCounts());
  }
} catch (e) {
  // Prisma's connection errors name the host; strip that and anything that
  // looks like a connection string before printing.
  const { hostname, password } = new URL(url);
  let msg = e instanceof Error ? e.message : String(e);
  msg = msg.replace(/postgres(?:ql)?:\/\/\S+/g, '[connection string]');
  for (const secret of [password, hostname]) if (secret) msg = msg.split(secret).join('[redacted]');
  console.error(`\nStopped: ${msg}`);
  console.error('Approved batches stay approved; run the same command again to continue.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
