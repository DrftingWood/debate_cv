import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditInputs } from '@/lib/audit/auditInputs';

// Task R1: a check the admin marked checked counts as a pass when runAudit
// scores, as long as the mark's fingerprint still matches what the check
// says now. A re-scrape that changes the finding changes the fingerprint,
// and the mark lapses: the check fails again.

const h = vi.hoisted(() => ({
  load: vi.fn(),
  marksFor: vi.fn(),
  db: {
    tournament: { findMany: vi.fn() },
    tournamentAudit: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/audit/load', () => ({ loadAuditInputs: h.load }));
vi.mock('@/lib/db', () => ({ prisma: h.db }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/admin/adminChecks', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/adminChecks')>()),
  marksFor: h.marksFor,
}));

const { runAudit, runAuditReport } = await import('@/lib/audit/run');
const { runChecks } = await import('@/lib/audit/checks');
const { fingerprintOf } = await import('@/lib/admin/adminChecks');
const { PARSER_VERSION } = await import('@/lib/calicotab/version');

type Loaded = AuditInputs & { usersAffected: number };

// A tournament whose stored parse is from an older parser: parser_stale
// fails, which is a small, self-contained failing check to mark.
const one: Loaded = {
  format: 'BP',
  prelimRoundCount: 1,
  parserVersion: '1',
  teamTab: [],
  roundRows: [],
  outrounds: [],
  breakRows: [],
  speakersByTeam: {},
  redactedByTeam: {},
  speakerParticipants: 0,
  speakersWithScores: 0,
  judgeParticipants: 0,
  roundResultJudges: 0,
  judgesByRound: {},
  motionRounds: [],
  pieces: [],
  openReports: [],
  usersAffected: 0,
};

const raw = runChecks(one, PARSER_VERSION);
const target = raw.find((c) => c.status === 'fail');
if (!target) throw new Error('fixture has no failing check');
const subject = `5:${target.code}`;
const checkedAt = new Date('2026-10-31T12:00:00Z');

type Upsert = {
  update: { score: number; checks: Array<Record<string, unknown>> };
};
const written = () => h.db.tournamentAudit.upsert.mock.calls[0][0] as Upsert;
const stored = () => written().update.checks.find((c) => c.code === target.code);

async function auditWith(marks: Map<string, unknown>) {
  h.marksFor.mockResolvedValue(marks);
  await runAudit([5n]);
  return written().update.score;
}

beforeEach(() => {
  h.load.mockReset().mockResolvedValue(new Map([[5n, one]]));
  h.marksFor.mockReset();
  h.db.tournamentAudit.upsert.mockReset().mockImplementation((args: unknown) => args);
  h.db.$transaction.mockReset().mockImplementation(async (ops: unknown[]) => ops);
});

describe('runAudit with marks', () => {
  it('asks for the marks of the non-passing checks, keyed <tournamentId>:<code>', async () => {
    await auditWith(new Map());
    const [kind, subjects] = h.marksFor.mock.calls[0];
    expect(kind).toBe('check');
    expect(subjects).toContain(subject);
    const passing = raw.filter((c) => c.status === 'pass').map((c) => `5:${c.code}`);
    for (const p of passing) expect(subjects).not.toContain(p);
  });

  it('a matching mark turns the fail into a pass and the score rises', async () => {
    const before = await auditWith(new Map());
    expect(stored()).toMatchObject({ status: 'fail' });
    expect(stored()).not.toHaveProperty('checkedBy');

    h.db.tournamentAudit.upsert.mockClear();
    const fingerprint = fingerprintOf('check', { status: target.status, detail: target.detail });
    const after = await auditWith(
      new Map([[subject, { fingerprint, checkedBy: 'owner@example.com', checkedAt, note: null }]]),
    );
    expect(after).toBeGreaterThan(before);
    expect(stored()).toMatchObject({
      status: 'pass',
      detail: `Checked by owner on 31 Oct 2026. Was: ${target.detail}`,
      checkedBy: 'owner@example.com',
      checkedAt: checkedAt.toISOString(),
      wasStatus: 'fail',
    });
  });

  it('runAuditReport names the marks that took effect, and only those', async () => {
    const fingerprint = fingerprintOf('check', { status: target.status, detail: target.detail });
    const mark = { fingerprint, checkedBy: 'o@x', checkedAt, note: null };
    const other = raw.find((c) => c.status === 'fail' && c.code !== target.code);
    const marks = new Map([[subject, mark]]);
    if (other) marks.set(`5:${other.code}`, { ...mark, fingerprint: 'f'.repeat(16) });
    h.marksFor.mockResolvedValue(marks);
    const report = await runAuditReport([5n]);
    expect(report.audited).toBe(1);
    expect([...report.applied]).toEqual([subject]);
  });

  it('a mismatched fingerprint (the data changed) leaves the fail', async () => {
    const before = await auditWith(new Map());
    h.db.tournamentAudit.upsert.mockClear();
    const stale = fingerprintOf('check', { status: 'fail', detail: 'an older finding' });
    const after = await auditWith(
      new Map([
        [subject, { fingerprint: stale, checkedBy: 'owner@example.com', checkedAt, note: null }],
      ]),
    );
    expect(after).toBe(before);
    expect(stored()).toMatchObject({ status: 'fail', detail: target.detail });
    expect(stored()).not.toHaveProperty('checkedBy');
  });
});

describe('parseChecks reads the mark back', () => {
  it('keeps checkedBy and checkedAt, and ignores junk in them', async () => {
    const { parseChecks } = await import('@/lib/admin/accuracy');
    const [marked, junk] = parseChecks([
      {
        code: 'panels',
        status: 'pass',
        detail: 'Checked by owner on 31 Oct 2026. Was: x',
        pieces: [],
        checkedBy: 'owner@example.com',
        checkedAt: checkedAt.toISOString(),
        wasStatus: 'warn',
      },
      {
        code: 'panels',
        status: 'fail',
        detail: 'x',
        pieces: [],
        checkedBy: 7,
        checkedAt: 'nope',
        wasStatus: 'pass',
      },
    ]);
    expect(marked).toMatchObject({ checkedBy: 'owner@example.com', checkedAt, wasStatus: 'warn' });
    expect(junk?.checkedBy).toBeUndefined();
    expect(junk?.checkedAt).toBeUndefined();
    expect(junk?.wasStatus).toBeUndefined();
  });
});
