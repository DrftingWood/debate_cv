/**
 * The judging side of the record: how often you chaired, how deep into the
 * outrounds you judged, what you were appointed as, and when judging overtook
 * speaking.
 *
 * Judging has no partner and no seat, so none of this responds to the stats
 * page's filters — it reads the judge rows as they are. Every figure carries
 * the tournaments it rests on, and anything the stored rows cannot back is
 * counted and left out rather than filled in: a tournament with no judged-
 * round count gives no chair rate, and an outround whose stage the lexicon
 * cannot read is reported as unrecognised instead of guessed at.
 *
 * SeasonTrends already shows chaired rounds, events and outround tournaments
 * per season; this module adds the ratios and distributions it does not.
 */

import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import { outroundRank } from '@/lib/calicotab/judgeStats';
import { splitStageLabel, type OutroundStage } from '@/lib/calicotab/stageLexicon';
import { bracketOf } from '@/lib/cv/outroundFunnel';

export type JudgeLensRow = Pick<
  CvJudgeRow,
  'year' | 'judgeTypeTag' | 'inroundsJudged' | 'inroundsChaired' | 'lastOutroundChaired' | 'lastOutroundJudged' | 'broke'
>;

export type ChairFigures = {
  /** Tournaments whose prelim rounds judged are on record and consistent. */
  measured: number;
  roundsJudged: number;
  roundsChaired: number;
  /** roundsChaired / roundsJudged, 0..1; null when nothing was measured. */
  chairRate: number | null;
};

export type ChairSeason = ChairFigures & { year: number; tournaments: number };

export type DepthKey = OutroundStage | 'unrecognised' | 'broke_unstaged' | 'none';

export type DepthBucket = {
  key: DepthKey;
  label: string;
  tournaments: number;
  /** Of those, how many ran in a secondary bracket (Novice, ESL, Junior …). */
  secondaryBracket: number;
};

export type AppointmentKey = 'core' | 'invited' | 'subsidized' | 'normal' | 'unstated';

export type AppointmentRow = {
  key: AppointmentKey;
  label: string;
  tournaments: number;
  broke: number;
};

export type JudgingLens = {
  tournaments: number;
  chair: {
    seasons: ChairSeason[];
    /** Every judged tournament, dated or not. */
    overall: ChairFigures;
    /** Tournaments left out of the seasons because they carry no year. */
    undated: number;
    /** Tournaments with no judged-round count, so no denominator. */
    unmeasured: number;
    /** More prelims chaired than judged — the two stored counts disagree. */
    inconsistent: number;
    /** Chair counts that exist without a judged-round count to divide by. */
    chairedWithoutCount: { tournaments: number; rounds: number };
  };
  depth: {
    buckets: DepthBucket[];
    /** Tournaments with an outround stage stored (recognised or not). */
    withOutround: number;
    secondaryBracket: number;
    /** Tournaments with a chaired outround on record. */
    chairedOutround: number;
  };
  appointments: AppointmentRow[];
  /**
   * `broke` is the open bracket (or a break with no round stored);
   * `otherBracket` counts tournaments whose deepest round judged was a
   * secondary or consolation bracket instead.
   */
  breaks: { tournaments: number; broke: number; rate: number | null; otherBracket: number };
};

const STAGE_LABEL: Record<OutroundStage, string> = {
  grand_final: 'Grand final',
  final: 'Final',
  semifinal: 'Semifinal',
  partial_semifinal: 'Partial semifinal',
  quarterfinal: 'Quarterfinal',
  partial_quarterfinal: 'Partial quarterfinal',
  octofinal: 'Octofinal',
  partial_octofinal: 'Partial octofinal',
  double_octofinal: 'Double octofinal',
  partial_double_octofinal: 'Partial double octofinal',
  triple_octofinal: 'Triple octofinal',
  partial_triple_octofinal: 'Partial triple octofinal',
};

const TAIL_LABEL = {
  unrecognised: 'Outround, stage unrecognised',
  broke_unstaged: 'Broke, stage not recorded',
  none: 'No outround',
} as const;

/*
 * The parser's vocabulary (lib/calicotab/parseTabs.ts, ParticipantsRow.judgeTag).
 * 'Adjudicator' is what the judge-aggregate writer stores when it creates a
 * participant from round pages alone — it says the person judged, not what
 * they were appointed as, so it joins null under "not stated".
 */
const APPOINTMENT_LABEL: Record<AppointmentKey, string> = {
  core: 'Adjudication core (CA, DCA, tab)',
  invited: 'Invited / independent',
  subsidized: 'Subsidised',
  normal: 'Institutional',
  unstated: 'Not stated',
};

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

function chairFigures(rows: JudgeLensRow[]): ChairFigures {
  let measured = 0;
  let roundsJudged = 0;
  let roundsChaired = 0;
  for (const r of rows) {
    if (!isMeasurable(r)) continue;
    measured += 1;
    roundsJudged += r.inroundsJudged!;
    roundsChaired += r.inroundsChaired ?? 0;
  }
  return { measured, roundsJudged, roundsChaired, chairRate: ratio(roundsChaired, roundsJudged) };
}

/*
 * A null chair count beside a judged-round count is read as zero chairs:
 * ingest stores a zero as null (`chairedPrelims || null` in
 * lib/calicotab/judgeAggregates.ts), and the judged-round count proves the
 * rounds themselves were captured. Chaired above judged means the landing
 * page and the round pages disagree, and neither is obviously right.
 */
function isMeasurable(r: JudgeLensRow): boolean {
  if (r.inroundsJudged == null || r.inroundsJudged <= 0) return false;
  return (r.inroundsChaired ?? 0) <= r.inroundsJudged;
}

function isSecondaryBracket(category: string | null): boolean {
  return category != null && !/^open$/i.test(category);
}

/*
 * "Broke as a judge" means the tournament's break. Judging a Novice grand
 * final or a Silver final is an outround, but at most tournaments those
 * panels are drawn from adjudicators who did NOT break to the open rounds,
 * so counting them would call a secondary-bracket allocation a break. The
 * bracket is read from the deepest round judged, the only round stored; a
 * judge who took an open quarter AND a novice final is filed under the
 * novice final, which undercounts rather than inflates. A break with no
 * round stored came from the adjudicator break page, which is the
 * tournament's list rather than a bracket's, so it stays a break.
 */
function brokeOpen(r: JudgeLensRow): boolean {
  return r.broke && bracketOf(r.lastOutroundJudged) === 'open';
}

export function judgingLens(rows: JudgeLensRow[]): JudgingLens {
  // ── Chair rate ──────────────────────────────────────────────────────
  const byYear = new Map<number, JudgeLensRow[]>();
  for (const r of rows) {
    if (r.year == null) continue;
    const list = byYear.get(r.year) ?? [];
    list.push(r);
    byYear.set(r.year, list);
  }
  const seasons: ChairSeason[] = [...byYear]
    .map(([year, list]) => ({ year, tournaments: list.length, ...chairFigures(list) }))
    .sort((a, b) => a.year - b.year);

  const noCount = rows.filter((r) => r.inroundsJudged == null || r.inroundsJudged <= 0);
  const withChairsOnly = noCount.filter((r) => (r.inroundsChaired ?? 0) > 0);

  // ── Outround depth ──────────────────────────────────────────────────
  // Ranked through outroundRank, never by substring: "Octofinals" and
  // "Quarterfinal" both contain "final". The deepest round is taken across
  // brackets as stored, so a novice grand final outranks an open quarter —
  // which is why the secondary-bracket count sits beside every bucket.
  const buckets = new Map<DepthKey, DepthBucket & { rank: number }>();
  const bump = (key: DepthKey, rank: number, secondary: boolean) => {
    const b =
      buckets.get(key) ??
      {
        key,
        label: key in STAGE_LABEL ? STAGE_LABEL[key as OutroundStage] : TAIL_LABEL[key as keyof typeof TAIL_LABEL],
        tournaments: 0,
        secondaryBracket: 0,
        rank,
      };
    b.tournaments += 1;
    if (secondary) b.secondaryBracket += 1;
    buckets.set(key, b);
  };
  for (const r of rows) {
    if (r.lastOutroundJudged) {
      const { stage, category } = splitStageLabel(r.lastOutroundJudged);
      if (stage) {
        bump(
          stage,
          outroundRank({ roundLabel: r.lastOutroundJudged, roundNumber: null, isOutround: true }),
          isSecondaryBracket(category),
        );
      } else {
        bump('unrecognised', -1, false);
      }
    } else {
      bump(r.broke ? 'broke_unstaged' : 'none', r.broke ? -2 : -3, false);
    }
  }
  const depthBuckets = [...buckets.values()]
    .sort((a, b) => b.rank - a.rank)
    .map(({ rank: _rank, ...b }) => b);

  // ── Appointments ────────────────────────────────────────────────────
  const appointments = new Map<AppointmentKey, AppointmentRow>();
  for (const r of rows) {
    const tag = r.judgeTypeTag?.toLowerCase();
    const key: AppointmentKey =
      tag === 'core' || tag === 'invited' || tag === 'subsidized' || tag === 'normal' ? tag : 'unstated';
    const a = appointments.get(key) ?? { key, label: APPOINTMENT_LABEL[key], tournaments: 0, broke: 0 };
    a.tournaments += 1;
    if (brokeOpen(r)) a.broke += 1;
    appointments.set(key, a);
  }
  const appointmentRows = [...appointments.values()].sort(
    (a, b) =>
      Number(a.key === 'unstated') - Number(b.key === 'unstated') ||
      b.tournaments - a.tournaments ||
      a.label.localeCompare(b.label),
  );

  const broke = rows.filter(brokeOpen).length;

  return {
    tournaments: rows.length,
    chair: {
      seasons,
      overall: chairFigures(rows),
      undated: rows.filter((r) => r.year == null).length,
      unmeasured: noCount.length,
      inconsistent: rows.filter(
        (r) => r.inroundsJudged != null && r.inroundsJudged > 0 && (r.inroundsChaired ?? 0) > r.inroundsJudged,
      ).length,
      chairedWithoutCount: {
        tournaments: withChairsOnly.length,
        rounds: withChairsOnly.reduce((s, r) => s + (r.inroundsChaired ?? 0), 0),
      },
    },
    depth: {
      buckets: depthBuckets,
      withOutround: rows.filter((r) => !!r.lastOutroundJudged).length,
      secondaryBracket: depthBuckets.reduce((s, b) => s + b.secondaryBracket, 0),
      chairedOutround: rows.filter((r) => !!r.lastOutroundChaired).length,
    },
    appointments: appointmentRows,
    breaks: {
      tournaments: rows.length,
      broke,
      rate: ratio(broke, rows.length),
      otherBracket: rows.filter((r) => r.broke && !brokeOpen(r)).length,
    },
  };
}

// ── Speaking vs judging ─────────────────────────────────────────────────

/**
 * A season leans one way only when the side ahead has at least this many
 * tournaments. One spoken against two judged is not a career turning; it is
 * a quiet year, and a headline built on it ("judging overtook speaking in
 * 2025") reads a coin flip as a shift. Three is a floor chosen by judgement,
 * not derived: it keeps a season of one or two events on the leading side
 * from being called, and the undated check below catches the rest.
 */
export const MIN_LEADING_SIDE = 3;

export type BalanceSeason = {
  year: number;
  spoken: number;
  judged: number;
  lean: 'spoken' | 'judged' | 'even';
  /** Fewer than MIN_LEADING_SIDE on the leading side: shown, but neither makes nor breaks a run. */
  thin: boolean;
};

export type SpeakingVsJudging = {
  /** Seasons with at least one dated tournament on either side, oldest first. */
  seasons: BalanceSeason[];
  undatedSpoken: number;
  undatedJudged: number;
  /**
   * The first season of the unbroken run of counted (non-thin) seasons,
   * reaching the latest counted season, in which you judged at more
   * tournaments than you spoke at. Null when the latest counted season was
   * not one, when every counted season was (nothing turned), or when
   * `undecided`.
   */
  turnedIn: number | null;
  /** Length of that run in counted seasons; 0 when there is no turn. */
  turnedSeasons: number;
  /** Counted seasons in which you judged more, oldest first. */
  judgedMoreYears: number[];
  judgedMoreSeasons: number;
  alwaysJudgedMore: boolean;
  /**
   * Undated tournaments are enough to change a season the headline rests on
   * (see `unsettledYears`), so no turn — or lack of one — is called.
   */
  undecided: boolean;
  /** Seasons whose lean or thinness undated tournaments could change, among those the headline reads. */
  unsettledYears: number[];
};

type Classification = { lean: BalanceSeason['lean']; thin: boolean };

function classify(spoken: number, judged: number): Classification {
  return {
    lean: judged > spoken ? 'judged' : spoken > judged ? 'spoken' : 'even',
    thin: Math.max(spoken, judged) < MIN_LEADING_SIDE,
  };
}

/*
 * Could undated tournaments, placed in this season, change how it reads?
 * Each undated tournament could belong to any season, so the question is
 * whether any split of them — none to all of each side — moves the season
 * across a line. Lean and thinness only move one way as either count grows,
 * so if the four corners of that range agree, every point inside does too.
 */
function settled(s: BalanceSeason, undatedSpoken: number, undatedJudged: number): boolean {
  const corners = [
    classify(s.spoken + undatedSpoken, s.judged),
    classify(s.spoken, s.judged + undatedJudged),
    classify(s.spoken + undatedSpoken, s.judged + undatedJudged),
  ];
  return corners.every((c) => c.lean === s.lean && c.thin === s.thin);
}

/*
 * Seasons are the years that appear on the record, not the calendar: a year
 * with no tournaments on either side neither breaks nor extends a run,
 * because an absent year says nothing about which you did more of — and a
 * thin year is treated the same way, for the reason MIN_LEADING_SIDE gives.
 * A tournament you both spoke and judged at counts on both sides.
 *
 * Undated tournaments are placed nowhere, but they are not nothing: seven
 * undated spoken tournaments could turn any recent judged-more season back.
 * So the headline is withheld when they could change a season it rests on —
 * for a turn, the run and the season before it (which fixes the turn's
 * year); otherwise, the latest counted season and anything thin after it.
 */
export function speakingVsJudging(
  speakerRows: Pick<CvSpeakerRow, 'year'>[],
  judgeRows: Pick<CvJudgeRow, 'year'>[],
): SpeakingVsJudging {
  const counts = new Map<number, { spoken: number; judged: number }>();
  const at = (year: number) => {
    const c = counts.get(year) ?? { spoken: 0, judged: 0 };
    counts.set(year, c);
    return c;
  };
  for (const r of speakerRows) if (r.year != null) at(r.year).spoken += 1;
  for (const r of judgeRows) if (r.year != null) at(r.year).judged += 1;
  const undatedSpoken = speakerRows.filter((r) => r.year == null).length;
  const undatedJudged = judgeRows.filter((r) => r.year == null).length;

  const seasons: BalanceSeason[] = [...counts]
    .map(([year, c]) => ({ year, ...c, ...classify(c.spoken, c.judged) }))
    .sort((a, b) => a.year - b.year);
  const counted = seasons.filter((s) => !s.thin);

  let runStart = counted.length;
  while (runStart > 0 && counted[runStart - 1]!.lean === 'judged') runStart -= 1;
  const runLength = counted.length - runStart;
  const always = counted.length > 0 && runStart === 0;
  const turned = runLength > 0 && !always;

  const readFrom =
    turned ? counted[runStart - 1]!.year : !always && counted.length > 0 ? counted[counted.length - 1]!.year : -Infinity;
  const unsettledYears = seasons
    .filter((s) => s.year >= readFrom && !settled(s, undatedSpoken, undatedJudged))
    .map((s) => s.year);
  const undecided = unsettledYears.length > 0;
  const judgedMoreYears = counted.filter((s) => s.lean === 'judged').map((s) => s.year);

  return {
    seasons,
    undatedSpoken,
    undatedJudged,
    turnedIn: turned && !undecided ? counted[runStart]!.year : null,
    turnedSeasons: turned && !undecided ? runLength : 0,
    judgedMoreYears,
    judgedMoreSeasons: judgedMoreYears.length,
    alwaysJudgedMore: always && !undecided,
    undecided,
    unsettledYears,
  };
}
