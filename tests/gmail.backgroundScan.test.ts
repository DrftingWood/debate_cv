import { describe, expect, it, vi } from 'vitest';
import { scanDueMailboxes, type BackgroundScanDeps } from '@/lib/gmail/backgroundScan';

const OPTS = { intervalMs: 30 * 60_000, maxUsers: 2, budgetMs: 10_000 };

function deps(over: Partial<BackgroundScanDeps> = {}): BackgroundScanDeps & {
  scan: ReturnType<typeof vi.fn>;
  forgetGrant: ReturnType<typeof vi.fn>;
  markAttempted: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  findDue: ReturnType<typeof vi.fn>;
} {
  return {
    findDue: vi.fn(async () => ['u1', 'u2']),
    scan: vi.fn(async () => ({ total: 3 })),
    isGrantGone: () => false,
    forgetGrant: vi.fn(async () => {}),
    markAttempted: vi.fn(async () => {}),
    onError: vi.fn(),
    ...over,
  } as never;
}

describe('scanDueMailboxes', () => {
  it('asks for users not scanned since one interval ago, limited to maxUsers', async () => {
    const d = deps({ now: () => 1_000_000_000 });
    await scanDueMailboxes(d, OPTS);
    expect(d.findDue).toHaveBeenCalledWith(new Date(1_000_000_000 - OPTS.intervalMs), 2);
  });

  it('scans each due user and totals what it found', async () => {
    const d = deps();
    const report = await scanDueMailboxes(d, OPTS);
    expect(d.scan.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2']);
    expect(report).toMatchObject({
      scanned: 2,
      urlsFound: 6,
      grantsCleared: 0,
      failed: 0,
      stoppedForBudget: false,
    });
  });

  it('clears a revoked Google grant quietly and carries on with the next user', async () => {
    const gone = new Error('invalid_grant');
    const d = deps({
      scan: vi.fn(async (id: string) => {
        if (id === 'u1') throw gone;
        return { total: 1 };
      }),
      isGrantGone: (e) => e === gone,
    });
    const report = await scanDueMailboxes(d, OPTS);
    expect(d.forgetGrant).toHaveBeenCalledWith('u1');
    expect(d.onError).not.toHaveBeenCalled();
    expect(d.markAttempted).not.toHaveBeenCalled();
    expect(report).toMatchObject({ scanned: 1, grantsCleared: 1, failed: 0 });
  });

  it('reports any other failure, stamps the user so it waits an interval, and carries on', async () => {
    const boom = new Error('gmail 500');
    const d = deps({
      scan: vi.fn(async (id: string) => {
        if (id === 'u1') throw boom;
        return { total: 1 };
      }),
    });
    const report = await scanDueMailboxes(d, OPTS);
    expect(d.onError).toHaveBeenCalledWith(boom, 'u1');
    expect(d.markAttempted).toHaveBeenCalledWith('u1');
    expect(report).toMatchObject({ scanned: 1, failed: 1 });
  });

  it('survives forgetGrant and markAttempted failing', async () => {
    const gone = new Error('invalid_grant');
    const d = deps({
      scan: vi.fn(async () => {
        throw gone;
      }),
      isGrantGone: () => true,
      forgetGrant: vi.fn(async () => {
        throw new Error('db');
      }),
    });
    await expect(scanDueMailboxes(d, OPTS)).resolves.toMatchObject({ grantsCleared: 2 });
  });

  it('does not start a scan once the budget is spent and says so', async () => {
    let t = 0;
    const d = deps({
      now: () => t,
      scan: vi.fn(async () => {
        t += 11_000; // the first scan uses up the whole budget
        return { total: 0 };
      }),
    });
    const report = await scanDueMailboxes(d, OPTS);
    expect(d.scan).toHaveBeenCalledTimes(1);
    expect(report.stoppedForBudget).toBe(true);
  });

  it('does nothing when nobody is due', async () => {
    const d = deps({ findDue: vi.fn(async () => []) });
    const report = await scanDueMailboxes(d, OPTS);
    expect(d.scan).not.toHaveBeenCalled();
    expect(report).toEqual({
      scanned: 0,
      urlsFound: 0,
      grantsCleared: 0,
      failed: 0,
      stoppedForBudget: false,
    });
  });
});
