import { describe, expect, it } from 'vitest';
import { nameProximity } from '@/lib/identity/nameProximity';

describe('nameProximity', () => {
  it('matches the same name however it is written', () => {
    expect(nameProximity('Abhishek Acharya', 'abhishek acharya')).toBe('match');
    expect(nameProximity('Acharya, Abhishek', 'Abhishek Acharya')).toBe('match');
    expect(nameProximity('Abhishek K Acharya', 'Abhishek Acharya')).toBe('match');
    expect(nameProximity('Abhishek Acharya (IIT-B)', 'Abhishek Acharya')).toBe('match');
  });

  it('folds accents rather than dropping the letter', () => {
    expect(nameProximity('José Álvarez', 'Jose Alvarez')).toBe('match');
  });

  it('calls an initial, a prefix or a one-letter typo in the first name close', () => {
    expect(nameProximity('A. Acharya', 'Abhishek Acharya')).toBe('close');
    expect(nameProximity('Abhi Acharya', 'Abhishek Acharya')).toBe('close');
    expect(nameProximity('Abhisek Acharya', 'Abhishek Acharya')).toBe('close');
  });

  it('allows one slip in a long surname only', () => {
    expect(nameProximity('Abhishek Acharyaa', 'Abhishek Acharya')).toBe('close');
    expect(nameProximity('Ann Lee', 'Ann Lea')).toBe('different');
  });

  it('compares crosswise for a surname-first order that the matcher missed', () => {
    expect(nameProximity('Acharya A', 'Abhishek Acharya')).toBe('close');
  });

  it('does not treat a longer surname that merely contains the shorter as the same', () => {
    expect(nameProximity('Ann Lee', 'Ann Leeson')).toBe('different');
  });

  it('keeps different people different', () => {
    expect(nameProximity('Abhishek Acharya', 'Rohit Sharma')).toBe('different');
    expect(nameProximity('Abhishek Acharya', 'Abhishek Sharma')).toBe('different');
    expect(nameProximity('Priya Acharya', 'Abhishek Acharya')).toBe('different');
  });

  it('never calls a single bare name close, and empty input is different', () => {
    expect(nameProximity('Abhishek', 'Abhishek Acharya')).toBe('different');
    expect(nameProximity('', 'Abhishek Acharya')).toBe('different');
    expect(nameProximity('Abhishek Acharya', '   ')).toBe('different');
  });
});

import { proximityToYou } from '@/lib/identity/nameProximity';

describe('proximityToYou', () => {
  it('is unknown with no reference name, not different', () => {
    expect(proximityToYou('Abhishek Acharya', [])).toBe('unknown');
    expect(proximityToYou('Abhishek Acharya', [null, undefined, '  '])).toBe('unknown');
  });

  it('takes the best answer over the profile name and the names already claimed', () => {
    expect(proximityToYou('Abhi A', ['Abhishek Acharya', 'Abhi A'])).toBe('match');
    expect(proximityToYou('A. Acharya', ['Rohit Sharma', 'Abhishek Acharya'])).toBe('close');
    expect(proximityToYou('Priya Nair', ['Abhishek Acharya', 'Abhi A'])).toBe('different');
  });
});
