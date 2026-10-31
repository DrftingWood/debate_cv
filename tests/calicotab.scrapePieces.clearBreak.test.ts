import { describe, expect, test, vi } from 'vitest';
import { clearPieces, piecesToClear, type PieceOutcome } from '@/lib/calicotab/scrapePieces';

// Re-scraping a break piece must remove that bracket's old break rows before
// the new ones are written, so a team stored as a breaker by an earlier,
// wrong parse (a withdrawn team) does not survive the re-scrape.

const outcome = (url: string): PieceOutcome => ({
  kind: 'break',
  key: url,
  label: 'Break: Open',
  url,
  ok: true,
  httpStatus: 200,
  error: null,
});

describe('re-scraping a break piece', () => {
  const url = 'https://x.calicotab.com/t/break/teams/open/';

  test('piecesToClear selects the bracket stage when its break rows parsed', () => {
    const out = piecesToClear([outcome(url)], {
      rounds: [],
      teamRowCount: 0,
      breakStages: new Set(['Open']),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.breakStage).toBe('Open');
  });

  test('clearPieces deletes that stage’s break rows (result null) and nothing else', async () => {
    const eliminationResult = { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const teamResult = { deleteMany: vi.fn() };
    const tx = { eliminationResult, teamResult } as never;
    const pieces = piecesToClear([outcome(url)], {
      rounds: [],
      teamRowCount: 0,
      breakStages: new Set(['Open']),
    });
    await clearPieces(tx, 7n, pieces);
    expect(eliminationResult.deleteMany).toHaveBeenCalledTimes(1);
    expect(eliminationResult.deleteMany).toHaveBeenCalledWith({
      where: { tournamentId: 7n, stage: 'Open', result: null },
    });
    expect(teamResult.deleteMany).not.toHaveBeenCalled();
  });
});
