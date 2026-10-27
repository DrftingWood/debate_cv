/**
 * Found rows under exact matching: no tiers, the evidence line, the
 * same-round warnings that remain, and the order.
 */
import { describe, expect, it } from 'vitest';
import { appearanceKey, buildRows, type Appearance, type Decision } from '@/lib/discovery/match';

const MATE = { name: 'Priya Rao', where: 'SIDO 2025', sameTeam: true };

function app(over: Partial<Appearance> = {}): Appearance {
  return {
    tournamentId: '10',
    personId: '100',
    tournamentName: 'WUDC 2024',
    year: 2024,
    region: null,
    publicUrl: '',
    listedName: 'Abhishek Acharya',
    alias: 'Abhishek Acharya',
    matchKind: 'exact',
    roles: ['speaker'],
    teamName: 'Ashoka A',
    mine: false,
    slots: [],
    eudc: false,
    teammates: [],
    ...over,
  };
}

const none = new Map<string, Decision>();

describe('evidence line', () => {
  it('names the teammate, the record, the place and the year', () => {
    const [row] = buildRows([app({ region: 'South Asia', teammates: [MATE], mine: true })], none);
    expect(row.evidence).toEqual([
      'Exact match',
      'this name is already on your record',
      'your teammate Priya Rao (SIDO 2025) is on this team',
      'South Asia, 2024',
    ]);
  });

  it('shows the name as the tab lists it when only case or spacing differs', () => {
    const [row] = buildRows([app({ listedName: 'ABHISHEK  ACHARYA' })], none);
    expect(row.evidence[0]).toBe('Exact match, listed as "ABHISHEK  ACHARYA"');
  });

  it('says "contains your name" for the in-order whole-word match', () => {
    const [row] = buildRows(
      [app({ matchKind: 'contains', listedName: 'Abhishek Lalatendu Acharya' })],
      none,
    );
    expect(row.evidence[0]).toBe(
      'Contains your name "Abhishek Acharya": listed as "Abhishek Lalatendu Acharya"',
    );
  });

  it('a teammate elsewhere at the tournament is weaker evidence', () => {
    const [row] = buildRows([app({ teammates: [{ ...MATE, sameTeam: false }] })], none);
    expect(row.evidence).toContain(
      'your teammate Priya Rao (SIDO 2025) was also at this tournament',
    );
  });
});

describe('same-round warnings (shown, never decided)', () => {
  it('a name that spoke and judged in one round gets a Check line', () => {
    const [row] = buildRows(
      [
        app({
          slots: [
            { round: 'R3', kind: 'speak', team: 'Ashoka A' },
            { round: 'R3', kind: 'judge' },
          ],
        }),
      ],
      none,
    );
    expect(row.warnings).toContain(
      'Two people may share this name here: it spoke in round 3 and judged round 3',
    );
  });

  it('two of the user names in one round at one tournament warn each other', () => {
    const spoke = app({ personId: '1', slots: [{ round: 'R3', kind: 'speak', team: 'A' }] });
    const judged = app({
      personId: '2',
      listedName: 'Abhi Acharya',
      alias: 'Abhi Acharya',
      teamName: null,
      slots: [{ round: 'R3', kind: 'judge' }],
    });
    const rows = buildRows([spoke, judged], none);
    expect(rows.find((r) => r.personId === '2')?.warnings[0]).toMatch(
      /^This name judged round 3 while "Abhishek Acharya" spoke in round 3; at most one/,
    );
  });

  it('two panels in one round is a check (HWS double panels)', () => {
    const panel = (personId: string) =>
      app({ personId, teamName: null, slots: [{ round: 'R2', kind: 'judge' }] });
    const rows = buildRows([panel('1'), panel('2')], none);
    expect(rows[0].warnings[0]).toMatch(/double panel/);
  });

  it('disjoint rounds: no warning', () => {
    const rows = buildRows(
      [
        app({ personId: '1', slots: [{ round: 'R3', kind: 'speak', team: 'A' }] }),
        app({ personId: '2', slots: [{ round: 'semifinal', kind: 'judge' }] }),
      ],
      none,
    );
    expect(rows.every((r) => r.warnings.length === 0)).toBe(true);
  });
});

describe('order and decisions', () => {
  it('teammate evidence first, then newest first', () => {
    const rows = buildRows(
      [
        app({ tournamentId: '1', year: 2010 }),
        app({ tournamentId: '2', year: 2012, teammates: [MATE] }),
        app({ tournamentId: '3', year: 2024 }),
      ],
      none,
    );
    expect(rows.map((r) => r.tournamentId)).toEqual(['2', '3', '1']);
  });

  it('carries the recorded decision', () => {
    const [row] = buildRows([app()], new Map([[appearanceKey('10', '100'), 'rejected']]));
    expect(row.decision).toBe('rejected');
  });
});
