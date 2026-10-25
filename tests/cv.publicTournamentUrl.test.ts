import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { publicTournamentUrl } from '@/lib/cv/publicTournamentUrl';

describe('publicTournamentUrl', () => {
  it('reduces a private URL to the tournament home and drops the token', () => {
    const out = publicTournamentUrl('https://wudc2022.calicotab.com/wudc/privateurls/fmugrvq0/');
    expect(out).toBe('https://wudc2022.calicotab.com/wudc/');
    expect(out).not.toMatch(/privateurls|fmugrvq0/);
  });

  it('keeps the scheme it was stored with', () => {
    expect(publicTournamentUrl('http://15thiitbombaydebate.calicotab.com/15thiitbombaydebate2023/privateurls/poxsfblg/')).toBe(
      'http://15thiitbombaydebate.calicotab.com/15thiitbombaydebate2023/',
    );
  });

  it('leaves an already-public base as it is', () => {
    expect(publicTournamentUrl('https://sido2026.calicotab.com/sido2026/')).toBe('https://sido2026.calicotab.com/sido2026/');
  });

  it('never carries a query string, fragment or deeper path', () => {
    expect(publicTournamentUrl('https://a.calicotab.com/t/privateurls/tok/?x=1#frag')).toBe('https://a.calicotab.com/t/');
    expect(publicTournamentUrl('https://a.calicotab.com/t/tab/team/')).toBe('https://a.calicotab.com/t/');
  });

  it('a root-hosted private URL has no tournament segment: the site root, never the token', () => {
    const out = publicTournamentUrl('https://presido2026.calicotab.com/privateurls/secret123/');
    expect(out).toBe('https://presido2026.calicotab.com/');
    expect(out).not.toContain('secret123');
  });

  it('returns an empty string for something that is not a URL rather than echoing it', () => {
    expect(publicTournamentUrl('not a url with privateurls/tok')).toBe('');
    expect(publicTournamentUrl(null)).toBe('');
    expect(publicTournamentUrl(undefined)).toBe('');
  });
});

// A structural guard: the one-line mistake that caused this (copying
// Tournament.sourceUrlRaw straight into something a page renders) must not
// come back. sourceUrlRaw is the first ingester's private URL.
describe('Tournament.sourceUrlRaw is never copied into CV data unfiltered', () => {
  const src = readFileSync(join(process.cwd(), 'lib/cv/buildCvData.ts'), 'utf8');

  it('every sourceUrl / sourceUrlRaw assignment goes through publicTournamentUrl', () => {
    const bad = src.split('\n').filter((l) => /\bsourceUrl(Raw)?:\s*t\.sourceUrlRaw\b/.test(l) && !/publicTournamentUrl\(/.test(l));
    expect(bad).toEqual([]);
  });
});
