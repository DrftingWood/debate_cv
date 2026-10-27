/**
 * Tiering for the Found tab: given every public-tab appearance whose name is
 * near one of the user's anchor names, decide which are Strong, Possible,
 * Ambiguous or Blocked, rank them, and write the "Why this match" line.
 *
 * Nothing here adds anything to a CV. Tiers decide only how a row is shown
 * and whether it may join a bulk "This is me" (Strong only).
 *
 *   Strong     same name (not merely close), at least one of the user's
 *              teammates in evidence, no warning of any kind.
 *   Possible   any other unblocked same or close name. Close names always
 *              need the user's own tick (owner's rule).
 *   Ambiguous  one-word names and double surnames: always the user's call.
 *   Blocked    clashes in the same round with a row the user already marked
 *              as theirs. Shown with the reason; cannot be marked as theirs.
 *
 * Pure: the loader gathers the facts, this file only judges them.
 */

import { bestMatch, type MatchProximity } from '@/lib/discovery/names';
import { presenceClash, selfClash, slotPhrase, slotVerb, type Slot } from '@/lib/discovery/rounds';

/** Bump when tiering changes, so stored decisions can be re-derived later. */
export const MATCHER_VERSION = 1;

/**
 * The owner's common-name threshold: a name seen at more than this many
 * tournaments in one calendar year is more than one person often enough that
 * it never reaches Strong, whatever else agrees.
 */
export const COMMON_NAME_PER_YEAR = 4;

export type Tier = 'strong' | 'possible' | 'ambiguous' | 'blocked';
export type Decision = 'confirmed' | 'rejected';

/** One of the user's teammates (from their own private URLs) seen at the candidate. */
export type TeammateHit = {
  name: string;
  /** Where the user and this teammate were on one team: "SIDO 2025". */
  where: string;
  /** On the candidate's own team, rather than merely at the tournament. */
  sameTeam: boolean;
};

/** Everything the matcher needs to know about one appearance. */
export type Appearance = {
  tournamentId: string;
  personId: string;
  tournamentName: string;
  year: number | null;
  region: string | null;
  publicUrl: string;
  /** The name exactly as the tab lists it (already masked if suppressed). */
  listedName: string;
  roles: string[];
  teamName: string | null;
  /** Who holds this name bucket today (Person.claimedByUserId). */
  claimedBy: 'me' | 'other' | null;
  slots: Slot[];
  eudc: boolean;
  teammates: TeammateHit[];
  /** Tournaments this name bucket is at in its busiest year. */
  busiestYear: { year: number; count: number } | null;
};

export type MatchContext = {
  anchors: readonly string[];
  /** Years of the user's own (private URL) tournaments. */
  userYears: readonly number[];
  /** Regions of the user's own tournaments. */
  userRegions: readonly string[];
  /** Decisions already recorded, keyed by `appearanceKey`. */
  decisions: ReadonlyMap<string, Decision>;
};

export type FoundRow = Appearance & {
  key: string;
  anchor: string;
  proximity: MatchProximity;
  tier: Tier;
  score: number;
  /** The "Why this match" line, as parts joined with " · ". */
  evidence: string[];
  /** Reasons this row needs the user's own look; any one keeps it out of Strong. */
  warnings: string[];
  blockReason: 'conflict_same_round' | null;
  /** Plain-words explanation of the block. */
  blockText: string | null;
  decision: Decision | null;
};

export function appearanceKey(tournamentId: string, personId: string): string {
  return `${tournamentId}:${personId}`;
}

const NAME_WEIGHT: Record<MatchProximity, number> = { match: 40, close: 15, ambiguous: 5 };

function nameEvidence(proximity: MatchProximity, anchor: string, listed: string): string {
  if (proximity === 'match')
    return listed === anchor ? 'Same name' : `Same name, listed as "${listed}"`;
  if (proximity === 'close') return `Close to your name "${anchor}": listed as "${listed}"`;
  return `Could be your name or another person's: listed as "${listed}"`;
}

function teammateEvidence(hit: TeammateHit): string {
  return hit.sameTeam
    ? `your teammate ${hit.name} (${hit.where}) is on this team`
    : `your teammate ${hit.name} (${hit.where}) was also at this tournament`;
}

function yearScore(year: number | null, userYears: readonly number[]): number {
  if (year == null || userYears.length === 0) return 0;
  const lo = Math.min(...userYears);
  const hi = Math.max(...userYears);
  if (year >= lo - 2 && year <= hi + 2) return 5;
  return year <= lo - 5 || year >= hi + 5 ? -15 : 0;
}

function isCommon(app: Appearance): boolean {
  return (app.busiestYear?.count ?? 0) > COMMON_NAME_PER_YEAR;
}

type Clashes = { block: { text: string } | null; warnings: string[] };

/**
 * Same-round clashes with the other rows at this tournament. Against a row
 * the user marked as theirs, a hard clash blocks; against an undecided row it
 * is a warning (at most one of the two can be the user).
 */
function siblingClashes(
  app: Appearance,
  siblings: readonly Appearance[],
  ctx: MatchContext,
): Clashes {
  const out: Clashes = { block: null, warnings: [] };
  for (const other of siblings) {
    const clash = presenceClash(app.slots, other.slots, app.eudc);
    if (!clash) continue;
    const otherDecision = ctx.decisions.get(appearanceKey(other.tournamentId, other.personId));
    if (otherDecision === 'rejected') continue;
    if (otherDecision === 'confirmed' && clash.level === 'block') {
      const yours =
        clash.a.round === clash.b.round
          ? `the same round you ${slotVerb(clash.b)}`
          : `while you ${slotPhrase(clash.b)}`;
      out.block = {
        text: `This name ${slotPhrase(clash.a)}, ${yours} (as "${other.listedName}"). It is someone else.`,
      };
    } else {
      out.warnings.push(
        clash.level === 'check'
          ? `"${other.listedName}" also judged that round; one judge can sit on a double panel, so check which is you`
          : `This name ${slotPhrase(clash.a)} while "${other.listedName}" ${slotPhrase(clash.b)}; at most one of the two can be you`,
      );
    }
  }
  return out;
}

/** Reasons in the appearance itself to want the user's own look. */
function ownWarnings(app: Appearance): string[] {
  const warnings: string[] = [];
  const self = selfClash(app.slots, app.eudc);
  if (self) {
    warnings.push(
      `Two people may share this name here: it ${slotPhrase(self.a)} and ${slotPhrase(self.b)}`,
    );
  }
  if (isCommon(app) && app.busiestYear) {
    warnings.push(
      `This name is at ${app.busiestYear.count} tournaments in ${app.busiestYear.year}, so it is probably more than one person`,
    );
  }
  if (app.claimedBy === 'other') warnings.push('Another user has this name on their record');
  return warnings;
}

/** The ranking score (spec section 3.4) and the "Why this match" parts. */
function scoreAndEvidence(
  app: Appearance,
  best: { proximity: MatchProximity; anchor: string },
  ctx: MatchContext,
): { score: number; evidence: string[] } {
  const sameTeam = app.teammates.filter((t) => t.sameTeam).slice(0, 2);
  const elsewhere = app.teammates.filter((t) => !t.sameTeam).slice(0, 3);
  let score = NAME_WEIGHT[best.proximity] + 30 * sameTeam.length + 10 * elsewhere.length;
  if (app.region && ctx.userRegions.includes(app.region)) score += 5;
  score += yearScore(app.year, ctx.userYears);
  if (isCommon(app)) score -= 20;

  const evidence = [nameEvidence(best.proximity, best.anchor, app.listedName)];
  if (app.claimedBy === 'me') evidence.push('this name is already on your record');
  for (const t of [...sameTeam, ...elsewhere]) evidence.push(teammateEvidence(t));
  const place = [app.region, app.year].filter((v) => v != null && v !== '').join(', ');
  if (place) evidence.push(place);
  return { score, evidence };
}

function judge(app: Appearance, all: readonly Appearance[], ctx: MatchContext): FoundRow | null {
  const best = bestMatch(ctx.anchors, app.listedName);
  if (!best) return null;
  const key = appearanceKey(app.tournamentId, app.personId);
  const siblings = all.filter(
    (o) => o.tournamentId === app.tournamentId && o.personId !== app.personId,
  );
  const clashes = siblingClashes(app, siblings, ctx);
  const warnings = [...clashes.warnings, ...ownWarnings(app)];
  const { score, evidence } = scoreAndEvidence(app, best, ctx);

  let tier: Tier = 'possible';
  if (clashes.block) tier = 'blocked';
  else if (best.proximity === 'ambiguous') tier = 'ambiguous';
  else if (best.proximity === 'match' && app.teammates.length > 0 && warnings.length === 0) {
    tier = 'strong';
  }

  return {
    ...app,
    key,
    anchor: best.anchor,
    proximity: best.proximity,
    tier,
    score,
    evidence,
    warnings,
    blockReason: clashes.block ? 'conflict_same_round' : null,
    blockText: clashes.block?.text ?? null,
    decision: ctx.decisions.get(key) ?? null,
  };
}

const TIER_ORDER: Record<Tier, number> = { strong: 0, possible: 1, ambiguous: 2, blocked: 3 };

/** Judge every appearance and sort: tier, then score, then newest first. */
export function rankAppearances(apps: readonly Appearance[], ctx: MatchContext): FoundRow[] {
  const rows: FoundRow[] = [];
  for (const app of apps) {
    const row = judge(app, apps, ctx);
    if (row) rows.push(row);
  }
  return rows.sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      b.score - a.score ||
      (b.year ?? 0) - (a.year ?? 0) ||
      a.tournamentName.localeCompare(b.tournamentName),
  );
}
