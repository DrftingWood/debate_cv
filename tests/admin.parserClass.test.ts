import { describe, expect, it } from 'vitest';
import { classifyWarning, isPlainProblem } from '@/lib/admin/parserClass';
import { warningHeadline } from '@/lib/admin/parserWarnings';

// Task R2: the parser warnings that reach the Inbox. On 2026-10-31 the live
// list was led by informational notes ("competition likely finished" ×184,
// "breakTabs not found (optional)", "constructed as fallback", "tab not
// released", "limited tab visibility") while the real problems ("round → 0
// results", "fetch: participants HTTP 403", "resultsRounds not found") were
// buried under them. Every headline below is one the parser writes
// (lib/calicotab/provenance.ts, ingest.ts, tabbycatApi.ts), cut where the
// ledger groups it (warningHeadline).

const INFO = [
  'timing: competition likely finished (private URL email is older than 30 days)',
  'nav: breakTabs not found (optional)',
  'nav: teamTab constructed as fallback',
  'nav: speakerTab constructed as fallback',
  'nav: participants constructed as fallback',
  'tabs: team tab not released',
  'tabs: speaker tab not released',
  'nav: limited tab visibility may be intentional (e.g., schools/child-protection privacy settings)',
];

const PROBLEMS = [
  'parse: round https://wudc.calicotab.com/wudc/results/round/3/ → 0 results',
  'parse: teamTab → 0 rows',
  'parse: speakerTab → 0 rows',
  'parse: participants → 0 rows',
  'parse: 0 adjudicator rounds in private-URL Debates table',
  'fetch: participants HTTP 403',
  'fetch: round https://x.calicotab.com/x/results/round/2/ HTTP 500',
  'nav: resultsRounds not found',
];

describe('classifyWarning', () => {
  it.each(INFO)('leaves out the informational note "%s"', (h) => {
    expect(classifyWarning(h)).toBe('info');
  });

  it.each(PROBLEMS)('surfaces the problem "%s"', (h) => {
    expect(classifyWarning(h)).toBe('problem');
  });

  it('classifies the headline the ledger groups on, not only the raw warning', () => {
    const raw = 'parse: round https://a.calicotab.com/a/results/round/1/ → 0 results — vue: none';
    expect(classifyWarning(warningHeadline(raw))).toBe('problem');
    expect(classifyWarning(raw)).toBe('problem');
  });

  it('surfaces a headline it has never seen rather than hiding it', () => {
    expect(classifyWarning('nav: teamTab not found')).toBe('problem');
    expect(classifyWarning('missing: registration.personName')).toBe('problem');
    expect(classifyWarning('something entirely new')).toBe('problem');
  });

  it('ignores case', () => {
    expect(classifyWarning('NAV: BREAKTABS NOT FOUND (OPTIONAL)')).toBe('info');
    expect(classifyWarning('Fetch: team tab http 404')).toBe('problem');
  });
});

describe('isPlainProblem', () => {
  it('is true for the named problem shapes and false for an unknown headline', () => {
    expect(isPlainProblem('parse: teamTab → 0 rows')).toBe(true);
    expect(isPlainProblem('fetch: participants HTTP 403')).toBe(true);
    expect(isPlainProblem('nav: resultsRounds not found')).toBe(false);
    expect(isPlainProblem('nav: breakTabs not found (optional)')).toBe(false);
  });
});
