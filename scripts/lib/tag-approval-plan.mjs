// Pure planning logic for scripts/approve-tag-proposals.mjs: no database, no
// filesystem, so Vitest can cover it (tests/scripts.tagApprovalPlan.test.ts).
//
// The semantics mirror lib/tags/approve.ts approveProposalTx: approving a
// proposal writes its value through to the canonical column and also
// approves every other PENDING proposal with the same value for the same
// target. Proposals with a DIFFERENT value for the same target stay pending
// for a human. The bulk script only approves targets where the pending
// proposals all agree on one value; a target with two or more pending values
// is a conflict and is left entirely pending (the one-at-a-time route would
// have approved them in creation order, last write winning, which is exactly
// the judgement call a human should make).

/**
 * The three tag kinds and where an approved value lands. Identifiers are
 * fixed here and never taken from input, so they are safe to splice into SQL.
 *
 * `targetSql` matches a TagProposal row `p` to the canonical target of a
 * batch row `a`: a region is about a tournament (and region proposals carry
 * no motion), a motion tag is about one motion.
 */
export const TAG_KINDS = {
  region: {
    table: '"Tournament"',
    column: 'region',
    joinSql: 'c.id = a."tournamentId"',
    targetSql: 'p."tournamentId" = a."tournamentId" AND p."motionId" IS NULL',
  },
  motion_type: {
    table: '"Motion"',
    column: '"motionType"',
    joinSql: 'c.id = a."motionId"',
    targetSql: 'p."motionId" = a."motionId"',
  },
  motion_topic: {
    table: '"Motion"',
    column: 'topic',
    joinSql: 'c.id = a."motionId"',
    targetSql: 'p."motionId" = a."motionId"',
  },
};

export const KIND_NAMES = Object.keys(TAG_KINDS);

/** Parse argv. Throws on an unknown flag or kind so a typo never means "all kinds". */
export function parseArgs(argv) {
  const opts = { apply: false, kind: null, out: './tag-approval-output', batch: 2000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--kind') opts.kind = argv[++i] ?? '';
    else if (a === '--out') opts.out = argv[++i] ?? '';
    else if (a === '--batch') opts.batch = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (opts.kind !== null && !KIND_NAMES.includes(opts.kind)) {
    throw new Error(`--kind must be one of ${KIND_NAMES.join(', ')}`);
  }
  if (!opts.out) throw new Error('--out needs a directory');
  if (!Number.isInteger(opts.batch) || opts.batch < 1 || opts.batch > 10000) {
    throw new Error('--batch must be a whole number between 1 and 10000');
  }
  return opts;
}

/**
 * Group pending proposals by canonical target and classify each target.
 *
 * Input rows are one per (kind, tournamentId, motionId, value) among PENDING
 * proposals, with the number of proposals `n` and the target's current
 * canonical value `current` (null when unset). Ids are strings (BigInt
 * columns are stringified by the caller).
 *
 * Returns:
 *   agreed    one entry per target whose pending proposals name one value
 *   conflicts one entry per target with two or more pending values
 *   malformed one entry per target the bulk path will not touch (a region
 *             proposal carrying a motion id, a motion proposal without one,
 *             or one motion's proposals naming different tournaments)
 *   ignored   number of proposals of a kind this script does not know
 */
export function classifyPending(rows) {
  const targets = new Map();
  let ignored = 0;
  for (const r of rows) {
    if (!TAG_KINDS[r.kind]) {
      ignored += r.n;
      continue;
    }
    const { key, reason } = targetKey(r);
    let t = targets.get(key);
    if (!t) {
      t = {
        kind: r.kind,
        motionId: r.motionId ?? null,
        tournamentIds: new Set(),
        tournamentName: r.tournamentName ?? null,
        current: r.current ?? null,
        values: new Map(),
        reason,
      };
      targets.set(key, t);
    }
    t.tournamentIds.add(r.tournamentId);
    t.values.set(r.value, (t.values.get(r.value) ?? 0) + r.n);
  }

  const plan = { agreed: [], conflicts: [], malformed: [], ignored };
  for (const t of targets.values()) placeTarget(t, plan);
  const order = (x, y) =>
    x.kind.localeCompare(y.kind) ||
    compareIds(x.tournamentId, y.tournamentId) ||
    compareIds(x.motionId ?? '', y.motionId ?? '');
  plan.agreed.sort(order);
  plan.conflicts.sort(order);
  plan.malformed.sort(order);
  return plan;
}

/**
 * The canonical target a grouped row is about: a region is about a
 * tournament, a motion tag about one motion. Rows that do not fit their
 * kind's shape get a key of their own and a reason, so they never merge
 * into a well-formed target.
 */
function targetKey(r) {
  if (r.kind === 'region') {
    return r.motionId == null
      ? { key: `region|t:${r.tournamentId}`, reason: null }
      : { key: `region|t:${r.tournamentId}|m:${r.motionId}`, reason: 'region proposal carries a motion id' };
  }
  return r.motionId == null
    ? { key: `${r.kind}|t:${r.tournamentId}|no-motion`, reason: 'motion proposal has no motion id' }
    : { key: `${r.kind}|m:${r.motionId}`, reason: null };
}

/** Put one accumulated target into agreed, conflicts or malformed. */
function placeTarget(t, plan) {
  const values = [...t.values.entries()]
    .map(([value, n]) => ({ value, n }))
    .sort((x, y) => y.n - x.n || x.value.localeCompare(y.value));
  const tournamentIds = [...t.tournamentIds].sort(compareIds);
  const reason =
    t.reason ?? (tournamentIds.length > 1 ? 'proposals for this motion name different tournaments' : null);
  const base = {
    kind: t.kind,
    tournamentId: tournamentIds[0],
    tournamentName: t.tournamentName,
    motionId: t.motionId,
    current: t.current,
    proposals: values.reduce((s, v) => s + v.n, 0),
  };
  if (reason) plan.malformed.push({ ...base, tournamentIds, values, reason });
  else if (values.length === 1) plan.agreed.push({ ...base, value: values[0].value });
  else plan.conflicts.push({ ...base, values });
}

function compareIds(a, b) {
  // Numeric ids as strings: shorter is smaller, then lexical.
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Per-kind counts for the dry-run report. */
export function summarisePlan(plan) {
  const byKind = {};
  for (const k of KIND_NAMES) {
    byKind[k] = {
      agreedTargets: 0,
      agreedProposals: 0,
      wouldSet: 0,
      wouldOverwrite: 0,
      alreadyEqual: 0,
      conflictTargets: 0,
      conflictProposals: 0,
      malformedTargets: 0,
      malformedProposals: 0,
    };
  }
  for (const a of plan.agreed) {
    const s = byKind[a.kind];
    s.agreedTargets += 1;
    s.agreedProposals += a.proposals;
    if (a.current == null) s.wouldSet += 1;
    else if (a.current === a.value) s.alreadyEqual += 1;
    else s.wouldOverwrite += 1;
  }
  for (const c of plan.conflicts) {
    byKind[c.kind].conflictTargets += 1;
    byKind[c.kind].conflictProposals += c.proposals;
  }
  for (const m of plan.malformed) {
    byKind[m.kind].malformedTargets += 1;
    byKind[m.kind].malformedProposals += m.proposals;
  }
  return byKind;
}

/** Split an array into consecutive chunks of at most `size`. */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The batch statement for one kind. Parameters:
 *   $1 text[] tournament ids, $2 text[] motion ids ('' for none),
 *   $3 text[] values, $4 kind, $5 ISO timestamp for reviewedAt.
 *
 * One statement, so one implicit transaction: the canonical write and the
 * proposal approvals land together or not at all. The `agreed` CTE re-checks
 * agreement against live data, so a proposal with a different value filed
 * after the plan was made turns that target back into a conflict and it is
 * skipped rather than overwritten. Approved rows stop matching
 * `status = 'pending'`, which is what makes a re-run a no-op.
 *
 * Writes only TagProposal.status / reviewedAt and the kind's canonical column.
 * (approveProposalTx goes through Prisma, which also bumps
 * Tournament.updatedAt for region and clears adminNote on the proposal it
 * was called with; neither happens here, by design.)
 */
export function buildApplySql(kind) {
  const spec = TAG_KINDS[kind];
  if (!spec) throw new Error(`Unknown tag kind: ${kind}`);
  return `
WITH batch AS (
  SELECT b.tid::bigint AS "tournamentId", NULLIF(b.mid, '')::bigint AS "motionId", b.val AS value
  FROM unnest($1::text[], $2::text[], $3::text[]) AS b(tid, mid, val)
), agreed AS MATERIALIZED (
  SELECT a.* FROM batch a
  WHERE EXISTS (
      SELECT 1 FROM "TagProposal" p
      WHERE p.status = 'pending' AND p.kind = $4 AND ${spec.targetSql}
        AND p.value = a.value AND p."tournamentId" = a."tournamentId"
    )
    AND NOT EXISTS (
      SELECT 1 FROM "TagProposal" p
      WHERE p.status = 'pending' AND p.kind = $4 AND ${spec.targetSql}
        AND (p.value <> a.value OR p."tournamentId" <> a."tournamentId")
    )
), canon AS (
  UPDATE ${spec.table} c SET ${spec.column} = a.value
  FROM agreed a
  WHERE ${spec.joinSql}
  RETURNING c.id
), approved AS (
  UPDATE "TagProposal" p SET status = 'approved', "reviewedAt" = ($5::timestamptz AT TIME ZONE 'UTC')
  FROM agreed a
  WHERE p.status = 'pending' AND p.kind = $4 AND ${spec.targetSql}
    AND p.value = a.value AND p."tournamentId" = a."tournamentId"
  RETURNING p.id
)
SELECT
  (SELECT count(*) FROM agreed)::int AS targets,
  (SELECT count(*) FROM canon)::int AS canonical,
  (SELECT count(*) FROM approved)::int AS proposals`;
}

/** The three parallel arrays buildApplySql's $1..$3 expect. */
export function batchParams(targets) {
  return [
    targets.map((t) => String(t.tournamentId)),
    targets.map((t) => (t.motionId == null ? '' : String(t.motionId))),
    targets.map((t) => t.value),
  ];
}

/** One RFC 4180 CSV field. */
export function csvField(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(fields) {
  return fields.map(csvField).join(',') + '\n';
}

/** Rows for the conflicts CSV: conflicts first, then targets the bulk path skipped as malformed. */
export function conflictCsv(plan) {
  let out = csvLine(['kind', 'tournament_id', 'tournament_name', 'motion_id', 'current_value', 'pending_values', 'pending_proposals', 'note']);
  const fmt = (values) => values.map((v) => `${v.value} (${v.n})`).join(' | ');
  for (const c of plan.conflicts) {
    out += csvLine([c.kind, c.tournamentId, c.tournamentName, c.motionId, c.current, fmt(c.values), c.proposals, 'conflict']);
  }
  for (const m of plan.malformed) {
    out += csvLine([m.kind, m.tournamentIds.join(' | '), m.tournamentName, m.motionId, m.current, fmt(m.values), m.proposals, m.reason]);
  }
  return out;
}

/** Rows for the before-snapshot CSV: what each canonical column held before this run wrote it. */
export function beforeCsv(agreed) {
  let out = csvLine(['kind', 'tournament_id', 'motion_id', 'previous_value', 'new_value']);
  for (const a of agreed) out += csvLine([a.kind, a.tournamentId, a.motionId, a.current, a.value]);
  return out;
}
