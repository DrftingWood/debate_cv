/**
 * The outround funnel: of the tournaments the page shows, how many broke,
 * and how far each break went in the open bracket — quarterfinal,
 * semifinal, final, title.
 *
 * Tournament-level, so it reads the TournamentFact table the partner filter
 * has already narrowed. A seat filter slices tournaments into rounds, and
 * nobody breaks "in OG", so the page withholds this section under one; this
 * module never sees seats.
 *
 * Rungs are CUMULATIVE — "went at least this deep". The tab records only the
 * deepest stage a team reached, not where its bracket started, so a
 * tournament that broke straight to semifinals and one that won a
 * quarterfinal and lost the semi look identical. Counting "reached exactly
 * the quarterfinal" would need the break size, which TournamentFact doesn't
 * carry; counting "at least as deep as a quarterfinal" is knowable, keeps
 * the funnel monotone, and is what the caption says. The cost is that a
 * small break's skipped quarterfinal is counted on that rung.
 *
 * That same blindness decides which step conversions mean anything. A rate
 * from one rung to the next is only a record of winning when every team on
 * the upper rung had to play for the lower one. Every tournament had a break
 * to make, and every finalist played the final, so "broke of spoken" and
 * "won of finals" stand. Quarterfinal-of-broke, semifinal-of-quarterfinal and
 * final-of-semifinal do not: bracket size and byes put teams on those rungs
 * without a round played ("18 of 19 reached the semis" when most breaks
 * started there). What IS knowable at every rung is where a run ended — the
 * deepest stage is that rung — so each rung carries a "went out here" count.
 *
 * Depth is ranked with outroundRankStrict (the label-only form of
 * outroundRank), never substring matching: "Octofinals" contains "final" and
 * reached no quarterfinal. A partial round is its rung run with byes (see
 * "One nomenclature" in stageLexicon.ts): "Pre-Semifinals" is the Partial
 * Quarterfinal, the quarterfinal round that feeds the semis, so a team out
 * there played the quarterfinal and counts on that rung — as does the top
 * seed that took the bye. A rung therefore counts from the rank of its
 * Partial form, which sits just below the full rung and above the rung
 * beneath.
 *
 * Brackets are split with splitStageLabel. The main rungs are the open
 * bracket only: an "ESL Final" is a final, but not the tournament's final,
 * and a CV that reads "10 finals, 3 titles" when four of those finals and
 * one title were ESL overstates the record. Category brackets (ESL, Novice,
 * Junior, Gold, Silver, Bronze …) are counted beside the funnel. Consolation
 * brackets (Plate, Consolation, Lower) are where teams that did NOT make the
 * break play on, so they are never a break, a final or a title here; they
 * are counted so the section can say they were left out. The tab keeps one
 * deepest round per tournament, so a team that broke in both open and ESL
 * is counted in whichever bracket that round belongs to.
 */

import { outroundRankStrict } from '@/lib/calicotab/judgeStats';
import { splitStageLabel } from '@/lib/calicotab/stageLexicon';
import type { TournamentFact } from '@/lib/cv/statsFacts';

export type Bracket = 'open' | 'category' | 'consolation';

/*
 * Named for what they are rather than enumerated from a corpus: these are the
 * words tournaments use for the bracket of teams that missed the main break.
 * A category the list doesn't know ("Gold", "Pro-Am") stays a category — the
 * safe side, because it is kept out of the open rungs either way.
 */
// Gold, Silver and Bronze are NOT here: in one-day competitions they are the
// open field split into tiers (1-4 gold, 5-8 silver …) and each tier's final is
// a real final (owner decision, assumptions C9). They stay 'category' — broke,
// final-level, labelled by tier — and tierRank() orders them gold > silver >
// bronze.
const CONSOLATION = /\b(?:plate|consolation|lower)\b/i;

/**
 * Which bracket an outround label belongs to. A label with no category is
 * the open bracket — Tabbycat labels the open bracket's rounds bare — and so
 * is one whose category is literally "Open". A missing label has no category
 * either; callers that need to know the depth handle that separately.
 */
export function bracketOf(label: string | null | undefined): Bracket {
  const { category } = splitStageLabel(label);
  if (category == null || /^open$/i.test(category)) return 'open';
  return CONSOLATION.test(category) ? 'consolation' : 'category';
}

/**
 * Gold, Silver and Bronze: the open field split into tiers. Reaching any of
 * their finals counts as reaching a final (owner decision); titles stay
 * category titles. Plate/Consolation never match (they are 'consolation').
 */
export function isTierBracket(label: string | null | undefined): boolean {
  const { category } = splitStageLabel(label);
  return category != null && /^(?:gold|silver|bronze)$/i.test(category.trim());
}

export type FunnelRungKey = 'spoken' | 'broke' | 'quarterfinal' | 'semifinal' | 'final' | 'won';

export type FunnelRung = {
  key: FunnelRungKey;
  label: string;
  count: number;
  /**
   * The previous rung's tournaments the conversion is read over — set only
   * on 'broke' and 'won', where every tournament above had to play for this
   * rung. Not always the previous count: finals with no recorded result
   * leave the final → title step.
   */
  from: number | null;
  /** How many of `from` reached this rung. */
  of: number | null;
  /**
   * Tournaments whose run ended at this rung: on 'spoken', did not break; on
   * 'broke', out before the quarterfinal round; on 'final', lost it. Null on
   * 'won', which is not a place to go out.
   */
  wentOut: number | null;
};

export type OutroundFunnel = {
  rungs: FunnelRung[];
  /** Broke, but the deepest stage is missing or unreadable (and no title proves it). */
  unknownDepth: number;
  /** Reached an open final whose result the tab didn't record. */
  finalsUndecided: number;
  /** Breaks whose deepest round was in a category bracket, and how far they went. */
  category: { breaks: number; finals: number; titles: number; brackets: string[] };
  /** Tournaments whose deepest round was a consolation bracket — not counted as breaks. */
  consolation: { tournaments: number; brackets: string[] };
};

const rank = (label: string) => outroundRankStrict(label) as number;
const QUARTERFINAL = rank('Partial Quarterfinals');
const SEMIFINAL = rank('Partial Semifinals');
const FINAL = rank('Final');

const sorted = (names: Set<string>) => [...names].sort((a, b) => a.localeCompare(b));

export function outroundFunnel(tournaments: TournamentFact[]): OutroundFunnel | null {
  if (tournaments.length === 0) return null;

  let broke = 0;
  let unknownDepth = 0;
  let outBeforeQf = 0;
  let qf = 0;
  let outAtQf = 0;
  let sf = 0;
  let outAtSf = 0;
  let finals = 0;
  let finalsLost = 0;
  let finalsDecided = 0;
  let won = 0;
  let tierFinals = 0;
  const category = { breaks: 0, finals: 0, titles: 0 };
  const categoryNames = new Set<string>();
  let consolation = 0;
  const consolationNames = new Set<string>();

  for (const t of tournaments) {
    const title = t.won === true;
    // A title is the stronger evidence: buildCvData only sets `won` when the
    // team won the final, so a champion whose stage label is missing or
    // stale ("Semifinals" from an older ingest) still reached the final —
    // and broke, whatever `broke` says.
    if (!t.broke && !title) continue;

    const bracket = bracketOf(t.deepestOutround);
    const labelled = t.deepestOutround ? outroundRankStrict(t.deepestOutround) : null;
    const depth = title ? Math.max(labelled ?? 0, FINAL) : labelled;

    if (bracket === 'consolation') {
      consolation += 1;
      consolationNames.add(splitStageLabel(t.deepestOutround).category!);
      continue;
    }
    broke += 1;
    if (bracket === 'category') {
      category.breaks += 1;
      categoryNames.add(splitStageLabel(t.deepestOutround).category!);
      if (depth != null && depth >= FINAL) category.finals += 1;
      if (title) category.titles += 1;
      // A tier final is a final-level appearance on the funnel rungs too, so
      // the funnel stays monotone; its result is not the open final's, so it
      // stays out of the decided / won / lost conversions.
      if (isTierBracket(t.deepestOutround) && depth != null && depth >= FINAL) {
        qf += 1;
        sf += 1;
        finals += 1;
        tierFinals += 1;
      }
      continue;
    }

    if (depth == null) {
      unknownDepth += 1;
      continue;
    }
    if (depth < QUARTERFINAL) outBeforeQf += 1;
    if (depth >= QUARTERFINAL) qf += 1;
    if (depth >= QUARTERFINAL && depth < SEMIFINAL) outAtQf += 1;
    if (depth >= SEMIFINAL) sf += 1;
    if (depth >= SEMIFINAL && depth < FINAL) outAtSf += 1;
    if (depth >= FINAL) {
      finals += 1;
      if (t.won != null) finalsDecided += 1;
      if (t.won === false) finalsLost += 1;
      if (title) won += 1;
    }
  }

  const rungs: FunnelRung[] = [
    {
      key: 'spoken',
      label: 'Tournaments',
      count: tournaments.length,
      from: null,
      of: null,
      wentOut: tournaments.length - broke,
    },
    {
      key: 'broke',
      label: 'Broke',
      count: broke,
      from: tournaments.length,
      of: broke,
      wentOut: outBeforeQf,
    },
    {
      key: 'quarterfinal',
      label: 'Quarterfinal',
      count: qf,
      from: null,
      of: null,
      wentOut: outAtQf,
    },
    { key: 'semifinal', label: 'Semifinal', count: sf, from: null, of: null, wentOut: outAtSf },
    { key: 'final', label: 'Final', count: finals, from: null, of: null, wentOut: finalsLost },
    { key: 'won', label: 'Won', count: won, from: finalsDecided, of: won, wentOut: null },
  ];

  return {
    rungs,
    unknownDepth,
    finalsUndecided: finals - tierFinals - finalsDecided,
    category: { ...category, brackets: sorted(categoryNames) },
    consolation: { tournaments: consolation, brackets: sorted(consolationNames) },
  };
}
