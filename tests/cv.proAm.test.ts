/**
 * The Partners tab's overview (lib/cv/proAm.ts; redesign owner decision 17).
 */
import { describe, expect, it } from 'vitest';
import { partnerOverview, proAmKey } from '@/lib/cv/proAm';
import { makeSpeakerRow } from './setup/cv-fixtures';

describe('proAmKey', () => {
  it('keys a partner by name key v2, so case and accents do not split a mark', () => {
    expect(proAmKey(7n, 'Priya Ramán')).toBe(proAmKey('7', 'PRIYA raman'));
  });
});

describe('partnerOverview', () => {
  const rows = [
    makeSpeakerRow({ tournamentId: 3n, year: 2025, teammates: ['Priya Raman'] }),
    makeSpeakerRow({ tournamentId: 2n, year: 2025, teammates: ['priya raman', 'Ola Ade'] }),
    makeSpeakerRow({ tournamentId: 1n, year: 2024, teammates: ['Ola Ade'] }),
    makeSpeakerRow({ tournamentId: 4n, year: 2024, teammates: ['—'] }),
  ];

  it('lists one pairing per partner per tournament, with its mark', () => {
    const { pairings } = partnerOverview(rows, new Set([proAmKey(2n, 'Priya Raman')]));
    expect(pairings.map((p) => [p.tournamentId, p.partner, p.marked])).toEqual([
      ['3', 'Priya Raman', false],
      ['2', 'priya raman', true],
      ['2', 'Ola Ade', false],
      ['1', 'Ola Ade', false],
    ]);
  });

  it('summarises each year, most frequent partner first, counting marks', () => {
    const { years } = partnerOverview(rows, new Set([proAmKey(2n, 'Priya Raman')]));
    expect(years).toEqual([
      {
        year: 2025,
        partners: [
          { name: 'Priya Raman', tournaments: 2, proAm: 1 },
          { name: 'Ola Ade', tournaments: 1, proAm: 0 },
        ],
      },
      { year: 2024, partners: [{ name: 'Ola Ade', tournaments: 1, proAm: 0 }] },
    ]);
  });
});
