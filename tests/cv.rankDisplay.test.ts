import { describe, expect, test } from 'vitest';
import { hashRank, rankLabel, tiedRanks } from '@/lib/cv/rankDisplay';
import { formatTeamTabPlacement, teamTabPlacement } from '@/lib/cv/teamPlacement';
import { buildExportCsv, EXPORT_FIELDS } from '@/lib/cv/exportFields';
import { makeCvData, makeSpeakerRow } from './setup/cv-fixtures';

describe('tied ranks read "5=" (I17)', () => {
  test('labels', () => {
    expect(rankLabel(5, true)).toBe('5=');
    expect(rankLabel(5, false)).toBe('5');
    expect(rankLabel(5, undefined)).toBe('5');
    expect(hashRank(12, true)).toBe('#12=');
    expect(hashRank(1, null)).toBe('#1');
  });

  test('a rank is tied only when two or more competitors hold it', () => {
    expect(tiedRanks([1, 2, 2, 4, null, 5, 5, 5])).toEqual(new Set([2, 5]));
    expect(tiedRanks([1, 2, 3])).toEqual(new Set());
  });

  test('placement wording keeps the number but marks the tie; sort values are untouched', () => {
    const p = teamTabPlacement(3, 40)!;
    expect(formatTeamTabPlacement(p)).toBe('3 of 40 teams · top 8%');
    expect(formatTeamTabPlacement(p, true)).toBe('3= of 40 teams · top 8%');
    // The underlying numbers never carry the marker.
    expect(p.rank).toBe(3);
  });

  test('exports mark tied team and speaker ranks and leave the rest alone', () => {
    const csv = buildExportCsv(
      makeCvData({
        speakerRows: [
          makeSpeakerRow({ teamRank: 5, teamRankTied: true, speakerRankOpen: 7, speakerRankTied: true }),
          makeSpeakerRow({ tournamentId: 9n, teamRank: 6, speakerRankOpen: 8 }),
        ],
        judgeRows: [],
      }),
      EXPORT_FIELDS,
    );
    // Owner: the export's team_rank is machine-clean, the "=" is display-only.
    expect(csv).toContain(',#5,');
    expect(csv).not.toContain(',#5=,');
    expect(csv).toContain('#7= Open');
    expect(csv).toContain('#6');
    expect(csv).not.toContain('#6=');
    expect(csv).toContain('#8 Open');
  });
});
