import { describe, expect, it } from 'vitest';
import { nameSample, NAME_SAMPLE_MAX, NAME_SAMPLE_MIN } from '@/lib/identity/nameSample';

// Owner, 2026-10-30: read at least ten private-URL pages; the majority name is
// the verified one (9 x Abhishek + 1 x Priya: Abhishek is the user).
const times = (n: number, name: string) => Array.from({ length: n }, () => name);

describe('nameSample', () => {
  it('settles on the majority once ten pages are read', () => {
    const s = nameSample([...times(9, 'Abhishek Acharya'), 'Priya Raman']);
    expect(s).toMatchObject({
      read: 10,
      topName: 'Abhishek Acharya',
      hasMajority: true,
      complete: true,
      need: 0,
    });
  });

  it('keeps reading below ten pages, however clear the name', () => {
    const s = nameSample(times(4, 'Abhishek Acharya'));
    expect(s).toMatchObject({ read: 4, hasMajority: true, complete: false, need: 6 });
  });

  it('treats spellings that normalise alike as one name', () => {
    const s = nameSample([...times(5, 'Abhishek Acharya'), ...times(5, 'abhishek  ACHARYA')]);
    expect(s).toMatchObject({ read: 10, hasMajority: true, complete: true });
  });

  it('reads on to twenty when ten pages are split, then stops', () => {
    const split = [...times(5, 'Abhishek Acharya'), ...times(5, 'Priya Raman')];
    expect(nameSample(split)).toMatchObject({ hasMajority: false, complete: false, need: 10 });
    const twenty = [...times(10, 'Abhishek Acharya'), ...times(10, 'Priya Raman')];
    expect(nameSample(twenty)).toMatchObject({ read: NAME_SAMPLE_MAX, complete: true, need: 0 });
  });

  it('a half share is not a majority', () => {
    expect(nameSample([...times(6, 'A B'), ...times(6, 'C D')]).hasMajority).toBe(false);
  });

  it('ignores links with no name read (failed or not yet read)', () => {
    const s = nameSample(['', null, undefined, '  ', ...times(3, 'Abhishek Acharya')]);
    expect(s).toMatchObject({ read: 3, need: NAME_SAMPLE_MIN - 3 });
  });

  it('reports nothing for an empty sample', () => {
    expect(nameSample([])).toMatchObject({ read: 0, topName: null, hasMajority: false });
  });
});
