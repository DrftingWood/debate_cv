import type { CvData, CvJudgeRow, CvSpeakerRow } from './buildCvData';

/**
 * The CV as a JSON Resume document (https://jsonresume.org/schema, v1.0.0),
 * so a debate record can be dropped into any JSON Resume theme, resume
 * builder or portfolio template (al-folio and academicpages both read it)
 * instead of being re-typed.
 *
 * JSON Resume has no notion of a tournament, so the standard sections carry
 * only what a general reader wants: `awards` for the results that read as
 * achievements (champion, break, top-ten speaker), and nothing invented for
 * `work` or `education`. The full record rides in `meta.debate`: v1.0.0
 * forbids extra top-level properties (validated against the published
 * schema — a top-level `debate` key fails it) but leaves `meta` open, and
 * themes ignore it. Keys follow the CSV export's vocabulary so the two stay
 * legible side by side.
 *
 * Built from CvData, so every masking rule the CV already applies
 * (withdrawn teammates, redacted names) carries over untouched. Pure: the
 * route decides who may download it.
 */

export const JSON_RESUME_SCHEMA = 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json';

/** A speaker rank at or inside this reads as an award on its own. */
const TOP_SPEAKER_RANK = 10;

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

export type JsonResume = {
  $schema: string;
  basics: { name: string };
  awards: JsonResumeAward[];
  meta: {
    canonical: string;
    version: string;
    lastModified: string;
    debate: {
      summary: CvData['summary'];
      speaking: DebateSpeakingEntry[];
      judging: DebateJudgingEntry[];
    };
  };
};

function speakerAward(row: CvSpeakerRow): JsonResumeAward | null {
  const date = row.year != null ? String(row.year) : undefined;
  const rank = row.speakerRankOpen;
  const speakerNote = rank != null && rank <= TOP_SPEAKER_RANK ? `${ordinal(rank)} best speaker` : null;
  let title: string | null = null;
  if (row.wonTournament) title = 'Champion';
  else if (row.broke) title = row.eliminationReached ? `Broke — reached ${row.eliminationReached}` : 'Broke to outrounds';
  else if (speakerNote) title = speakerNote.replace(/^./, (c) => c.toUpperCase());
  if (!title) return null;
  const summary = [title !== speakerNote && speakerNote, row.teamName && `Team ${row.teamName}`]
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

export function buildJsonResume(data: CvData, now: Date = new Date()): JsonResume {
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
      canonical: JSON_RESUME_SCHEMA,
      version: 'v1.0.0',
      lastModified: now.toISOString(),
      debate: {
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
