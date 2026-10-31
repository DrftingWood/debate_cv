import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task R5: the per-check actions on a tournament's page. A failing or
// warning check gets "Mark checked" (and "Review later"); a check an admin
// vouched for shows who and when beside "Undo". The audit is stored the way
// lib/audit/run.ts writes it, marks included, and read back through the same
// read model the page uses.

const db = vi.hoisted(() => ({ tournamentAudit: { findUnique: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/tournaments/5',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { CHECKS_VERSION } = await import('@/lib/audit/checks');
const { getTournamentAccuracy } = await import('@/lib/admin/tournamentAccuracy');
const { AccuracyChecks } = await import('@/components/admin/AccuracyChecks');
const { fingerprintOf } = await import('@/lib/admin/adminChecks');

const NOW = new Date('2026-10-31T12:00:00Z');
const FAIL_DETAIL = 'Round 3 has 4 rooms; round 2 had 8.';

const stored = {
  tournamentId: 5n,
  score: 80,
  checksVersion: CHECKS_VERSION,
  computedAt: new Date('2026-10-31T11:00:00Z'),
  checks: [
    { code: 'champion', status: 'pass', detail: 'Champion found: Team A.', pieces: [] },
    { code: 'rounds_complete', status: 'fail', detail: FAIL_DETAIL, pieces: [] },
    { code: 'panels', status: 'warn', detail: '2 rooms have no chair.', pieces: [] },
    { code: 'break_matches', status: 'na', detail: 'No break tab.', pieces: [] },
    {
      code: 'motions',
      status: 'pass',
      detail: 'Checked by owner on 30 Oct 2026. Was: 1 round has no motion.',
      pieces: [],
      checkedBy: 'owner@example.com',
      checkedAt: '2026-10-30T10:00:00.000Z',
      wasStatus: 'warn',
    },
  ],
};

beforeEach(() => {
  db.tournamentAudit.findUnique.mockReset();
  db.tournamentAudit.findUnique.mockResolvedValue(stored);
});

async function page(): Promise<string> {
  const audit = (await getTournamentAccuracy(5n))!;
  return renderToStaticMarkup(
    React.createElement(AccuracyChecks, {
      tournamentId: '5',
      tournamentName: 'Oxford IV',
      audit,
      now: NOW,
    }),
  );
}

/** The list item of one check, by its heading. */
const row = (html: string, label: string) => {
  const items = html.split('<li ').slice(1);
  return items.find((li) => li.includes(`>${label}</h3>`))!;
};

describe('read model for marks', () => {
  it('gives the fingerprint the audit will compare, for failing and warning checks only', async () => {
    const a = (await getTournamentAccuracy(5n))!;
    const by = (code: string) => a.checks.find((c) => c.code === code)!;
    expect(by('rounds_complete').fingerprint).toBe(
      fingerprintOf('check', { status: 'fail', detail: FAIL_DETAIL }),
    );
    expect(by('panels').fingerprint).not.toBeNull();
    expect(by('champion').fingerprint).toBeNull();
    expect(by('break_matches').fingerprint).toBeNull();
    expect(by('motions').fingerprint).toBeNull();
    expect(by('rounds_complete').subject).toBe('5:rounds_complete');
  });

  it('reads a checked check as who and when, never the address', async () => {
    const motions = (await getTournamentAccuracy(5n))!.checks.find((c) => c.code === 'motions')!;
    expect(motions.checked).toEqual({ words: 'Checked by owner on 30 Oct 2026', was: 'warn' });
    expect(motions.detail).toBe('Was: 1 round has no motion.');
    expect(JSON.stringify(motions)).not.toContain('example.com');
  });
});

describe('<AccuracyChecks> marks', () => {
  it('offers Mark checked and Review later on a failing and a warning check', async () => {
    const html = await page();
    for (const label of ['Rounds complete', 'Panels']) {
      const li = row(html, label);
      expect(li).toContain(`aria-label="Mark checked: ${label} of Oxford IV"`);
      expect(li).toContain('>Mark checked<');
      expect(li).toContain('>Review later<');
      expect(li).not.toContain('>Undo<');
    }
  });

  it('offers nothing on a pass or a check that does not apply', async () => {
    const html = await page();
    for (const label of ['Champion', 'Break size']) {
      const li = row(html, label);
      expect(li).not.toContain('Mark checked');
      expect(li).not.toContain('Review later');
      expect(li).not.toContain('Undo');
    }
  });

  it('shows "Checked by X on D · Undo" and the Checked pill on a checked check', async () => {
    const li = row(await page(), 'Motions');
    expect(li).toContain('Checked by owner on 30 Oct 2026');
    expect(li).toMatch(/Checked<\/span>/);
    expect(li).toContain('aria-label="Undo the mark on Motions of Oxford IV"');
    expect(li).toContain('>Undo<');
    expect(li).not.toContain('Mark checked');
    // The old finding stays, without repeating who checked it.
    expect(li).toContain('Was: 1 round has no motion.');
    expect(li.match(/Checked by owner/g)).toHaveLength(1);
  });

  it('puts one status line and no stray alert on the list', async () => {
    const html = await page();
    expect(html.match(/role="status"/g)!.length).toBeGreaterThanOrEqual(1);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('example.com');
  });
});
