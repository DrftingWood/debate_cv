/**
 * The Found tab's rows: every public-tab appearance whose stored name key
 * EQUALS one of the user's names, with the "Why this match" line and any
 * warnings, in a stable order.
 *
 * Exact matching (owner's decision, 2026-10-27): the whole name equals one of
 * the user's claimed names, or (two or more words only) holds its words in
 * order with other words around them. There are no tiers and no closeness:
 * every row is a candidate the user answers per row ("This is me" / "Not
 * me"). What is left of the safety rules is shown, never decided:
 *
 *  - Same-round clashes (lib/discovery/rounds.ts): the name spoke and judged
 *    in one round, or sits in two concurrent brackets, or clashes with
 *    another row at the same tournament. Each is a visible "Check" line.
 *  - Another user's name is not offered at all (the query excludes it).
 *
 * Nothing here adds anything to a CV. Pure: the loader gathers the facts.
 */

import { presenceClash, selfClash, slotPhrase, type Slot } from '@/lib/discovery/rounds';

/** Bump when what a row carries changes, so stored decisions can be re-derived. */
export const MATCHER_VERSION = 2;

export type Decision = 'confirmed' | 'rejected';

/** One of the user's teammates (from their own private URLs) seen at the candidate. */
export type TeammateHit = {
  name: string;
  /** Where the user and this teammate were on one team: "SIDO 2025". */
  where: string;
  /** On the candidate's own team, rather than merely at the tournament. */
  sameTeam: boolean;
};

/** Everything the page needs to know about one appearance. */
export type Appearance = {
  tournamentId: string;
  personId: string;
  tournamentName: string;
  year: number | null;
  region: string | null;
  publicUrl: string;
  /** The name exactly as the tab lists it. */
  listedName: string;
  /** The user's own name this row matched. */
  alias: string;
  /** `exact`: the whole name equals it; `contains`: its words in order, others around. */
  matchKind: 'exact' | 'contains';
  roles: string[];
  teamName: string | null;
  /** The name is already on the user's record (Person.claimedByUserId). */
  mine: boolean;
  slots: Slot[];
  eudc: boolean;
  teammates: TeammateHit[];
};

export type FoundRow = Appearance & {
  key: string;
  /** The "Why this match" line, as parts joined with " · ". */
  evidence: string[];
  /** Reasons to look twice; shown as "Check" lines. */
  warnings: string[];
  decision: Decision | null;
};

export function appearanceKey(tournamentId: string, personId: string): string {
  return `${tournamentId}:${personId}`;
}

function teammateEvidence(hit: TeammateHit): string {
  return hit.sameTeam
    ? `your teammate ${hit.name} (${hit.where}) is on this team`
    : `your teammate ${hit.name} (${hit.where}) was also at this tournament`;
}

function evidenceFor(app: Appearance): string[] {
  const evidence = [
    app.matchKind === 'contains'
      ? `Contains your name "${app.alias}": listed as "${app.listedName}"`
      : app.listedName === app.alias
        ? 'Exact match'
        : `Exact match, listed as "${app.listedName}"`,
  ];
  if (app.mine) evidence.push('this name is already on your record');
  const sameTeam = app.teammates.filter((t) => t.sameTeam).slice(0, 2);
  const elsewhere = app.teammates.filter((t) => !t.sameTeam).slice(0, 3);
  for (const t of [...sameTeam, ...elsewhere]) evidence.push(teammateEvidence(t));
  const place = [app.region, app.year].filter((v) => v != null && v !== '').join(', ');
  if (place) evidence.push(place);
  return evidence;
}

/** Same-round clashes inside the row, and with other rows at the tournament. */
function warningsFor(app: Appearance, siblings: readonly Appearance[]): string[] {
  const warnings: string[] = [];
  const self = selfClash(app.slots, app.eudc);
  if (self) {
    warnings.push(
      `Two people may share this name here: it ${slotPhrase(self.a)} and ${slotPhrase(self.b)}`,
    );
  }
  for (const other of siblings) {
    const clash = presenceClash(app.slots, other.slots, app.eudc);
    if (!clash) continue;
    warnings.push(
      clash.level === 'check'
        ? `"${other.listedName}" also judged that round; one judge can sit on a double panel, so check which is you`
        : `This name ${slotPhrase(clash.a)} while "${other.listedName}" ${slotPhrase(clash.b)}; at most one of the two can be you`,
    );
  }
  return warnings;
}

/** Build every row and sort: teammate evidence first, then newest first. */
export function buildRows(
  apps: readonly Appearance[],
  decisions: ReadonlyMap<string, Decision>,
): FoundRow[] {
  const byTournament = new Map<string, Appearance[]>();
  for (const app of apps) {
    const list = byTournament.get(app.tournamentId) ?? [];
    list.push(app);
    byTournament.set(app.tournamentId, list);
  }
  const rows = apps.map((app): FoundRow => {
    const key = appearanceKey(app.tournamentId, app.personId);
    const siblings = (byTournament.get(app.tournamentId) ?? []).filter(
      (o) => o.personId !== app.personId,
    );
    return {
      ...app,
      key,
      evidence: evidenceFor(app),
      warnings: warningsFor(app, siblings),
      decision: decisions.get(key) ?? null,
    };
  });
  const sameTeam = (r: FoundRow) => r.teammates.filter((t) => t.sameTeam).length;
  return rows.sort(
    (a, b) =>
      sameTeam(b) - sameTeam(a) ||
      b.teammates.length - a.teammates.length ||
      (b.year ?? 0) - (a.year ?? 0) ||
      a.tournamentName.localeCompare(b.tournamentName),
  );
}
