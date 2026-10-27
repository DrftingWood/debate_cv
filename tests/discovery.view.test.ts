import { describe, expect, it } from 'vitest';
import { buildRows, type Appearance, type Decision } from '@/lib/discovery/match';
import { rowLabel, shapeFoundView, type StoredDecision } from '@/lib/discovery/view';
import { decisionError, decisionNote } from '@/lib/discovery/messages';

function app(over: Partial<Appearance> = {}): Appearance {
  return {
    tournamentId: '10',
    personId: '100',
    tournamentName: 'Oxford IV',
    year: 2024,
    region: null,
    publicUrl: 'https://oxiv.calicotab.com/oxiv/',
    listedName: 'Abhishek Acharya',
    alias: 'Abhishek Acharya',
    matchKind: 'exact',
    roles: ['speaker', 'judge'],
    teamName: 'Ashoka A',
    mine: false,
    slots: [],
    eudc: false,
    teammates: [],
    ...over,
  };
}

const none = new Map<string, Decision>();
const base = { aliasCount: 1, unsearchable: 0, overLimit: 0, capped: [] };

function stored(over: Partial<StoredDecision> = {}): StoredDecision {
  return {
    tournamentId: '10',
    personId: '100',
    tournamentName: 'Oxford IV',
    year: 2024,
    publicUrl: '',
    listedName: 'Abhishek Acharya',
    status: 'rejected',
    evidence: ['Exact match', '2024'],
    ...over,
  };
}

describe('shapeFoundView', () => {
  it('lists undecided rows with a joined evidence line', () => {
    const v = shapeFoundView({ ...base, rows: buildRows([app()], none), stored: [] });
    expect(v.state).toBe('list');
    expect(v.candidates).toHaveLength(1);
    expect(v.candidates[0]).toMatchObject({
      role: 'Speaker and judge',
      team: 'Ashoka A',
      evidence: 'Exact match · 2024',
    });
  });

  it('moves decided rows to "Marked as you" and "Hidden"', () => {
    const rows = buildRows(
      [app({ tournamentId: '1' }), app({ tournamentId: '2' })],
      new Map([
        ['1:100', 'confirmed'],
        ['2:100', 'rejected'],
      ]),
    );
    const v = shapeFoundView({ ...base, rows, stored: [] });
    expect(v.confirmed.map((r) => r.tournamentId)).toEqual(['1']);
    expect(v.hidden.map((r) => r.tournamentId)).toEqual(['2']);
    expect(v.state).toBe('all_reviewed');
  });

  it('keeps a "Not me" visible after a re-scrape no longer returns its row', () => {
    const v = shapeFoundView({ ...base, rows: [], stored: [stored()] });
    expect(v.hidden).toHaveLength(1);
    expect(v.hidden[0]).toMatchObject({ key: '10:100', evidence: 'Exact match · 2024' });
    expect(v.state).toBe('all_reviewed');
  });

  it('does not list a stored decision twice', () => {
    const rows = buildRows([app()], new Map([['10:100', 'rejected']]));
    const v = shapeFoundView({ ...base, rows, stored: [stored()] });
    expect(v.hidden).toHaveLength(1);
  });

  it('defines every empty state', () => {
    expect(shapeFoundView({ ...base, aliasCount: 0, rows: [], stored: [] }).state).toBe(
      'no_anchors',
    );
    expect(
      shapeFoundView({ ...base, aliasCount: 0, unsearchable: 1, rows: [], stored: [] }).state,
    ).toBe('unsearchable');
    expect(shapeFoundView({ ...base, rows: [], stored: [] }).state).toBe('zero');
  });

  it('passes the capped names and the over-limit count through', () => {
    const capped = [{ name: 'Abhishek', total: 640, shown: 200 }];
    const v = shapeFoundView({ ...base, capped, overLimit: 2, rows: [], stored: [] });
    expect(v).toMatchObject({ capped, overLimit: 2 });
  });
});

describe('rowLabel', () => {
  it('adds the year unless the name carries it', () => {
    expect(rowLabel({ tournamentName: 'Oxford IV', year: 2024 })).toBe('Oxford IV 2024');
    expect(rowLabel({ tournamentName: 'WUDC 2024', year: 2024 })).toBe('WUDC 2024');
  });
});

describe('decision messages (UX-23: no raw codes)', () => {
  it('maps every code the route returns to words', () => {
    for (const code of [
      'rate_limited',
      'not_a_candidate',
      'one_at_a_time',
      'nothing_to_restore',
      'unauthorized',
      undefined,
    ]) {
      const text = decisionError(409, code, 'Too many requests. Try again in 3 hours.');
      expect(text).not.toMatch(/_/);
      expect(text.length).toBeGreaterThan(10);
    }
    expect(decisionError(429, 'rate_limited', 'Try again in 3 hours.')).toBe(
      "You have reached today's limit of 50 decisions. Try again in 3 hours.",
    );
    expect(decisionError(404, 'not_found')).toBe('This page is not available on your account.');
  });

  it('says what happened, and that nothing reached the record', () => {
    expect(decisionNote('confirm', 'WUDC 2024')).toBe(
      'Marked WUDC 2024 as you. Nothing is added to your record yet.',
    );
    expect(decisionNote('reject', 'WUDC 2024')).toMatch(/^Hidden WUDC 2024\./);
  });
});
