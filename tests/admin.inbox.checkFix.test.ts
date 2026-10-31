import { describe, expect, it } from 'vitest';
import { checkFix } from '@/lib/admin/inboxFix';
import type { ParsedCheck } from '@/lib/admin/accuracy';

// Task R9: what the Inbox's "Fix" does for a check item. A tournament whose
// only open finding is the missing format gets "Infer format" (a read of
// stored data, no fetch); anything else keeps the re-scrape of the pages its
// findings point at, which also redoes the format.

const R1 = { kind: 'round' as const, key: '1', label: 'R1', url: null };
const TEAM = { kind: 'team' as const, key: '', label: 'Team tab', url: null };
const found = (code: ParsedCheck['code'], pieces = [R1, TEAM]): ParsedCheck => ({
  code,
  status: 'fail',
  detail: 'x',
  pieces,
  assumptions: [],
});

describe('checkFix', () => {
  it('a missing format alone is fixed by inferring it, carrying the pages to fall back on', () => {
    expect(checkFix('7', [found('format_missing')])).toEqual({
      type: 'infer_format',
      tournamentId: '7',
      pieces: [R1, TEAM],
    });
  });

  it('other findings keep the re-scrape', () => {
    expect(checkFix('7', [found('champion', [R1])])).toEqual({
      type: 'rescrape',
      tournamentId: '7',
      pieces: [R1],
    });
  });

  it('a missing format beside other findings is a re-scrape of all their pages', () => {
    const fix = checkFix('7', [found('champion', [R1]), found('format_missing')]);
    expect(fix).toEqual({ type: 'rescrape', tournamentId: '7', pieces: [R1, TEAM] });
  });
});
