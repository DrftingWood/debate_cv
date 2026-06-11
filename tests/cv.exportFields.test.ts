import { describe, expect, test } from 'vitest';
import {
  EXPORT_FIELDS,
  EXPORT_FIELD_IDS,
  resolveExportFields,
  buildExportCsv,
  buildExportSheets,
} from '@/lib/cv/exportFields';
import { makeCvData, makeSpeakerRow, makeJudgeRow } from './setup/cv-fixtures';

describe('resolveExportFields', () => {
  test('null/empty selects the full registry in order', () => {
    expect(resolveExportFields(null).fields).toEqual(EXPORT_FIELDS);
    expect(resolveExportFields([]).fields).toEqual(EXPORT_FIELDS);
  });

  test('preserves registry order regardless of request order', () => {
    const { fields, unknown } = resolveExportFields(['year', 'tournament']);
    expect(fields.map((f) => f.id)).toEqual(['tournament', 'year']);
    expect(unknown).toEqual([]);
  });

  test('reports unknown ids instead of silently dropping them', () => {
    const { unknown } = resolveExportFields(['tournament', 'speaker_position']);
    expect(unknown).toEqual(['speaker_position']);
  });
});

describe('buildExportCsv', () => {
  // The full-registry CSV is the legacy export format — scripts written
  // against the pre-picker route depend on this exact header.
  test('default header matches the legacy column set', () => {
    const csv = buildExportCsv(makeCvData(), EXPORT_FIELDS);
    expect(csv.split('\n')[0]).toBe(
      [
        'section',
        'tournament',
        'year',
        'format',
        'teams',
        'my_name',
        'teammates',
        'team',
        'team_rank',
        'team_points',
        'speaker_average',
        'prelims_spoken',
        'speaker_rank',
        'broken',
        'last_outround_spoken',
        'judge_type',
        'inrounds_judged',
        'inrounds_chaired',
        'last_outround_chaired',
        'last_outround_judged',
      ].join(','),
    );
  });

  test('renders speaker and judge rows with section-inapplicable cells blank', () => {
    const data = makeCvData({
      speakerRows: [
        makeSpeakerRow({
          tournamentName: 'Mumbai Open',
          year: 2025,
          teamRank: 3,
          speakerAvgScore: '77.5',
          prelimsSpoken: 5,
          speakerRankOpen: 9,
          broke: true,
          eliminationReached: 'Grand Final',
          wonTournament: true,
        }),
      ],
      judgeRows: [
        makeJudgeRow({
          tournamentName: 'Delhi IV',
          judgeTypeTag: 'core',
          inroundsJudged: 5,
          inroundsChaired: 4,
        }),
      ],
    });
    const lines = buildExportCsv(data, EXPORT_FIELDS).trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith('speaker,Mumbai Open,2025,')).toBe(true);
    expect(lines[1]).toContain('#3');
    expect(lines[1]).toContain('77.5');
    expect(lines[1]).toContain('#9 Open');
    // formatStageForDisplay canonicalizes "Grand Final" → "Final".
    expect(lines[1]).toContain(',Final (W)');
    // Judge row leaves the speaker-only columns blank but fills judge columns.
    expect(lines[2].startsWith('judge,Delhi IV,')).toBe(true);
    expect(lines[2]).toContain('core,5,4');
  });

  test('subset selection narrows columns', () => {
    const { fields } = resolveExportFields(['tournament', 'speaker_average']);
    const data = makeCvData({
      speakerRows: [makeSpeakerRow({ tournamentName: 'Mumbai Open', speakerAvgScore: '77.5' })],
    });
    const lines = buildExportCsv(data, fields).trimEnd().split('\n');
    expect(lines[0]).toBe('section,tournament,speaker_average');
    expect(lines[1]).toBe('speaker,Mumbai Open,77.5');
  });
});

describe('buildExportSheets', () => {
  test('emits one sheet per role with only that role’s applicable fields', () => {
    const data = makeCvData({
      speakerRows: [makeSpeakerRow({ tournamentName: 'Mumbai Open' })],
      judgeRows: [makeJudgeRow({ tournamentName: 'Delhi IV' })],
    });
    const { fields } = resolveExportFields(['tournament', 'teammates', 'judge_type']);
    const sheets = buildExportSheets(data, fields);
    expect(sheets.map((s) => s.name)).toEqual(['Speaking', 'Judging']);
    // teammates is speaker-only, judge_type judge-only — each sheet keeps its own.
    expect(sheets[0].header).toEqual(['Tournament', 'Teammates']);
    expect(sheets[1].header).toEqual(['Tournament', 'Judge type']);
    expect(sheets[0].rows[0][0]).toBe('Mumbai Open');
    expect(sheets[1].rows[0][0]).toBe('Delhi IV');
  });

  test('skips a sheet entirely when the user has no rows for that role', () => {
    const data = makeCvData({ speakerRows: [makeSpeakerRow()] });
    const sheets = buildExportSheets(data, EXPORT_FIELDS);
    expect(sheets.map((s) => s.name)).toEqual(['Speaking']);
  });

  test('skips a sheet when no selected field applies to that role', () => {
    const data = makeCvData({
      speakerRows: [makeSpeakerRow()],
      judgeRows: [makeJudgeRow()],
    });
    const { fields } = resolveExportFields(['teammates']);
    const sheets = buildExportSheets(data, fields);
    expect(sheets.map((s) => s.name)).toEqual(['Speaking']);
  });
});

describe('registry invariants', () => {
  test('ids are unique and every field applies to at least one role', () => {
    expect(new Set(EXPORT_FIELD_IDS).size).toBe(EXPORT_FIELDS.length);
    for (const f of EXPORT_FIELDS) {
      expect(Boolean(f.speaker || f.judge)).toBe(true);
    }
  });
});
