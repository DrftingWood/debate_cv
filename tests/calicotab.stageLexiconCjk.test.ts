import { describe, expect, test } from 'vitest';
import { matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';

const stageOf = (s: string) => matchStage(s)?.stage ?? null;

describe('Chinese stage names', () => {
  // 八强赛 / 四强赛 / 总决赛 and 的-joined category forms were all observed in
  // the corpus; the rest of the family is added with them because it is the
  // same naming system (N强 = "the last N", 决赛 = final).
  test('the "last N" forms name their round', () => {
    expect(stageOf('八强赛')).toBe('quarterfinal'); // last 8
    expect(stageOf('四强赛')).toBe('semifinal'); // last 4
    expect(stageOf('十六强赛')).toBe('octofinal'); // last 16
    expect(stageOf('三十二强')).toBe('double_octofinal'); // last 32
  });

  test('the 决赛 family', () => {
    expect(stageOf('决赛')).toBe('final');
    expect(stageOf('总决赛')).toBe('grand_final');
    expect(stageOf('半决赛')).toBe('semifinal');
    expect(stageOf('四分之一决赛')).toBe('quarterfinal');
  });

  test('traditional characters too', () => {
    expect(stageOf('決賽')).toBe('final');
    expect(stageOf('總決賽')).toBe('grand_final');
    expect(stageOf('半決賽')).toBe('semifinal');
    expect(stageOf('八強賽')).toBe('quarterfinal');
    expect(stageOf('四強')).toBe('semifinal');
  });

  test('a more specific form still beats the bare 决赛', () => {
    // Every one of these contains 决赛 or 賽.
    expect(stageOf('总决赛')).toBe('grand_final');
    expect(stageOf('半决赛')).toBe('semifinal');
    expect(stageOf('四分之一决赛')).toBe('quarterfinal');
  });

  test('the category survives the 的 particle', () => {
    // "Novice的决赛" — 的 is possessive and belongs to neither half.
    expect(splitStageLabel('Novice的决赛')).toEqual({ category: 'Novice', stage: 'final' });
    expect(splitStageLabel('Novice的四强赛')).toEqual({ category: 'Novice', stage: 'semifinal' });
  });

  test('a plain Chinese round is a prelim, not an outround', () => {
    expect(stageOf('赛1')).toBe(null);
    expect(stageOf('第一轮')).toBe(null);
  });
});

describe('Japanese stage names', () => {
  test('the 決勝 family', () => {
    expect(stageOf('決勝')).toBe('final');
    expect(stageOf('準決勝')).toBe('semifinal');
    expect(stageOf('準々決勝')).toBe('quarterfinal');
  });

  test('a more specific form beats the bare 決勝', () => {
    // 準決勝 and 準々決勝 both contain 決勝.
    expect(stageOf('準決勝')).not.toBe('final');
    expect(stageOf('準々決勝')).not.toBe('final');
  });

  test('katakana rounds are prelims', () => {
    expect(stageOf('ラウンド1')).toBe(null);
    expect(stageOf('ラウンド6')).toBe(null);
  });
});

describe('"Octas"', () => {
  // From "Open Partial Double Octas" in the corpus — a common short form
  // for octofinals alongside the Spanish "octavos".
  test('is the octofinal round', () => {
    expect(stageOf('Octas')).toBe('octofinal');
    expect(stageOf('Partial Octas')).toBe('octofinal');
  });

  test('and doubles still win over it', () => {
    expect(stageOf('Open Partial Double Octas')).toBe('double_octofinal');
    expect(splitStageLabel('Open Partial Double Octas')).toEqual({
      category: 'Open',
      stage: 'double_octofinal',
    });
  });
});
