/**
 * Shapes the loader's rows and the stored decisions into what /cv/found
 * renders. Pure and serialisable (plain strings and numbers), because the
 * list is handed to a client component.
 */

import type { Decision, FoundRow } from '@/lib/discovery/match';

/** One row as the page renders it. */
export type RowView = {
  key: string;
  tournamentId: string;
  personId: string;
  tournamentName: string;
  year: number | null;
  publicUrl: string;
  listedName: string;
  /** "Speaker", "Judge", "Speaker and judge", or null when the tab says neither. */
  role: string | null;
  team: string | null;
  /** The "Why this match" line. */
  evidence: string;
  warnings: string[];
  decision: Decision | null;
};

/** A decision recorded earlier, read back from AppearanceCandidate. */
export type StoredDecision = {
  tournamentId: string;
  personId: string;
  tournamentName: string;
  year: number | null;
  publicUrl: string;
  listedName: string;
  status: Decision;
  evidence: string[];
};

/** A name whose exact matches passed the per-name cap. */
export type CappedAlias = { name: string; total: number; shown: number };

export type FoundState =
  /** No claimed name to search with. */
  | 'no_anchors'
  /** Names exist, but every one is in a script the stored keys cannot hold yet. */
  | 'unsearchable'
  /** Searched, and nothing matched. */
  | 'zero'
  /** Matches exist and every one has a decision. */
  | 'all_reviewed'
  | 'list';

export type FoundView = {
  state: FoundState;
  /** Undecided rows. */
  candidates: RowView[];
  confirmed: RowView[];
  hidden: RowView[];
  /** Names whose matches were cut at the per-name cap ("showing the first N"). */
  capped: CappedAlias[];
  /** Names past the alias limit, not searched this time. */
  overLimit: number;
};

export type FoundInput = {
  aliasCount: number;
  unsearchable: number;
  overLimit: number;
  capped: readonly CappedAlias[];
  rows: readonly FoundRow[];
  stored: readonly StoredDecision[];
};

export const EVIDENCE_SEPARATOR = ' · ';

/** "WUDC 2024": the tournament name, with the year unless the name has it. */
export function rowLabel(row: Pick<RowView, 'tournamentName' | 'year'>): string {
  return row.year != null && !row.tournamentName.includes(String(row.year))
    ? `${row.tournamentName} ${row.year}`
    : row.tournamentName;
}

function roleText(roles: readonly string[]): string | null {
  const speaker = roles.includes('speaker');
  const judge = roles.includes('judge');
  if (speaker && judge) return 'Speaker and judge';
  if (speaker) return 'Speaker';
  if (judge) return 'Judge';
  return null;
}

function fromRow(row: FoundRow): RowView {
  return {
    key: row.key,
    tournamentId: row.tournamentId,
    personId: row.personId,
    tournamentName: row.tournamentName,
    year: row.year,
    publicUrl: row.publicUrl,
    listedName: row.listedName,
    role: roleText(row.roles),
    team: row.teamName,
    evidence: row.evidence.join(EVIDENCE_SEPARATOR),
    warnings: row.warnings,
    decision: row.decision,
  };
}

/**
 * A decision whose appearance the loader no longer returns (the name was
 * unclaimed, or a later scrape renamed the row) still shows, from what was
 * stored when it was made, so a "Not me" can always be restored.
 */
function fromStored(d: StoredDecision): RowView {
  return {
    key: `${d.tournamentId}:${d.personId}`,
    tournamentId: d.tournamentId,
    personId: d.personId,
    tournamentName: d.tournamentName,
    year: d.year,
    publicUrl: d.publicUrl,
    listedName: d.listedName,
    role: null,
    team: null,
    evidence: d.evidence.join(EVIDENCE_SEPARATOR),
    warnings: [],
    decision: d.status,
  };
}

export function shapeFoundView(input: FoundInput): FoundView {
  const view: FoundView = {
    state: 'list',
    candidates: [],
    confirmed: [],
    hidden: [],
    capped: [...input.capped],
    overLimit: input.overLimit,
  };
  const seen = new Set<string>();
  for (const row of input.rows) {
    seen.add(row.key);
    const v = fromRow(row);
    if (row.decision === 'confirmed') view.confirmed.push(v);
    else if (row.decision === 'rejected') view.hidden.push(v);
    else view.candidates.push(v);
  }
  for (const d of input.stored) {
    const v = fromStored(d);
    if (seen.has(v.key)) continue;
    if (d.status === 'confirmed') view.confirmed.push(v);
    else view.hidden.push(v);
  }

  const decided = view.confirmed.length + view.hidden.length;
  if (input.aliasCount === 0 && decided === 0) {
    view.state = input.unsearchable > 0 ? 'unsearchable' : 'no_anchors';
  } else if (view.candidates.length === 0) {
    view.state = decided === 0 ? 'zero' : 'all_reviewed';
  }
  return view;
}
