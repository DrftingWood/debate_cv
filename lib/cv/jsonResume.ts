import type { CvData, CvJudgeRow, CvSpeakerRow } from './buildCvData';
import { teamTabPlacement, TOP_SPEAKER_RANK } from './teamPlacement';
import { championTitle } from './formatStage';

/**
 * The CV as a JSON Resume document (https://jsonresume.org/schema), so a
 * debate record can be dropped into any JSON Resume theme, resume builder or
 * portfolio template (al-folio and academicpages both read it) instead of
 * being re-typed. Served at /cv.json (and as a download from
 * /api/cv/export?format=json-resume).
 *
 * JSON Resume has no notion of a tournament, so the standard sections carry
 * only what a general reader wants: `awards` for the results that read as
 * achievements (champion, break, top-ten speaker), and nothing invented for
 * `work` or `education`.
 *
 * The full record rides in a namespaced extension, `meta["x-debate-cv"]`
 * (see DEBATE_EXTENSION_KEY). Why there and not at the top level: the
 * v1.0.0 schema (draft-04) sets additionalProperties: false at the top
 * level, so a top-level extension key fails it; the current
 * @jsonresume/schema (1.3.x, draft-07) relaxed that, but older tools still
 * validate against v1.0.0. `meta` is open in both, so the document is valid
 * under each (tests/cv.jsonResume.schema.test.ts checks both, plus the
 * extension's own schema in docs/json-resume-debate-extension.schema.json).
 * The `x-` prefix keeps the key clear of anything JSON Resume may add to
 * `meta` later. Keys follow the CSV export's vocabulary.
 *
 * Built from CvData, so every masking rule the CV already applies
 * (withdrawn teammates, redacted names) carries over untouched. Pure: the
 * route decides who may download it.
 */

export const JSON_RESUME_SCHEMA = 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json';

/** Where the debate extension lives inside `meta`. */
export const DEBATE_EXTENSION_KEY = 'x-debate-cv';
/** Bump on a breaking change to the extension's shape (and its schema file). */
export const DEBATE_EXTENSION_VERSION = 1;


export type JsonResumeAward = { title: string; date?: string; awarder: string; summary?: string };

export type DebateSpeakingEntry = {
  tournament: string;
  year: number | null;
  format: string | null;
  team: string | null;
  teammates: string[];
  teamRank: number | null;
  totalTeams: number | null;
  teamPoints: string | null;
  teamWins: number | null;
  speakerRank: number | null;
  speakerAverage: string | null;
  speakerCategories: string[];
  broke: boolean;
  outroundReached: string | null;
  won: boolean | null;
  source: string;
};

export type DebateJudgingEntry = {
  tournament: string;
  year: number | null;
  format: string | null;
  role: string | null;
  inroundsJudged: number | null;
  inroundsChaired: number | null;
  lastOutroundChaired: string | null;
  lastOutroundJudged: string | null;
  broke: boolean;
  source: string;
};

export type DebateExtension = {
  version: typeof DEBATE_EXTENSION_VERSION;
  summary: CvData['summary'];
  speaking: DebateSpeakingEntry[];
  judging: DebateJudgingEntry[];
};

export type JsonResume = {
  $schema: string;
  basics: { name: string };
  awards: JsonResumeAward[];
  meta: {
    /** URL of this document (JSON Resume: "URL to latest version of this document"). */
    canonical?: string;
    version: string;
    lastModified: string;
    [DEBATE_EXTENSION_KEY]: DebateExtension;
  };
};

export type BuildJsonResumeOptions = {
  now?: Date;
  /** Absolute URL the document is served from; omitted when unknown. */
  canonical?: string;
};

function speakerAward(row: CvSpeakerRow): JsonResumeAward | null {
  const date = row.year != null ? String(row.year) : undefined;
  const rank = row.speakerRankOpen;
  const speakerNote = rank != null && rank <= TOP_SPEAKER_RANK ? `${ordinal(rank)} best speaker` : null;
  let title: string | null = null;
  if (row.wonTournament) title = championTitle(row.eliminationReached);
  else if (row.broke) title = row.eliminationReached ? `Broke — reached ${row.eliminationReached}` : 'Broke to outrounds';
  else if (speakerNote) title = speakerNote.replace(/^./, (c) => c.toUpperCase());
  if (!title) return null;
  // The award's placement is the TEAM's: team-tab rank against the number of
  // teams. A best-speaker note is an individual award and is named as one.
  const team = teamTabPlacement(row.teamRank, row.totalTeams);
  const summary = [
    title !== speakerNote && speakerNote,
    row.teamName && `Team ${row.teamName}`,
    team && `team ranked ${team.rank} of ${team.of} after prelims`,
  ]
    .filter(Boolean)
    .join('; ');
  return { title, ...(date ? { date } : {}), awarder: row.tournamentName, ...(summary ? { summary } : {}) };
}

function judgeAward(row: CvJudgeRow): JsonResumeAward | null {
  if (!row.broke) return null;
  const date = row.year != null ? String(row.year) : undefined;
  const reached = row.lastOutroundChaired ?? row.lastOutroundJudged;
  return {
    title: reached ? `Broke as adjudicator — ${reached}` : 'Broke as adjudicator',
    ...(date ? { date } : {}),
    awarder: row.tournamentName,
  };
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

// Newest first, as a CV reads; undated rows last.
const byYearDesc = <T extends { year: number | null }>(a: T, b: T) => (b.year ?? -Infinity) - (a.year ?? -Infinity);

export function buildJsonResume(data: CvData, options: BuildJsonResumeOptions = {}): JsonResume {
  const now = options.now ?? new Date();
  const speaking = [...data.speakerRows].sort(byYearDesc);
  const judging = [...data.judgeRows].sort(byYearDesc);
  return {
    $schema: JSON_RESUME_SCHEMA,
    basics: { name: data.myDisplayName },
    awards: [
      ...speaking.map(speakerAward),
      ...judging.map(judgeAward),
    ].filter((a): a is JsonResumeAward => a !== null),
    meta: {
      // canonical is the document's own URL, not the schema's ($schema is that).
      ...(options.canonical ? { canonical: options.canonical } : {}),
      version: 'v1.0.0',
      lastModified: now.toISOString(),
      [DEBATE_EXTENSION_KEY]: {
        version: DEBATE_EXTENSION_VERSION,
        summary: data.summary,
        speaking: speaking.map((r) => ({
          tournament: r.tournamentName,
          year: r.year,
          format: r.format,
          team: r.teamName,
          teammates: r.teammates,
          teamRank: r.teamRank,
          totalTeams: r.totalTeams,
          teamPoints: r.teamPoints,
          teamWins: r.teamWins,
          speakerRank: r.speakerRankOpen,
          speakerAverage: r.speakerAvgScore,
          speakerCategories: r.speakerCategories,
          broke: r.broke,
          outroundReached: r.eliminationReached,
          won: r.wonTournament,
          source: r.sourceUrl,
        })),
        judging: judging.map((r) => ({
          tournament: r.tournamentName,
          year: r.year,
          format: r.format,
          role: r.judgeTypeTag,
          inroundsJudged: r.inroundsJudged,
          inroundsChaired: r.inroundsChaired,
          lastOutroundChaired: r.lastOutroundChaired,
          lastOutroundJudged: r.lastOutroundJudged,
          broke: r.broke,
          source: r.sourceUrl,
        })),
      },
    },
  };
}

/** The JSON response both /cv.json and the export route send. */
export function jsonResumeResponse(
  data: CvData,
  options: BuildJsonResumeOptions & { download?: boolean } = {},
): Response {
  const doc = buildJsonResume(data, options);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
  };
  if (options.download) {
    const stamp = doc.meta.lastModified.slice(0, 10);
    headers['Content-Disposition'] = `attachment; filename="debate-cv-${stamp}.resume.json"`;
  }
  return new Response(JSON.stringify(doc, null, 2), { status: 200, headers });
}
