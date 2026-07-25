import { describe, expect, test } from 'vitest';
import {
  EXPORT_FIELDS,
  EXPORT_FIELD_IDS,
  resolveExportFields,
  buildExportCsv,
  buildExportSheets,
  exportNeedsFieldStats,
} from '@/lib/cv/exportFields';
import { makeCvData, makeSpeakerRow, makeJudgeRow, makeMotion } from './setup/cv-fixtures';

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
  // The legacy columns must stay first and in order — scripts written
  // against the pre-picker route consume them positionally. New fields
  // append at the tail (see the registry's append-only note).
  test('default header keeps legacy columns first, additions at the tail', () => {
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
        'region',
        'field_placement',
        'field_average',
        'field_delta',
        'motions',
        'motion_types',
        'motion_topics',
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

// Field placement and motions are per-TOURNAMENT facts on sibling arrays,
// not row columns, so these exercise the ExportContext join rather than a
// plain accessor.
describe('export context columns', () => {
  const rows = [
    makeSpeakerRow({
      tournamentId: 1n,
      tournamentName: 'Mumbai Open',
      speakerAvgScore: '77.5',
      roundScores: [
        { roundNumber: 1, positionLabel: null, score: 77 },
        { roundNumber: 2, positionLabel: null, score: 78 },
      ],
      teamRoundResults: [
        { roundNumber: 1, position: 'OG', won: true, points: 3 },
        { roundNumber: 2, position: 'CO', won: false, points: 1 },
      ],
    }),
  ];

  test('placement, field average and signed delta come from the field summary', () => {
    const data = makeCvData({
      speakerRows: rows,
      fieldStats: [
        {
          tournamentId: 1n,
          speakerCount: 91,
          fieldMeanAvg: 73.14,
          fieldStdevAvg: 2.4,
          fieldMedianAvg: 73,
          fieldP90Avg: 77,
          betterThanUser: 8,
          userScoredRounds: 5,
          prelimRoundCount: 5,
        },
      ],
    });
    const { fields } = resolveExportFields(['field_placement', 'field_average', 'field_delta']);
    const lines = buildExportCsv(data, fields).trimEnd().split('\n');
    // betterThanUser is a count of speakers ABOVE, so the rank is +1.
    expect(lines[1]).toBe('speaker,9/91,73.1,+4.4');
  });

  test('a tournament with no field summary exports blanks, not zeroes', () => {
    const { fields } = resolveExportFields(['field_placement', 'field_average', 'field_delta']);
    const lines = buildExportCsv(makeCvData({ speakerRows: rows }), fields).trimEnd().split('\n');
    expect(lines[1]).toBe('speaker,,,');
  });

  test('motions cover only the rounds the user actually debated', () => {
    const data = makeCvData({
      speakerRows: rows,
      taggedMotions: [
        makeMotion({ tournamentId: 1n, roundNumber: 2, seq: 1, text: 'THW b', motionType: 'THW', topic: 'Law' }),
        makeMotion({ tournamentId: 1n, roundNumber: 1, seq: 0, text: 'THW a', motionType: 'THW', topic: 'Economics' }),
        // Round 4 was never debated by this user; round 9's motion belongs
        // to a different tournament entirely.
        makeMotion({ tournamentId: 1n, roundNumber: 4, seq: 0, text: 'THO c', motionType: 'THO', topic: 'Health' }),
        makeMotion({ tournamentId: 2n, roundNumber: 1, seq: 0, text: 'THR d', motionType: 'THR', topic: 'Health' }),
      ],
    });
    const { fields } = resolveExportFields(['motions', 'motion_types', 'motion_topics']);
    const lines = buildExportCsv(data, fields).trimEnd().split('\n');
    const cell = lines[1];
    expect(cell).toContain('THW a');
    expect(cell).toContain('THW b');
    expect(cell).not.toContain('THO c');
    expect(cell).not.toContain('THR d');
    // Sorted by round number even though the fixture listed round 2 first.
    expect(cell.indexOf('THW a')).toBeLessThan(cell.indexOf('THW b'));
    // Types dedupe; topics keep both distinct values in round order.
    expect(cell).toContain('THW');
    expect(cell.endsWith('Economics | Law')).toBe(true);
  });

  test('only placement columns force the expensive field-summary query', () => {
    expect(exportNeedsFieldStats(resolveExportFields(['field_placement']).fields)).toBe(true);
    expect(exportNeedsFieldStats(resolveExportFields(['field_delta']).fields)).toBe(true);
    expect(exportNeedsFieldStats(resolveExportFields(['motions', 'tournament']).fields)).toBe(false);
    // A bare GET selects everything, so it does pay for it.
    expect(exportNeedsFieldStats(EXPORT_FIELDS)).toBe(true);
  });
});
