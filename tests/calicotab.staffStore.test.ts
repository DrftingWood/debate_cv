import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { matchStaffName } from '@/lib/calicotab/staffMatch';
import { recordStaffFromHome, rematchStaffNames } from '@/lib/calicotab/staffStore';

// R10 ruling 16: a staff name links to a person only on an exact full-name
// match; a looser match is a candidate with no CV effect; the staff store
// never writes to TournamentParticipant.

const home = readFileSync(new URL('./fixtures/staff/cnlu13-2022.html', import.meta.url), 'utf8');

const person = (personId: bigint, displayName: string) => ({ personId, displayName });

beforeEach(() => {
  resetPrismaMock();
  prismaMock.tournamentStaff.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.tournamentStaff.createMany.mockResolvedValue({ count: 0 });
});

describe('matchStaffName', () => {
  const people = [person(1n, 'Abhishek Acharya'), person(2n, 'Shruti Deb')];

  it('links an exact name, folding case, diacritics, punctuation and spacing', () => {
    expect(matchStaffName('Abhishek Acharya', people).exact).toBe(1n);
    expect(matchStaffName('  ABHISHEK   acharya ', people).exact).toBe(1n);
    expect(matchStaffName('Séb Dunne', [person(5n, 'Seb Dunne')]).exact).toBe(5n);
    expect(matchStaffName('Matthew Conley Evans', [person(6n, 'Matthew Conley-Evans')]).exact).toBe(
      6n,
    );
  });

  it('a middle name dropped gives a candidate, not a link (Rahul Sharma)', () => {
    const m = matchStaffName('Rahul Sharma', [person(3n, 'Rahul Kumar Sharma')]);
    expect(m).toEqual({ exact: null, candidate: 3n });
    expect(matchStaffName('Rahul Kumar Sharma', [person(4n, 'Rahul Sharma')])).toEqual({
      exact: null,
      candidate: 4n,
    });
  });

  it('reordered words are a candidate, not a link', () => {
    expect(matchStaffName('Sharma Rahul', [person(3n, 'Rahul Sharma')])).toEqual({
      exact: null,
      candidate: 3n,
    });
  });

  it('a name inside another name is no match at all (Ann Lee, Joann Lee)', () => {
    expect(matchStaffName('Ann Lee', [person(7n, 'Joann Lee')])).toEqual({
      exact: null,
      candidate: null,
    });
  });

  it('a single word never links and is never a candidate (Apratim)', () => {
    const list = [person(8n, 'Apratim'), person(9n, 'Apratim Das')];
    expect(matchStaffName('Apratim', list)).toEqual({ exact: null, candidate: null });
    // A one-word participant is not a candidate for a two-word name either.
    expect(matchStaffName('Apratim Das', [person(8n, 'Apratim')]).candidate).toBeNull();
  });

  it('two people with the same name: unlinked, and no candidate', () => {
    const twins = [person(1n, 'Rahul Sharma'), person(2n, 'Rahul Sharma')];
    expect(matchStaffName('Rahul Sharma', twins)).toEqual({ exact: null, candidate: null });
  });

  it('two near matches are not a candidate either', () => {
    const cousins = [person(3n, 'Rahul K Sharma'), person(4n, 'Rahul S Sharma')];
    expect(matchStaffName('Rahul Sharma', cousins)).toEqual({ exact: null, candidate: null });
  });

  it('an exact match wins over near ones', () => {
    const both = [person(1n, 'Rahul Sharma'), person(2n, 'Rahul K Sharma')];
    expect(matchStaffName('Rahul Sharma', both)).toEqual({ exact: 1n, candidate: null });
  });
});

describe('recordStaffFromHome', () => {
  it('replaces the staff-block names, exact-linked or candidate, and writes no participant', async () => {
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([
      { personId: 1n, person: { displayName: 'Abhishek Acharya' } },
      { personId: 2n, person: { displayName: 'Shruti Deb' } },
      { personId: 3n, person: { displayName: 'Kevin Santosh Kumar' } },
    ]);
    const read = await recordStaffFromHome(9n, home);
    expect(read).toEqual({ found: true, named: 4, linked: 2 });
    expect(prismaMock.tournamentStaff.deleteMany).toHaveBeenCalledWith({
      where: { tournamentId: 9n, role: 'core', source: 'staff_block' },
    });
    const { data } = prismaMock.tournamentStaff.createMany.mock.calls[0]![0] as {
      data: Array<{ name: string; personId: bigint | null; candidatePersonId: bigint | null }>;
    };
    expect(data.map((d) => [d.name, d.personId, d.candidatePersonId])).toEqual([
      ['Shruti Deb', 2n, null],
      ['Vignesh Hariharan', null, null],
      ['Abhishek Acharya', 1n, null],
      ['Kevin Santosh', null, 3n],
    ]);
    // The judge tag is the participants list's alone.
    expect(prismaMock.tournamentParticipant.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.tournamentParticipant.update).not.toHaveBeenCalled();
    expect(prismaMock.tournamentParticipant.upsert).not.toHaveBeenCalled();
  });

  it('a page with no staff block clears the old names and says it found none', async () => {
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);
    const read = await recordStaffFromHome(9n, '<html><body><h1>Welcome</h1></body></html>');
    expect(read).toEqual({ found: false, named: 0, linked: 0 });
    expect(prismaMock.tournamentStaff.deleteMany).toHaveBeenCalled();
  });
});

describe('rematchStaffNames: a participants write re-checks stored links (round 2)', () => {
  const staff = (
    id: bigint,
    name: string,
    personId: bigint | null,
    candidatePersonId: bigint | null = null,
  ) => ({
    id,
    name,
    personId,
    candidatePersonId,
  });
  const listed = (personId: bigint, displayName: string) => ({
    personId,
    person: { displayName },
  });

  beforeEach(() => {
    prismaMock.tournamentStaff.update.mockResolvedValue({});
  });

  it('a re-read that adds a namesake clears the link, with no candidate either', async () => {
    prismaMock.tournamentStaff.findMany.mockResolvedValue([staff(1n, 'Ada Lovelace', 5n)]);
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([
      listed(5n, 'Ada Lovelace'),
      listed(6n, 'Ada Lovelace'),
    ]);
    expect(await rematchStaffNames(prismaMock as never, 9n)).toBe(1);
    expect(prismaMock.tournamentStaff.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { personId: null, candidatePersonId: null },
    });
  });

  it('a candidate becomes a link when the exact name turns up, and a link with no one left goes', async () => {
    prismaMock.tournamentStaff.findMany.mockResolvedValue([
      staff(1n, 'Rahul Sharma', null, 3n),
      staff(2n, 'Grace Hopper', 8n),
    ]);
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([listed(4n, 'Rahul Sharma')]);
    await rematchStaffNames(prismaMock as never, 9n);
    expect(prismaMock.tournamentStaff.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { personId: 4n, candidatePersonId: null },
    });
    expect(prismaMock.tournamentStaff.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: { personId: null, candidatePersonId: null },
    });
  });

  it('rows whose match is unchanged are not written, and it reads nothing without staff rows', async () => {
    prismaMock.tournamentStaff.findMany.mockResolvedValue([staff(1n, 'Ada Lovelace', 5n)]);
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([listed(5n, 'Ada Lovelace')]);
    expect(await rematchStaffNames(prismaMock as never, 9n)).toBe(0);
    expect(prismaMock.tournamentStaff.update).not.toHaveBeenCalled();
    prismaMock.tournamentStaff.findMany.mockResolvedValue([]);
    prismaMock.tournamentParticipant.findMany.mockClear();
    await rematchStaffNames(prismaMock as never, 9n);
    expect(prismaMock.tournamentParticipant.findMany).not.toHaveBeenCalled();
  });
});
