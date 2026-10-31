import { describe, expect, test } from 'vitest';
import { parseStaffText } from '@/lib/calicotab/staffBlock';

// R10 ruling 17: a core label must start a line or follow a separator, and
// any other "Label:" ends a core list wherever it stands.

describe('qualified labels are not the core', () => {
  test.each([
    'Non-Core Adjudication',
    'Equity Adjudication',
    'Appeals Adjudication Panel',
    'Adjudication Feedback',
    'Adjudicator Training',
    'Assistant Chief Adjudicator',
  ])('%s', (label) => {
    expect(parseStaffText(`${label}: Ada Lovelace, Grace Hopper`)).toEqual([]);
    expect(parseStaffText(`Tabulation: Kurt Godel\n${label}: Ada Lovelace`)).toEqual([]);
  });

  test('a qualified label ends the core list above it', () => {
    expect(parseStaffText('Adjudication: Ada Lovelace\nEquity Adjudication: Grace Hopper')).toEqual(
      ['Ada Lovelace'],
    );
  });
});

describe('where a core label may start', () => {
  test('at the start of the text, a line, or after a separator or bracket', () => {
    expect(parseStaffText('CA: Ada Lovelace')).toEqual(['Ada Lovelace']);
    expect(parseStaffText('Tabulation: Kurt Godel\nCAP: Ada Lovelace')).toEqual(['Ada Lovelace']);
    expect(parseStaffText('Tabulation: Kurt Godel; DCA: Ada Lovelace')).toEqual(['Ada Lovelace']);
    expect(parseStaffText('Tabulation: Kurt Godel | Core: Ada Lovelace')).toEqual(['Ada Lovelace']);
    expect(parseStaffText('[Adjudication: Ada Lovelace]')).toEqual(['Ada Lovelace']);
  });

  test('after other words on the same line it is not a core label', () => {
    expect(parseStaffText('Tabulation: Kurt Godel Adjudication: Ada Lovelace')).toEqual([]);
  });
});

describe('any other label ends a core list', () => {
  test('on the same line, after a bracketed list', () => {
    expect(
      parseStaffText('Core Adjudicators: [Ada Lovelace, Grace Hopper] Equity Panel: [Alan Turing]'),
    ).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  test('on a later line, known or not', () => {
    expect(parseStaffText('Adjudication: Ada Lovelace\nCatering: Grace Hopper')).toEqual([
      'Ada Lovelace',
    ]);
    expect(parseStaffText('Adjudication: Ada Lovelace\nOrg Comm: Grace Hopper')).toEqual([
      'Ada Lovelace',
    ]);
    expect(parseStaffText('CA: Ada Lovelace\nTab Team: Grace Hopper')).toEqual(['Ada Lovelace']);
    expect(parseStaffText('CA: Ada Lovelace\nOrganising Commitee: Grace Hopper')).toEqual([
      'Ada Lovelace',
    ]);
  });

  test.each([
    'Equity Panel',
    'Org Comm',
    'Organising Committee',
    'Tab Team',
    'Tabulation Team',
    'Equity',
  ])('%s stops a list', (label) => {
    expect(parseStaffText(`CA: Ada Lovelace; ${label}: Grace Hopper`)).toEqual(['Ada Lovelace']);
  });
});

describe('short labels', () => {
  test('CA, CAP and DCA are core headings', () => {
    expect(
      parseStaffText('CA: Ada Lovelace\nCAP: Grace Hopper\nDCAs: Alan Turing, Kurt Godel'),
    ).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Kurt Godel']);
  });
});
