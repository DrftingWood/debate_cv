import { describe, expect, it } from 'vitest';
import { CHECKS_VERSION } from '@/lib/audit/checks';
import { CHECK_LABELS, CHECK_WEIGHTS } from '@/lib/audit/types';
import { bpRows, check, inputs, piece } from './fixtures/auditInputs';

// Task R9: format_missing. A tournament whose stored rounds exist but whose
// format was never decided fails, and the fix is to infer it from what is
// stored; with no rounds there is nothing to decide from, so it is na.

describe('format_missing', () => {
  it('is registered with weight 3 and a label, and the version moved on', () => {
    expect(CHECK_WEIGHTS.format_missing).toBe(3);
    expect(CHECK_LABELS.format_missing).toBe('Format');
    expect(CHECKS_VERSION).toBe('2026-10-31.8');
  });

  it('passes when a format is recorded', () => {
    const c = check(inputs({ roundRows: bpRows([8, 8, 8]) }), 'format_missing');
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('The format is British Parliamentary.');
  });

  it('fails with no format while rounds are stored, pointing at R1 and the team tab', () => {
    const c = check(inputs({ format: null, roundRows: bpRows([8, 8, 8]) }), 'format_missing');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('No format is recorded, though 3 rounds are stored.');
    expect(c.pieces.map((p) => `${p.kind}:${p.key}`)).toEqual(['round:1', 'team:']);
  });

  it('uses the recorded pieces for the suggested pages', () => {
    const c = check(
      inputs({
        format: null,
        roundRows: bpRows([8]),
        pieces: [piece('round', '1', 'R1'), piece('team', '', 'Team tab')],
      }),
      'format_missing',
    );
    expect(c.pieces.map((p) => p.url)).toEqual([
      'https://wudc.calicotab.com/wudc/results/round/1/',
      'https://wudc.calicotab.com/wudc/tab/team/',
    ]);
  });

  it('is na with no rounds stored, never a failure', () => {
    const c = check(inputs({ format: null }), 'format_missing');
    expect(c.status).toBe('na');
    expect(c.pieces).toEqual([]);
  });

  it('an empty-string format counts as missing', () => {
    const c = check(inputs({ format: '  ', roundRows: bpRows([8]) }), 'format_missing');
    expect(c.status).toBe('fail');
  });
});
