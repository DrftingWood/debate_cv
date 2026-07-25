import type {
  CvData,
  CvSpeakerRow,
  CvJudgeRow,
  CvFieldStat,
  CvTaggedMotion,
} from '@/lib/cv/buildCvData';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { csvLine } from '@/lib/utils/csv';

/**
 * Single source of truth for exportable CV columns. The /api/cv/export
 * route (CSV and XLSX) and the field-picker UI all consume this registry,
 * so adding a column here is the whole job — it shows up in the picker
 * and in both file formats without touching the route.
 *
 * Field order below starts with the legacy CSV column order; the column
 * set is APPEND-ONLY. New fields go at the end so anyone who scripted
 * against the original export positionally keeps working — never insert
 * into or reorder the middle of this list.
 */

/**
 * Everything an accessor may need that does not live on the row itself.
 *
 * Field placement and motions are per-TOURNAMENT facts sitting in sibling
 * arrays on CvData, not columns on CvSpeakerRow, so the accessors need a
 * second argument to reach them. Built once per export by
 * `buildExportContext` rather than re-scanned per row — a heavy CV has
 * hundreds of motions and the naive version is quadratic.
 */
export type ExportContext = {
  fieldByTournament: Map<string, CvFieldStat>;
  motionsByTournament: Map<string, CvTaggedMotion[]>;
};

export function buildExportContext(data: CvData): ExportContext {
  const fieldByTournament = new Map<string, CvFieldStat>();
  for (const f of data.fieldStats) fieldByTournament.set(f.tournamentId.toString(), f);

  const motionsByTournament = new Map<string, CvTaggedMotion[]>();
  for (const m of data.taggedMotions) {
    const key = m.tournamentId.toString();
    const list = motionsByTournament.get(key) ?? [];
    list.push(m);
    motionsByTournament.set(key, list);
  }
  // Round order, then document order within a round, so a motion-per-room
  // tournament exports its motions in the sequence the tab printed them.
  for (const list of motionsByTournament.values()) {
    list.sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0) || a.seq - b.seq);
  }

  return { fieldByTournament, motionsByTournament };
}

export type ExportField = {
  id: string;
  /** Human label for the picker UI and the XLSX header row. */
  label: string;
  /** Accessor for speaker rows; omitted = blank cell in the speaker section. */
  speaker?: (r: CvSpeakerRow, ctx: ExportContext) => unknown;
  /** Accessor for judge rows; omitted = blank cell in the judge section. */
  judge?: (r: CvJudgeRow, ctx: ExportContext) => unknown;
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
  // ── Post-legacy additions (append-only zone) ──────────────────────────
  { id: 'region', label: 'Region', speaker: (r) => r.region, judge: (r) => r.region },
  {
    id: 'field_placement',
    label: 'Field placement',
    speaker: (r, ctx) => {
      const f = ctx.fieldByTournament.get(r.tournamentId.toString());
      if (!f || f.betterThanUser == null || f.speakerCount <= 0) return '';
      return `${f.betterThanUser + 1}/${f.speakerCount}`;
    },
  },
  {
    id: 'field_average',
    label: 'Field average',
    speaker: (r, ctx) => round1(ctx.fieldByTournament.get(r.tournamentId.toString())?.fieldMeanAvg),
  },
  {
    id: 'field_delta',
    label: 'Vs field',
    // Signed on purpose: an export column that reads "-1.4" is unambiguous
    // in a spreadsheet, where a bare 1.4 next to a field average invites
    // the reader to guess the direction.
    speaker: (r, ctx) => {
      const f = ctx.fieldByTournament.get(r.tournamentId.toString());
      const mine = numericAvg(r.speakerAvgScore);
      if (!f || f.fieldMeanAvg == null || mine == null) return '';
      const delta = mine - f.fieldMeanAvg;
      return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
    },
  },
  {
    id: 'motions',
    label: 'Motions',
    speaker: (r, ctx) =>
      debatedMotions(r, ctx)
        .map((m) => `${m.roundLabel}: ${m.text}`)
        .join(' | '),
  },
  {
    id: 'motion_types',
    label: 'Motion types',
    speaker: (r, ctx) => distinct(debatedMotions(r, ctx).map((m) => m.motionType)).join(' | '),
  },
  {
    id: 'motion_topics',
    label: 'Motion topics',
    speaker: (r, ctx) => distinct(debatedMotions(r, ctx).map((m) => m.topic)).join(' | '),
  },
];

/**
 * The fields above that need `buildCvData`'s field-summary query, which is
 * by far its most expensive (it reads every speaker published at every
 * tournament on the CV). The export route consults this so an export that
 * doesn't ask for placement doesn't pay for it.
 */
export const FIELD_STAT_FIELD_IDS = new Set(['field_placement', 'field_average', 'field_delta']);

export function exportNeedsFieldStats(fields: ExportField[]): boolean {
  return fields.some((f) => FIELD_STAT_FIELD_IDS.has(f.id));
}

function round1(n: number | null | undefined): string {
  return n == null ? '' : n.toFixed(1);
}

/** The formatted average is a display string; parse it back or give up. */
function numericAvg(avg: string | null): number | null {
  if (!avg) return null;
  const n = Number(avg);
  return Number.isFinite(n) ? n : null;
}

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

/**
 * The motions released for rounds this user actually debated — a round
 * counts when they were scored in it or their team has a result for it.
 * Motions for rounds they sat out (a swing, a bye, an outround they didn't
 * reach) are the tournament's, not theirs, and putting them on the CV row
 * would claim rounds they never spoke in.
 *
 * Formats running more than one motion per round export all of them, for
 * the same reason the statistics layer credits all of them: without
 * per-room draw data there is no way to tell which one was debated, and
 * dropping the round entirely is the worse error.
 */
function debatedMotions(r: CvSpeakerRow, ctx: ExportContext): CvTaggedMotion[] {
  const all = ctx.motionsByTournament.get(r.tournamentId.toString());
  if (!all || all.length === 0) return [];
  const debated = new Set<number>([
    ...r.roundScores.filter((s) => s.score != null).map((s) => s.roundNumber),
    ...r.teamRoundResults.map((tr) => tr.roundNumber),
  ]);
  if (debated.size === 0) return [];
  return all.filter((m) => m.roundNumber != null && debated.has(m.roundNumber));
}

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
  const ctx = buildExportContext(data);
  const lines = [csvLine(['section', ...fields.map((f) => f.id)])];
  for (const r of data.speakerRows) {
    lines.push(csvLine(['speaker', ...fields.map((f) => (f.speaker ? f.speaker(r, ctx) : ''))]));
  }
  for (const r of data.judgeRows) {
    lines.push(csvLine(['judge', ...fields.map((f) => (f.judge ? f.judge(r, ctx) : ''))]));
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
  const ctx = buildExportContext(data);
  const sheets: ExportSheet[] = [];
  const speakerFields = fields.filter((f) => f.speaker);
  if (speakerFields.length > 0 && data.speakerRows.length > 0) {
    sheets.push({
      name: 'Speaking',
      header: speakerFields.map((f) => f.label),
      rows: data.speakerRows.map((r) => speakerFields.map((f) => f.speaker!(r, ctx) ?? '')),
    });
  }
  const judgeFields = fields.filter((f) => f.judge);
  if (judgeFields.length > 0 && data.judgeRows.length > 0) {
    sheets.push({
      name: 'Judging',
      header: judgeFields.map((f) => f.label),
      rows: data.judgeRows.map((r) => judgeFields.map((f) => f.judge!(r, ctx) ?? '')),
    });
  }
  return sheets;
}
