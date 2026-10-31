import type { PieceRef } from '@/lib/calicotab/scrapePieces';

/**
 * A recorded scrape piece as the checks see it. `url` is the stored page URL,
 * which may be a private URL; the checks pass it through publicPieceUrl before
 * it reaches a CheckResult.
 */
export type AuditPiece = PieceRef & {
  label: string;
  status: 'ok' | 'failed' | 'withheld';
  /**
   * Why a withheld piece is withheld: 'not_published' when the tournament
   * never put it up (no menu link, or a round page with no rows); the checks
   * treat it like any withheld page and only the wording differs.
   */
  reason?: string | null;
  url: string | null;
};

/**
 * Everything the data-accuracy checks read about one tournament, as plain
 * data with no Prisma types, so the engine stays pure and every check can be
 * tested from a literal. The audit loader fills it from
 * the database.
 */
export type AuditInputs = {
  format: string | null;
  prelimRoundCount: number | null;
  parserVersion: string | null;
  /** The parser version under which every recorded page was last refreshed (Tournament.pagesRefreshedUnder). */
  pagesRefreshedUnder: string | null;
  /** TeamResult standings rows (roundNumber 0). */
  teamTab: Array<{ team: string; points: number | null; wins: number | null }>;
  /** TeamResult prelim rows (roundNumber ≥ 1). */
  roundRows: Array<{
    team: string;
    round: number;
    points: number | null;
    wins: number | null;
    position: string | null;
  }>;
  /** Team EliminationResult rows with a won/lost outcome. */
  outrounds: Array<{ stage: string; team: string; result: 'won' | 'lost' }>;
  /** Team break rows (EliminationResult with no outcome); stage is the category, e.g. "Open". */
  breakRows: Array<{ stage: string; team: string }>;
  /** Speakers on record per team-tab team name. */
  speakersByTeam: Record<string, number>;
  /**
   * Speakers per team-tab team name that the speaker tab shows as redacted
   * (stored as no person). Null, or no entry, when never counted: every
   * tournament scraped before the count was recorded.
   */
  redactedByTeam: Record<string, number | null>;
  speakerParticipants: number;
  speakersWithScores: number;
  judgeParticipants: number;
  /**
   * People named as adjudication core: judges with the participants list's
   * Adj Core tick, plus the names under the home page's Tournament Staff
   * block. Zero means neither source names anyone.
   */
  coreNamed: number;
  /** Distinct persons with round_results judge rows. */
  roundResultJudges: number;
  judgesByRound: Record<number, { chairs: number; judges: number }>;
  motionRounds: number[];
  pieces: AuditPiece[];
  openReports: Array<{ categories: string[] }>;
};
