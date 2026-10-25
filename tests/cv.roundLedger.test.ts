import { describe, expect, it } from 'vitest';
import {
  bpPlacement,
  cumulativePoints,
  isFourTeamRound,
  ledgerRoundNames,
} from '@/lib/cv/roundLedger';

describe('ledgerRoundNames', () => {
  it('names prelims "Round N" and never the bare R7 shorthand', () => {
    const names = ledgerRoundNames({ roundNumbers: [1, 2, 3], prelimRoundCount: 5, eliminationReached: null });
    expect([...names.values()]).toEqual(['Round 1', 'Round 2', 'Round 3']);
  });

  it('counts back from the stage the team reached to name its outrounds', () => {
    // 5 prelims, then rounds 6-8: the team lost in the final, so round 8 is
    // the Final, round 7 the Semifinals and round 6 the Quarterfinals.
    const names = ledgerRoundNames({
      roundNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
      prelimRoundCount: 5,
      eliminationReached: 'Final',
    });
    expect(names.get(5)).toBe('Round 5');
    expect(names.get(6)).toBe('Quarterfinals');
    expect(names.get(7)).toBe('Semifinals');
    expect(names.get(8)).toBe('Final');
  });

  it('ends at the stage the team went out in, not at the final', () => {
    const names = ledgerRoundNames({
      roundNumbers: [1, 2, 3, 4, 5, 6, 7],
      prelimRoundCount: 5,
      eliminationReached: 'Semifinals',
    });
    expect(names.get(6)).toBe('Quarterfinals');
    expect(names.get(7)).toBe('Semifinals');
  });

  it('reads a stage with a break category ("ESL Semifinals") as its base stage', () => {
    const names = ledgerRoundNames({
      roundNumbers: [1, 2, 3, 4, 5, 6],
      prelimRoundCount: 5,
      eliminationReached: 'ESL Semifinals',
    });
    expect(names.get(6)).toBe('Semifinals');
  });

  it('falls back to "Round N" when the stage is unknown or the ladder runs out', () => {
    const none = ledgerRoundNames({ roundNumbers: [6, 7], prelimRoundCount: 5, eliminationReached: null });
    expect(none.get(6)).toBe('Round 6');
    expect(none.get(7)).toBe('Round 7');
    // More outrounds than the ladder has stages before "Semifinals".
    const tooMany = ledgerRoundNames({
      roundNumbers: [6, 7, 8, 9, 10, 11, 12, 13],
      prelimRoundCount: 5,
      eliminationReached: 'Semifinals',
    });
    expect(tooMany.get(13)).toBe('Semifinals');
    expect(tooMany.get(6)).toBe('Round 6');
  });

  it('treats every round as a prelim when the prelim count is unknown', () => {
    const names = ledgerRoundNames({ roundNumbers: [1, 2], prelimRoundCount: null, eliminationReached: 'Final' });
    expect([...names.values()]).toEqual(['Round 1', 'Round 2']);
  });
});

describe('cumulativePoints', () => {
  it('adds each round to the total before it, in round order', () => {
    const out = cumulativePoints([
      { roundNumber: 2, points: 1 },
      { roundNumber: 1, points: 3 },
      { roundNumber: 3, points: 2 },
    ]);
    expect(out.get(1)).toBe(3);
    expect(out.get(2)).toBe(4);
    expect(out.get(3)).toBe(6);
  });

  it('leaves a round with no parsed points blank without breaking the run', () => {
    const out = cumulativePoints([
      { roundNumber: 1, points: 3 },
      { roundNumber: 2, points: null },
      { roundNumber: 3, points: 1 },
    ]);
    expect(out.get(1)).toBe(3);
    expect(out.has(2)).toBe(false);
    expect(out.get(3)).toBe(4);
  });
});

describe('four-team (BP) rounds', () => {
  it('recognises a BP round by its seat or by the tournament format', () => {
    expect(isFourTeamRound({ position: 'OG', format: null })).toBe(true);
    expect(isFourTeamRound({ position: 'CO', format: null })).toBe(true);
    expect(isFourTeamRound({ position: null, format: 'BP' })).toBe(true);
    expect(isFourTeamRound({ position: 'Gov', format: 'AP' })).toBe(false);
    expect(isFourTeamRound({ position: null, format: null })).toBe(false);
  });

  it('turns BP round points into a placement', () => {
    expect(bpPlacement(3)).toBe('1st');
    expect(bpPlacement(2)).toBe('2nd');
    expect(bpPlacement(1)).toBe('3rd');
    expect(bpPlacement(0)).toBe('4th');
    expect(bpPlacement(null)).toBeNull();
    expect(bpPlacement(7)).toBeNull();
  });
});
