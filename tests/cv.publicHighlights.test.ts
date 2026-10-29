/**
 * The public CV's two Highlights lists (lib/cv/publicHighlights.ts; owner
 * decision 18, 2026-10-29): up to three per role, majors first, deeper
 * results first, never a tournament without a break or outround.
 */
import { describe, expect, it } from 'vitest';
import { publicHighlights } from '@/lib/cv/publicHighlights';
import { makeJudgeRow, makeSpeakerRow } from './setup/cv-fixtures';

describe('publicHighlights', () => {
  it('puts a major first, then the deeper result, and caps each list at three', () => {
    const { speaking } = publicHighlights(
      [
        makeSpeakerRow({
          tournamentName: 'Local Open',
          broke: true,
          eliminationReached: 'Grand Final',
          wonTournament: true,
        }),
        makeSpeakerRow({
          tournamentName: 'World Universities Debating Championship 2024',
          broke: true,
          eliminationReached: 'Quarterfinals',
        }),
        makeSpeakerRow({
          tournamentName: 'City IV',
          broke: true,
          eliminationReached: 'Semifinals',
        }),
        makeSpeakerRow({
          tournamentName: 'Town IV',
          broke: true,
          eliminationReached: 'Quarterfinals',
        }),
        makeSpeakerRow({ tournamentName: 'No Break Cup', broke: false }),
      ],
      [],
    );
    expect(speaking.map((h) => h.tournamentName)).toEqual([
      'World Universities Debating Championship 2024',
      'Local Open',
      'City IV',
    ]);
    expect(speaking[0].major).toBe(true);
  });

  it('never lists a judging tournament without an outround', () => {
    const { judging } = publicHighlights(
      [],
      [
        makeJudgeRow({ tournamentName: 'Quiet IV' }),
        makeJudgeRow({ tournamentName: 'Busy IV', lastOutroundChaired: 'Semifinals' }),
      ],
    );
    expect(judging.map((h) => h.tournamentName)).toEqual(['Busy IV']);
  });
});
