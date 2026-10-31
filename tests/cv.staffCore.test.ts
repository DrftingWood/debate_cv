import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { effectiveJudgeTag, loadStaffCoreTournaments } from '@/lib/cv/staffCore';

beforeEach(() => resetPrismaMock());

describe('effectiveJudgeTag', () => {
  it('is core when the staff block says so, whatever the stored tag', () => {
    expect(effectiveJudgeTag(null, true)).toBe('core');
    expect(effectiveJudgeTag('normal', true)).toBe('core');
    expect(effectiveJudgeTag('Adjudicator', true)).toBe('core');
  });

  it('keeps the stored tag when it is not, including an Adj Core tick', () => {
    expect(effectiveJudgeTag('invited', false)).toBe('invited');
    expect(effectiveJudgeTag(null, false)).toBeNull();
    expect(effectiveJudgeTag('core', false)).toBe('core');
    expect(effectiveJudgeTag('core', true)).toBe('core');
  });
});

describe('loadStaffCoreTournaments', () => {
  it('asks for exact links only (personId), core role, within the given tournaments', async () => {
    prismaMock.tournamentStaff.findMany.mockResolvedValue([
      { tournamentId: 4n },
      { tournamentId: 9n },
    ]);
    const out = await loadStaffCoreTournaments(new Set([10n, 11n]), [4n, 9n, 12n]);
    expect([...out].sort()).toEqual([4n, 9n]);
    expect(prismaMock.tournamentStaff.findMany).toHaveBeenCalledWith({
      where: { personId: { in: [10n, 11n] }, role: 'core', tournamentId: { in: [4n, 9n, 12n] } },
      select: { tournamentId: true },
    });
  });

  it('with nobody claimed reads nothing', async () => {
    expect((await loadStaffCoreTournaments([])).size).toBe(0);
    expect(prismaMock.tournamentStaff.findMany).not.toHaveBeenCalled();
  });
});

describe('effectiveJudgeTag: case (round 2)', () => {
  it('a stored "Core" or "CORE" reads as core, so every downstream check sees "core"', () => {
    expect(effectiveJudgeTag('Core', false)).toBe('core');
    expect(effectiveJudgeTag('CORE', true)).toBe('core');
  });
});
