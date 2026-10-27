import { describe, expect, it } from 'vitest';
import {
  judgeSlot,
  presenceClash,
  roundLabel,
  selfClash,
  slotsClash,
  speakSlot,
  type Slot,
} from '@/lib/discovery/rounds';

const speak = (round: string, team = 'Team A'): Slot => ({ round, kind: 'speak', team });
const judge = (round: string): Slot => ({ round, kind: 'judge' });

describe('slotsClash (owner same-round rule)', () => {
  it('speaking and judging in one round is two people', () => {
    expect(slotsClash(speak('R3'), judge('R3'), false)).toBe('block');
  });

  it('two teams in one round is two people', () => {
    expect(slotsClash(speak('R2', 'A'), speak('R2', 'B'), false)).toBe('block');
  });

  it('two panels in one round only needs a check (HWS double panels)', () => {
    expect(slotsClash(judge('R4'), judge('R4'), false)).toBe('check');
  });

  it('different rounds never clash: spoke the prelims, judged an outround', () => {
    expect(slotsClash(speak('R3'), judge('R4'), false)).toBeNull();
    expect(slotsClash(speak('R5'), judge('semifinal'), false)).toBeNull();
    expect(slotsClash(speak('quarterfinal'), judge('semifinal'), false)).toBeNull();
  });

  it('Open and Novice finals run together: one person cannot be in both', () => {
    expect(slotsClash(speak('grand_final', 'A'), speak('final novice', 'B'), false)).toBe('block');
    expect(slotsClash(speak('final novice'), judge('grand_final'), false)).toBe('block');
  });

  it('Open and ESL outrounds of one stage: allowed at EUDC only', () => {
    expect(slotsClash(speak('semifinal'), speak('semifinal esl'), true)).toBeNull();
    expect(slotsClash(speak('semifinal'), speak('semifinal esl'), false)).toBe('block');
    // EUDC's exception is Open + ESL, not any pair of brackets.
    expect(slotsClash(speak('semifinal'), speak('semifinal novice'), true)).toBe('block');
  });
});

describe('presenceClash', () => {
  it('reports the worst clash between two names', () => {
    const a = [speak('R1'), judge('R5')];
    const b = [judge('R5'), judge('R1')];
    expect(presenceClash(a, b, false)?.level).toBe('block');
    expect(presenceClash([judge('R5')], [judge('R5')], false)?.level).toBe('check');
    expect(presenceClash([speak('R1')], [judge('R2')], false)).toBeNull();
  });
});

describe('selfClash (two people merged under one name)', () => {
  it('flags a name that spoke and judged in one round', () => {
    expect(selfClash([speak('R3'), judge('R3')], false)).not.toBeNull();
  });

  it('flags a team in both the Open and the Novice final', () => {
    expect(selfClash([speak('grand_final'), speak('final novice')], false)).not.toBeNull();
  });

  it('ignores double panels, repeated rows and EUDC Open+ESL', () => {
    expect(selfClash([judge('R2'), judge('R2')], false)).toBeNull();
    expect(selfClash([speak('R2'), speak('R2')], false)).toBeNull();
    expect(selfClash([speak('semifinal'), speak('semifinal esl')], true)).toBeNull();
  });
});

describe('slot builders and labels', () => {
  it('reads labels through roundKey', () => {
    expect(speakSlot(null, 3, 'A')).toEqual({ round: 'R3', kind: 'speak', team: 'A' });
    expect(speakSlot('Novice Final', null, 'A')?.round).toBe('final novice');
    expect(judgeSlot('Round 1B', 1)?.round).toBe('R1');
    expect(judgeSlot(null, null)).toBeNull();
  });

  it('says rounds in words', () => {
    expect(roundLabel('R3')).toBe('round 3');
    expect(roundLabel('final novice')).toBe('the novice final');
    expect(roundLabel('grand_final')).toBe('the grand final');
  });
});
