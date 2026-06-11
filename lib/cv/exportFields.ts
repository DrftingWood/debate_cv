import type { CvData, CvSpeakerRow, CvJudgeRow } from '@/lib/cv/buildCvData';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { csvLine } from '@/lib/utils/csv';

/**
 * Single source of truth for exportable CV columns. The /api/cv/export
 * route (CSV and XLSX) and the field-picker UI all consume this registry,
 * so adding a column here is the whole job — it shows up in the picker
 * and in both file formats without touching the route.
 *
 * Field order below is the legacy CSV column order. When every field is
 * selected (the default, i.e. a bare GET /api/cv/export) the CSV output
 * is identical to what the route produced before the picker existed —
 * anyone who scripted against the old export keeps working.
 */

export type ExportField = {
  id: string;
  /** Human label for the picker UI and the XLSX header row. */
  label: string;
  /** Accessor for speaker rows; omitted = blank cell in the speaker section. */
  speaker?: (r: CvSpeakerRow) => unknown;
  /** Accessor for judge rows; omitted = blank cell in the judge section. */
  judge?: (r: CvJudgeRow) => unknown;
};

function fmtSpeakerRanks(r: CvSpeakerRow): string {
  return [
    r.speakerRankOpen != null ? `#${r.speakerRankOpen} Open` : null,
    r.speakerRankEsl != null ? `#${r.speakerRankEsl} ESL` : null,
    r.speakerRankEfl != null ? `#${r.speakerRankEfl} EFL` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

// Append "(W)" when the user's team won this outround AND the outround
// was the tournament final, i.e. they won the tournament. Lets the export
// distinguish champions from grand-finalists without an extra column.
// EUDC dual-break case: render every category's deepest outround.
function fmtLastOutroundSpoken(r: CvSpeakerRow): string {
  const multi = r.eliminationReachedByCategory;
  if (multi && multi.length > 1) {
    const joined = multi
      .map((e) => `${e.category}: ${formatStageForDisplay(e.stage)}`)
      .join(' · ');
    return r.wonTournament === true ? `${joined} (W)` : joined;
  }
  if (!r.eliminationReached) return '';
  const display = formatStageForDisplay(r.eliminationReached);
  return r.wonTournament === true ? `${display} (W)` : display;
}

export const EXPORT_FIELDS: ExportField[] = [
  { id: 'tournament', label: 'Tournament', speaker: (r) => r.tournamentName, judge: (r) => r.tournamentName },
  { id: 'year', label: 'Year', speaker: (r) => r.year, judge: (r) => r.year },
  { id: 'format', label: 'Format', speaker: (r) => r.format, judge: (r) => r.format },
  { id: 'teams', label: 'Teams', speaker: (r) => r.totalTeams, judge: (r) => r.totalTeams },
  { id: 'my_name', label: 'My name', speaker: (r) => r.myName, judge: (r) => r.myName },
  { id: 'teammates', label: 'Teammates', speaker: (r) => r.teammates.join(' | ') },
  { id: 'team', label: 'Team', speaker: (r) => r.teamName },
  { id: 'team_rank', label: 'Team rank', speaker: (r) => (r.teamRank != null ? `#${r.teamRank}` : '') },
  {
    id: 'team_points',
    label: 'Team points',
    speaker: (r) => r.teamPoints ?? (r.teamWins != null ? `${r.teamWins}W` : ''),
  },
  { id: 'speaker_average', label: 'Speaker average', speaker: (r) => r.speakerAvgScore },
  { id: 'prelims_spoken', label: 'Prelims spoken', speaker: (r) => r.prelimsSpoken || '' },
  { id: 'speaker_rank', label: 'Speaker rank', speaker: fmtSpeakerRanks },
  {
    id: 'broken',
    label: 'Broken',
    speaker: (r) => (r.broke ? 'Yes' : 'No'),
    judge: (r) => (r.broke ? 'Yes' : 'No'),
  },
  { id: 'last_outround_spoken', label: 'Last outround spoken', speaker: fmtLastOutroundSpoken },
  { id: 'judge_type', label: 'Judge type', judge: (r) => r.judgeTypeTag },
  { id: 'inrounds_judged', label: 'Inrounds judged', judge: (r) => r.inroundsJudged ?? '' },
  { id: 'inrounds_chaired', label: 'Inrounds chaired', judge: (r) => r.inroundsChaired ?? '' },
  { id: 'last_outround_chaired', label: 'Last outround chaired', judge: (r) => r.lastOutroundChaired },
  { id: 'last_outround_judged', label: 'Last outround judged', judge: (r) => r.lastOutroundJudged },
];

export const EXPORT_FIELD_IDS = EXPORT_FIELDS.map((f) => f.id);

/**
 * Resolve a requested field-id list against the registry, preserving
 * registry order (not request order) so column order is stable no matter
 * how the picker serializes its checkbox state. Returns the unknown ids
 * separately so the route can 400 with a useful message instead of
 * silently dropping a typo'd field.
 */
export function resolveExportFields(ids: string[] | null): {
  fields: ExportField[];
  unknown: string[];
} {
  if (ids == null || ids.length === 0) return { fields: EXPORT_FIELDS, unknown: [] };
  const requested = new Set(ids);
  const known = new Set(EXPORT_FIELD_IDS);
  return {
    fields: EXPORT_FIELDS.filter((f) => requested.has(f.id)),
    unknown: ids.filter((id) => !known.has(id)),
  };
}

/**
 * Legacy-shaped CSV: one file, a `section` discriminator column, and a
 * union header where fields that don't apply to a row's section render
 * as blank cells.
 */
export function buildExportCsv(data: CvData, fields: ExportField[]): string {
  const lines = [csvLine(['section', ...fields.map((f) => f.id)])];
  for (const r of data.speakerRows) {
    lines.push(csvLine(['speaker', ...fields.map((f) => (f.speaker ? f.speaker(r) : ''))]));
  }
  for (const r of data.judgeRows) {
    lines.push(csvLine(['judge', ...fields.map((f) => (f.judge ? f.judge(r) : ''))]));
  }
  return lines.join('\n') + '\n';
}

export type ExportSheet = {
  name: string;
  header: string[];
  rows: unknown[][];
};

/**
 * Sheet-shaped export for XLSX: one worksheet per role, each carrying only
 * the selected fields that actually apply to that role (no blank union
 * columns the way the single-file CSV needs). Kept as plain data so tests
 * can assert on content without pulling exceljs into the test run — the
 * route owns the workbook serialization.
 */
export function buildExportSheets(data: CvData, fields: ExportField[]): ExportSheet[] {
  const sheets: ExportSheet[] = [];
  const speakerFields = fields.filter((f) => f.speaker);
  if (speakerFields.length > 0 && data.speakerRows.length > 0) {
    sheets.push({
      name: 'Speaking',
      header: speakerFields.map((f) => f.label),
      rows: data.speakerRows.map((r) => speakerFields.map((f) => f.speaker!(r) ?? '')),
    });
  }
  const judgeFields = fields.filter((f) => f.judge);
  if (judgeFields.length > 0 && data.judgeRows.length > 0) {
    sheets.push({
      name: 'Judging',
      header: judgeFields.map((f) => f.label),
      rows: data.judgeRows.map((r) => judgeFields.map((f) => f.judge!(r) ?? '')),
    });
  }
  return sheets;
}
