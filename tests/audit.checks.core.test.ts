import { describe, expect, it } from 'vitest';
import { CHECKS_VERSION } from '@/lib/audit/checks';
import { CHECK_LABELS, CHECK_WEIGHTS } from '@/lib/audit/types';
import { check, inputs, piece } from './fixtures/auditInputs';

// Task R10: core_missing. A tournament whose participants list was read but
// names nobody as adjudication core (no Adj Core tick, nobody under the home
// page's staff block) is a warning; the fix reads the participants list and
// the home page again.

const read = [piece('participants', '', 'Participants')];

describe('core_missing', () => {
  it('is registered with weight 2 and a label, and the version moved on', () => {
    expect(CHECK_WEIGHTS.core_missing).toBe(2);
    expect(CHECK_LABELS.core_missing).toBe('Adjudication core');
    expect(CHECKS_VERSION).toBe('2026-10-31.9');
  });

  it('passes when either source names someone', () => {
    const c = check(inputs({ coreNamed: 3, pieces: read }), 'core_missing');
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('3 people are named as adjudication core.');
  });

  it('warns when the list was read and nobody is named, suggesting participants and home', () => {
    const c = check(inputs({ coreNamed: 0, pieces: read }), 'core_missing');
    expect(c.status).toBe('warn');
    expect(c.detail).toBe(
      'No adjudication core is named: the participants list ticks no one as Adj Core and the home page names none.',
    );
    expect(c.pieces.map((p) => `${p.kind}:${p.key}`)).toEqual(['participants:', 'home:']);
    expect(c.pieces[0]!.url).toBe('https://wudc.calicotab.com/wudc/tab/participants/');
  });

  it('is na when the participants list was never read', () => {
    const failed = [{ ...piece('participants', '', 'Participants'), status: 'failed' as const }];
    expect(check(inputs({ coreNamed: 0, pieces: failed }), 'core_missing').status).toBe('na');
    expect(check(inputs({ coreNamed: 0 }), 'core_missing').status).toBe('na');
  });

  it('counts a list read before pieces were recorded: judges are on record', () => {
    const c = check(inputs({ coreNamed: 0, judgeParticipants: 12 }), 'core_missing');
    expect(c.status).toBe('warn');
    expect(c.pieces.map((p) => p.kind)).toEqual(['participants', 'home']);
  });

  it('is na when the tournament withholds the participants list', () => {
    const held = [{ ...piece('participants', '', 'Participants'), status: 'withheld' as const }];
    const c = check(inputs({ coreNamed: 0, pieces: held }), 'core_missing');
    expect(c.status).toBe('na');
    expect(c.pieces).toEqual([]);
  });
});
