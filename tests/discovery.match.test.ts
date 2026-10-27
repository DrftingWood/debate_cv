import { describe, expect, it } from 'vitest';
import {
  COMMON_NAME_PER_YEAR,
  appearanceKey,
  rankAppearances,
  type Appearance,
  type Decision,
  type MatchContext,
} from '@/lib/discovery/match';

function app(over: Partial<Appearance> = {}): Appearance {
  return {
    tournamentId: '10',
    personId: '100',
    tournamentName: 'WUDC 2024',
    year: 2024,
    region: 'Europe',
    publicUrl: 'https://wudc2024.calicotab.com/wudc2024/',
    listedName: 'Abhishek Acharya',
    roles: ['speaker'],
    teamName: 'Ashoka A',
    claimedBy: null,
    slots: [],
    eudc: false,
    teammates: [],
    busiestYear: { year: 2024, count: 1 },
    ...over,
  };
}

const MATE = { name: 'Priya Rao', where: 'SIDO 2025', sameTeam: true };

function ctx(decisions: Record<string, Decision> = {}): MatchContext {
  return {
    anchors: ['Abhishek Acharya'],
    userYears: [2023, 2025],
    userRegions: ['South Asia'],
    decisions: new Map(Object.entries(decisions)),
  };
}

describe('tiers', () => {
  it('Strong: same name, a teammate in evidence, no warnings', () => {
    const [row] = rankAppearances([app({ teammates: [MATE] })], ctx());
    expect(row.tier).toBe('strong');
    expect(row.proximity).toBe('match');
  });

  it('a bare exact match without a teammate is only Possible', () => {
    expect(rankAppearances([app()], ctx())[0].tier).toBe('possible');
  });

  it('a close name never reaches Strong, even with a teammate', () => {
    const [row] = rankAppearances([app({ listedName: 'A. Acharya', teammates: [MATE] })], ctx());
    expect(row.proximity).toBe('close');
    expect(row.tier).toBe('possible');
  });

  it('one-word names and double surnames are Ambiguous', () => {
    const rows = rankAppearances(
      [
        app({ personId: '1', listedName: 'Abhishek Kumar Acharya', teammates: [MATE] }),
        app({ personId: '2', tournamentId: '11', listedName: 'Abhishek' }),
      ],
      { ...ctx(), anchors: ['Abhishek Acharya', 'Abhishek'] },
    );
    expect(rows.map((r) => r.tier)).toEqual(['ambiguous', 'ambiguous']);
  });

  it('drops names that are not near any anchor', () => {
    expect(rankAppearances([app({ listedName: 'Rahul Sharma' })], ctx())).toEqual([]);
  });
});

describe('common-name threshold', () => {
  it(`a name at more than ${COMMON_NAME_PER_YEAR} tournaments in a year never reaches Strong`, () => {
    const [row] = rankAppearances(
      [app({ teammates: [MATE], busiestYear: { year: 2024, count: COMMON_NAME_PER_YEAR + 1 } })],
      ctx(),
    );
    expect(row.tier).toBe('possible');
    expect(row.warnings).toContain(
      'This name is at 5 tournaments in 2024, so it is probably more than one person',
    );
  });

  it(`exactly ${COMMON_NAME_PER_YEAR} is still allowed`, () => {
    const [row] = rankAppearances(
      [app({ teammates: [MATE], busiestYear: { year: 2024, count: COMMON_NAME_PER_YEAR } })],
      ctx(),
    );
    expect(row.tier).toBe('strong');
  });
});

describe('same-round rule against the user’s own decisions', () => {
  const spoke = app({
    personId: '1',
    listedName: 'Abhishek Acharya',
    slots: [{ round: 'R3', kind: 'speak', team: 'Ashoka A' }],
  });
  const judged = app({
    personId: '2',
    listedName: 'A. Acharya',
    roles: ['judge'],
    teamName: null,
    slots: [{ round: 'R3', kind: 'judge' }],
  });

  it('blocks a row that clashes in one round with a row marked as you', () => {
    const rows = rankAppearances([spoke, judged], ctx({ [appearanceKey('10', '1')]: 'confirmed' }));
    const blocked = rows.find((r) => r.personId === '2');
    expect(blocked?.tier).toBe('blocked');
    expect(blocked?.blockReason).toBe('conflict_same_round');
    expect(blocked?.blockText).toBe(
      'This name judged round 3, the same round you spoke in (as "Abhishek Acharya"). It is someone else.',
    );
  });

  it('only warns while neither row is decided', () => {
    const rows = rankAppearances([spoke, judged], ctx());
    expect(rows.every((r) => r.tier !== 'blocked')).toBe(true);
    expect(rows.find((r) => r.personId === '2')?.warnings[0]).toMatch(
      /^This name judged round 3 while "Abhishek Acharya" spoke in round 3; at most one/,
    );
  });

  it('ignores a clash with a row the user hid', () => {
    const rows = rankAppearances([spoke, judged], ctx({ [appearanceKey('10', '1')]: 'rejected' }));
    expect(rows.find((r) => r.personId === '2')?.warnings).toEqual([]);
  });

  it('allows disjoint rounds: spoke round 3, judged the semifinal', () => {
    const later = { ...judged, slots: [{ round: 'semifinal', kind: 'judge' as const }] };
    const rows = rankAppearances([spoke, later], ctx({ [appearanceKey('10', '1')]: 'confirmed' }));
    expect(rows.find((r) => r.personId === '2')?.tier).toBe('possible');
  });

  it('two panels in one round is a check, never a block (HWS)', () => {
    const panel = (personId: string, listedName: string) =>
      app({ personId, listedName, teamName: null, slots: [{ round: 'R2', kind: 'judge' }] });
    const rows = rankAppearances(
      [panel('1', 'Abhishek Acharya'), panel('2', 'A. Acharya')],
      ctx({ [appearanceKey('10', '1')]: 'confirmed' }),
    );
    const other = rows.find((r) => r.personId === '2');
    expect(other?.tier).toBe('possible');
    expect(other?.warnings[0]).toMatch(/double panel/);
  });
});

describe('same-name collisions are allowed with a warning', () => {
  it('a name that spoke and judged in one round stays, out of Strong', () => {
    const [row] = rankAppearances(
      [
        app({
          teammates: [MATE],
          slots: [
            { round: 'R3', kind: 'speak', team: 'Ashoka A' },
            { round: 'R3', kind: 'judge' },
          ],
        }),
      ],
      ctx(),
    );
    expect(row.tier).toBe('possible');
    expect(row.warnings).toContain(
      'Two people may share this name here: it spoke in round 3 and judged round 3',
    );
  });

  it('another user holding the name is a warning, not a block', () => {
    const [row] = rankAppearances([app({ teammates: [MATE], claimedBy: 'other' })], ctx());
    expect(row.tier).toBe('possible');
    expect(row.warnings).toContain('Another user has this name on their record');
  });
});

describe('evidence line', () => {
  it('names the teammate, the place and the year', () => {
    const [row] = rankAppearances(
      [app({ region: 'South Asia', teammates: [MATE], claimedBy: 'me' })],
      ctx(),
    );
    expect(row.evidence).toEqual([
      'Same name',
      'this name is already on your record',
      'your teammate Priya Rao (SIDO 2025) is on this team',
      'South Asia, 2024',
    ]);
  });

  it('shows the name as the tab lists it, and says when it is only close', () => {
    const [same] = rankAppearances([app({ listedName: 'José Acharya' })], {
      ...ctx(),
      anchors: ['Jose Acharya'],
    });
    expect(same.evidence[0]).toBe('Same name, listed as "José Acharya"');
    const [close] = rankAppearances([app({ listedName: 'A. Acharya', region: null })], ctx());
    expect(close.evidence).toEqual([
      'Close to your name "Abhishek Acharya": listed as "A. Acharya"',
      '2024',
    ]);
  });

  it('a teammate elsewhere at the tournament is weaker evidence', () => {
    const [row] = rankAppearances([app({ teammates: [{ ...MATE, sameTeam: false }] })], ctx());
    expect(row.evidence).toContain(
      'your teammate Priya Rao (SIDO 2025) was also at this tournament',
    );
  });
});

describe('ranking', () => {
  it('orders by tier, then score, then newest', () => {
    const rows = rankAppearances(
      [
        app({ tournamentId: '1', year: 2010 }),
        app({ tournamentId: '2', teammates: [MATE] }),
        app({ tournamentId: '3', year: 2024 }),
      ],
      ctx(),
    );
    expect(rows.map((r) => r.tournamentId)).toEqual(['2', '3', '1']);
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
    // 2010 is more than five years before the user's first tournament.
    expect(rows[2].score).toBe(40 - 15);
  });

  it('carries the recorded decision', () => {
    const [row] = rankAppearances([app()], ctx({ [appearanceKey('10', '100')]: 'rejected' }));
    expect(row.decision).toBe('rejected');
  });
});
