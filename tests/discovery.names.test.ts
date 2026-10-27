import { describe, expect, it } from 'vitest';
import {
  MAX_ANCHORS,
  bestMatch,
  classifyName,
  lookupKeys,
  prefixRanges,
  selectAnchors,
} from '@/lib/discovery/names';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';

describe('classifyName', () => {
  it('exact and reordered names match', () => {
    expect(classifyName('Abhishek Acharya', 'Abhishek Acharya')).toBe('match');
    expect(classifyName('Abhishek Acharya', 'acharya, abhishek')).toBe('match');
    expect(classifyName('Abhishek Acharya', 'Abhishek Acharya (Ashoka)')).toBe('match');
  });

  it('an initial or a one-letter slip is close, never a match', () => {
    expect(classifyName('Abhishek Acharya', 'A. Acharya')).toBe('close');
    expect(classifyName('Abhishek Acharya', 'Abhisek Acharya')).toBe('close');
    expect(classifyName('Abhishek Acharya', 'Abhi Acharya')).toBe('close');
  });

  it('accents fold through the existing normaliser', () => {
    expect(classifyName('José Silva', 'Jose Silva')).toBe('match');
    expect(classifyName('Jose Silva', 'José Silva')).toBe('match');
    expect(classifyName('Zoë Müller', 'Zoe Muller')).toBe('match');
  });

  it('one-word names go to the user only when equal, as ambiguous', () => {
    expect(classifyName('Abhishek', 'Abhishek')).toBe('ambiguous');
    expect(classifyName('Abhishek Acharya', 'Abhishek')).toBeNull();
    expect(classifyName('Abhishek', 'Abhishek Acharya')).toBeNull();
  });

  it('double surnames and dropped middle names are ambiguous, both ways', () => {
    expect(classifyName('Ana García', 'Ana García López')).toBe('ambiguous');
    expect(classifyName('Ana García López', 'Ana García')).toBe('ambiguous');
    expect(classifyName('Ana García López', 'Ana López')).toBe('ambiguous');
    expect(classifyName('Abhishek Acharya', 'Abhishek Kumar Acharya')).toBe('ambiguous');
  });

  it('different people and non-Latin names are not shown', () => {
    expect(classifyName('Abhishek Acharya', 'Rahul Sharma')).toBeNull();
    expect(classifyName('李明', '李明')).toBeNull();
    expect(classifyName('Ivan Petrov', 'Иван Петров')).toBeNull();
  });
});

describe('bestMatch', () => {
  it('prefers the strongest relation across anchors', () => {
    const r = bestMatch(['A. Acharya', 'Abhishek Acharya'], 'Abhishek Acharya');
    expect(r).toEqual({ proximity: 'match', anchor: 'Abhishek Acharya' });
  });
});

describe('lookupKeys', () => {
  it('probes the stored v1 key, which drops accented letters', () => {
    const keys = lookupKeys('José Silva');
    expect(keys).toContain(normalizePersonName('José Silva')); // "jos silva"
    expect(keys).toContain('jose silva');
  });

  it('reaches a stored accented name from an unaccented anchor', () => {
    // The tab wrote "José"; the user's card says "Jose".
    expect(lookupKeys('Jose Silva')).toContain(normalizePersonName('José Silva'));
    expect(lookupKeys('Ana Garcia')).toContain(normalizePersonName('Ana García'));
  });

  it('covers initials, surname-first order and one-letter slips', () => {
    const keys = lookupKeys('Abhishek Acharya');
    expect(keys).toEqual(
      expect.arrayContaining([
        'abhishek acharya',
        'acharya abhishek',
        'a acharya',
        'acharya a',
        'abhi acharya',
        'abhisek acharya',
        'abhishek acarya',
      ]),
    );
  });

  it('stays bounded', () => {
    expect(lookupKeys('Abhishek Acharya').length).toBeLessThan(1500);
    expect(lookupKeys('Abhishek')).toEqual(['abhishek']);
    expect(lookupKeys('李明')).toEqual([]);
  });
});

describe('prefixRanges', () => {
  it('gives a btree range for the first name and the surname', () => {
    expect(prefixRanges('Abhishek Acharya')).toEqual([
      { gte: 'abhishek', lt: 'abhishel' },
      { gte: 'acharya', lt: 'acharyb' },
    ]);
  });

  it('ranges on both the v1 and the folded first name when an accent differs', () => {
    expect(prefixRanges('José Silva').map((r) => r.gte)).toEqual(['jos', 'jose', 'silva']);
  });

  it('skips initials and carries over a trailing z', () => {
    expect(prefixRanges('A Li')).toEqual([]);
    expect(prefixRanges('A Liz')).toEqual([{ gte: 'liz', lt: 'lj' }]);
    expect(prefixRanges('Ana Ruiz')).toEqual([
      { gte: 'ana', lt: 'anb' },
      { gte: 'ruiz', lt: 'ruj' },
    ]);
  });
});

describe('selectAnchors', () => {
  it('uses registration names only; the Google name never seeds', () => {
    const r = selectAnchors(['Abhishek Acharya'], 'Abhishek Acharya');
    expect(r.usable).toEqual(['Abhishek Acharya']);
    expect(selectAnchors([], 'Abhishek Acharya').usable).toEqual([]);
  });

  it('holds back a forwarded URL whose name is unlike every other name', () => {
    const r = selectAnchors(['Abhishek Acharya', 'Priya Rao'], 'Abhishek Acharya');
    expect(r.usable).toEqual(['Abhishek Acharya']);
    expect(r.heldBack).toBe(1);
  });

  it('keeps a variant of the user’s own name', () => {
    const r = selectAnchors(['Abhishek Acharya', 'A. Acharya'], 'Abhishek A');
    expect(r.usable.sort()).toEqual(['A. Acharya', 'Abhishek Acharya']);
  });

  it('holds back a lone anchor with nothing to compare it with', () => {
    expect(selectAnchors(['Priya Rao'], null)).toMatchObject({ usable: [], heldBack: 1 });
  });

  it('drops stand-ins and duplicates, counts unsearchable names, caps at five', () => {
    expect(
      selectAnchors(['Swing 2', 'Abhishek Acharya', 'abhishek  acharya'], 'Abhishek Acharya'),
    ).toMatchObject({ usable: ['Abhishek Acharya'], heldBack: 0 });
    expect(selectAnchors(['李明'], '李明')).toMatchObject({ usable: [], unsearchable: 1 });
    const many = ['Ann Lee', 'Ann B Lee', 'Ann C Lee', 'Ann D Lee', 'Ann E Lee', 'Ann F Lee'];
    const r = selectAnchors(many, 'Ann Lee');
    expect(r.usable).toHaveLength(MAX_ANCHORS);
    expect(r.heldBack).toBe(1);
  });
});
