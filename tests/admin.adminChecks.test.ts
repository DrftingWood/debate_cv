import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task R1: "Mark checked". The fingerprint decides when a mark lapses, and
// the store is read and written through raw SQL (the shared generated client
// may not know AdminCheck yet). The database here is a small in-memory fake
// that understands the three statements adminChecks.ts sends, so the
// round trip mark → marksFor → undo is exercised end to end.

type Row = {
  kind: string;
  subject: string;
  fingerprint: string;
  note: string | null;
  checkedBy: string;
  checkedAt: Date;
};
type Sql = { sql: string; values: unknown[] };

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  db: { $executeRaw: vi.fn(), $queryRaw: vi.fn(), $transaction: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: h.db }));

const { fingerprintOf, markChecked, undoMark, marksFor } = await import('@/lib/admin/adminChecks');

function execute(q: Sql): number {
  const sql = q.sql.trim();
  if (sql.startsWith('INSERT')) {
    const [kind, subject, fingerprint, note, checkedBy] = q.values as [
      string,
      string,
      string,
      string | null,
      string,
    ];
    h.rows = h.rows.filter((r) => !(r.kind === kind && r.subject === subject));
    h.rows.push({ kind, subject, fingerprint, note, checkedBy, checkedAt: new Date() });
    return 1;
  }
  if (sql.startsWith('DELETE')) {
    const [kind, subject] = q.values as [string, string];
    const before = h.rows.length;
    h.rows = h.rows.filter((r) => !(r.kind === kind && r.subject === subject));
    return before - h.rows.length;
  }
  throw new Error(`unexpected statement: ${sql}`);
}

beforeEach(() => {
  h.rows = [];
  h.db.$executeRaw.mockReset().mockImplementation(async (q: Sql) => execute(q));
  h.db.$queryRaw.mockReset().mockImplementation(async (q: Sql) => {
    const [kind, ...subjects] = q.values as string[];
    return h.rows.filter((r) => r.kind === kind && subjects.includes(r.subject));
  });
  h.db.$transaction
    .mockReset()
    .mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

describe('fingerprintOf', () => {
  it('is a stable 16-character sha1 prefix, and changes with the detail', () => {
    const a = fingerprintOf('check', { status: 'fail', detail: 'Round 3 has 11 rooms of 12.' });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintOf('check', { status: 'fail', detail: 'Round 3 has 11 rooms of 12.' })).toBe(
      a,
    );
    expect(
      fingerprintOf('check', { status: 'fail', detail: 'Round 3 has 10 rooms of 12.' }),
    ).not.toBe(a);
    expect(
      fingerprintOf('check', { status: 'warn', detail: 'Round 3 has 11 rooms of 12.' }),
    ).not.toBe(a);
  });

  it('import: category and attempts; report: status', () => {
    const imp = fingerprintOf('import', { errorCategory: 'http_5xx', attempts: 3 });
    expect(fingerprintOf('import', { errorCategory: 'http_5xx', attempts: 3 })).toBe(imp);
    expect(fingerprintOf('import', { errorCategory: 'http_5xx', attempts: 4 })).not.toBe(imp);
    expect(fingerprintOf('report', { status: 'open' })).not.toBe(
      fingerprintOf('report', { status: 'acknowledged' }),
    );
  });

  it('parser: only the count bucket (1, 2–5, 6–20, 21+) matters', () => {
    const fp = (count: number) => fingerprintOf('parser', { count });
    expect(fp(2)).toBe(fp(5));
    expect(fp(6)).toBe(fp(20));
    expect(fp(21)).toBe(fp(400));
    expect(new Set([fp(1), fp(2), fp(6), fp(21)]).size).toBe(4);
  });
});

describe('markChecked, marksFor, undoMark', () => {
  it('mark then marksFor returns it, and undo removes it', async () => {
    const fingerprint = fingerprintOf('check', { status: 'fail', detail: 'd' });
    await markChecked({
      kind: 'check',
      subject: '5:panels',
      fingerprint,
      note: 'two-judge panels are right here',
      by: 'admin@example.com',
    });
    const marks = await marksFor('check', ['5:panels', '6:panels']);
    expect([...marks.keys()]).toEqual(['5:panels']);
    expect(marks.get('5:panels')).toMatchObject({
      fingerprint,
      checkedBy: 'admin@example.com',
      note: 'two-judge panels are right here',
    });
    expect(marks.get('5:panels')?.checkedAt).toBeInstanceOf(Date);

    await undoMark('check', '5:panels');
    expect((await marksFor('check', ['5:panels'])).size).toBe(0);
  });

  it('a second mark of the same subject replaces the first (upsert)', async () => {
    await markChecked({ kind: 'check', subject: '5:panels', fingerprint: 'a'.repeat(16), by: 'x' });
    await markChecked({ kind: 'check', subject: '5:panels', fingerprint: 'b'.repeat(16), by: 'y' });
    expect(h.rows).toHaveLength(1);
    const insert = h.db.$executeRaw.mock.calls[0][0] as Sql;
    expect(insert.sql).toMatch(/ON CONFLICT \("kind", "subject"\) DO UPDATE/);
    expect((await marksFor('check', ['5:panels'])).get('5:panels')).toMatchObject({
      fingerprint: 'b'.repeat(16),
      checkedBy: 'y',
      note: null,
    });
  });

  it('marks are per kind, and an empty subject list asks nothing', async () => {
    await markChecked({ kind: 'report', subject: '5', fingerprint: 'c'.repeat(16), by: 'x' });
    expect((await marksFor('check', ['5'])).size).toBe(0);
    h.db.$queryRaw.mockClear();
    expect((await marksFor('check', [])).size).toBe(0);
    expect(h.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('values travel as parameters, never inside the SQL text', async () => {
    const subject = `5:x'); DROP TABLE "AdminCheck"; --`;
    await markChecked({ kind: 'check', subject, fingerprint: 'd'.repeat(16), by: 'x' });
    const insert = h.db.$executeRaw.mock.calls[0][0] as Sql;
    expect(insert.sql).not.toContain('DROP');
    expect(insert.values).toContain(subject);
  });
});

describe('marksFor on a database without the AdminCheck table', () => {
  // Preview builds skip migrations and dev databases lag: a missing table
  // means no mark can exist, so audits must carry on with none.
  const missing = (wrapped: boolean) =>
    wrapped
      ? Object.assign(new Error('Raw query failed. Code: `42P01`.'), {
          code: 'P2010',
          meta: { code: '42P01', message: 'relation "AdminCheck" does not exist' },
        })
      : Object.assign(new Error('relation "AdminCheck" does not exist'), { code: '42P01' });

  it('answers no marks, warning once per process, for both error shapes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.db.$queryRaw.mockRejectedValueOnce(missing(true)).mockRejectedValueOnce(missing(false));
    expect((await marksFor('check', ['5:panels'])).size).toBe(0);
    expect((await marksFor('check', ['5:panels'])).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('reads the Prisma 7 pg-adapter shape: the database code sits under meta.driverAdapterError.cause', async () => {
    // Observed against Postgres 17 through @prisma/adapter-pg (R7): code P2010,
    // and meta has no `code` at all. The message text is not relied on here.
    const err = Object.assign(new Error('Raw query failed.'), {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: { originalCode: '42P01', kind: 'TableDoesNotExist', table: 'AdminCheck' },
        },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.db.$queryRaw.mockRejectedValueOnce(err);
    expect((await marksFor('check', ['5:panels'])).size).toBe(0);
    warn.mockRestore();
  });

  it('rethrows any other failure', async () => {
    h.db.$queryRaw.mockRejectedValueOnce(new Error('connection reset'));
    await expect(marksFor('check', ['5:panels'])).rejects.toThrow('connection reset');
  });
});
