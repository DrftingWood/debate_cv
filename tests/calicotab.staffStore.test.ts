import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { linkStaffName, recordStaffFromHome } from '@/lib/calicotab/staffStore';

// R10: the home page's staff names are stored as role "core", source
// "staff_block", and linked to a person only when exactly one person in the
// tournament's participant list could be them.

const home = readFileSync(new URL('./fixtures/staff/cnlu13-2022.html', import.meta.url), 'utf8');

const person = (personId: bigint, displayName: string) => ({ personId, displayName });

function participant(
  personId: bigint,
  displayName: string,
  over: { judgeTypeTag?: string | null; roles?: string[] } = {},
) {
  return {
    personId,
    judgeTypeTag: over.judgeTypeTag ?? null,
    person: { displayName },
    roles: (over.roles ?? ['judge']).map((role) => ({ role })),
  };
}

beforeEach(() => {
  resetPrismaMock();
  prismaMock.tournamentStaff.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.tournamentStaff.createMany.mockResolvedValue({ count: 0 });
  prismaMock.tournamentParticipant.updateMany.mockResolvedValue({ count: 0 });
});

describe('linkStaffName', () => {
  const people = [person(1n, 'Abhishek Acharya'), person(2n, 'Shruti Deb')];

  it('links an exact name and a fuzzy one (a dropped middle name)', () => {
    expect(linkStaffName('Abhishek Acharya', people)).toBe(1n);
    expect(linkStaffName('Abhishek K Acharya', people)).toBe(1n);
  });

  it('does not link an unknown name or a single first name', () => {
    expect(linkStaffName('Kevin Santosh', people)).toBeNull();
    expect(linkStaffName('Shruti', people)).toBeNull();
  });

  it('does not link an ambiguous name: two people could be them', () => {
    const twins = [person(1n, 'Rahul Sharma'), person(2n, 'Rahul Sharma')];
    expect(linkStaffName('Rahul Sharma', twins)).toBeNull();
    const cousins = [person(3n, 'Rahul K Sharma'), person(4n, 'Rahul S Sharma')];
    expect(linkStaffName('Rahul Sharma', cousins)).toBeNull();
  });

  it('prefers a single exact match over fuzzy near-misses', () => {
    const both = [person(1n, 'Rahul Sharma'), person(2n, 'Rahul K Sharma')];
    expect(linkStaffName('Rahul Sharma', both)).toBe(1n);
  });
});

describe('recordStaffFromHome', () => {
  it("replaces the tournament's staff-block core names with the page's, linked where unambiguous", async () => {
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([
      participant(1n, 'Abhishek Acharya'),
      participant(2n, 'Shruti Deb', { judgeTypeTag: 'core' }),
    ]);
    const read = await recordStaffFromHome(9n, home);
    expect(read).toEqual({ found: true, named: 4, linked: 2 });
    expect(prismaMock.tournamentStaff.deleteMany).toHaveBeenCalledWith({
      where: { tournamentId: 9n, role: 'core', source: 'staff_block' },
    });
    const { data } = prismaMock.tournamentStaff.createMany.mock.calls[0]![0] as {
      data: Array<{ name: string; personId: bigint | null; role: string; source: string }>;
    };
    expect(data.map((d) => [d.name, d.personId])).toEqual([
      ['Shruti Deb', 2n],
      ['Vignesh Hariharan', null],
      ['Abhishek Acharya', 1n],
      ['Kevin Santosh', null],
    ]);
    expect(data.every((d) => d.role === 'core' && d.source === 'staff_block')).toBe(true);
  });

  it('marks a linked judge core, and leaves one already core or not a judge alone', async () => {
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([
      participant(1n, 'Abhishek Acharya', { judgeTypeTag: 'Adjudicator' }),
      participant(2n, 'Shruti Deb', { judgeTypeTag: 'core' }),
      participant(3n, 'Kevin Santosh', { roles: ['speaker'] }),
    ]);
    await recordStaffFromHome(9n, home);
    expect(prismaMock.tournamentParticipant.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.tournamentParticipant.updateMany).toHaveBeenCalledWith({
      where: { tournamentId: 9n, personId: { in: [1n] } },
      data: { judgeTypeTag: 'core' },
    });
  });

  it('a page with no staff block clears the old names and says it found none', async () => {
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);
    const read = await recordStaffFromHome(9n, '<html><body><h1>Welcome</h1></body></html>');
    expect(read).toEqual({ found: false, named: 0, linked: 0 });
    expect(prismaMock.tournamentStaff.deleteMany).toHaveBeenCalled();
    expect(prismaMock.tournamentParticipant.updateMany).not.toHaveBeenCalled();
  });
});
