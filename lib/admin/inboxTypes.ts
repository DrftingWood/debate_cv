import type { MarkKind } from '@/lib/admin/adminChecks';
import type { SuggestedPiece } from '@/lib/admin/accuracyActions';
import type { FlagItem, Priority } from '@/lib/admin/reviewSetTypes';
import type { TabState } from '@/lib/admin/tabStatus';

/**
 * The Inbox's shapes and constants (lib/admin/inbox.ts), apart from its
 * database code so the client table can import them without pulling Prisma
 * into the browser bundle, as cvReportTypes.ts does for the reports ledger.
 */

export type InboxKind = MarkKind;

export const INBOX_KINDS = [
  'check',
  'report',
  'import',
  'parser',
] as const satisfies readonly InboxKind[];

/** The one status cell's value (✓ Loaded / ? Partly / ? Check / ✗ Not loaded / —). */
export type TabStatusValue = TabState['state'];

export const INBOX_PER_PAGE = 20;
/** Candidates read per kind before ordering and paging, said in the module comment. */
export const CANDIDATE_CAP = 1000;

export type FixAction =
  | { type: 'rescrape'; tournamentId: string; pieces: SuggestedPiece[] }
  | { type: 'retry'; jobIds: string[] }
  | { type: 'open'; href: string };

export type InboxTournament = {
  /** The stored tournament's id; null when not stored or not told apart. */
  id: string | null;
  name: string;
  /** The public tab address, never a private URL; null when there is none. */
  tabUrl: string | null;
  status: TabStatusValue;
};

export type InboxMarkItem = { kind: MarkKind; subject: string; fingerprint: string };

export type InboxItem = {
  /** `<kind>:<subject>`, unique in the list. */
  key: string;
  kind: InboxKind;
  tournament: InboxTournament | null;
  /** One sentence on what is wrong; the row adds "+n more" from `more`. */
  summary: string;
  /** Further open findings behind the summary (a check item's other checks). */
  more: number;
  usersAffected: number;
  severity: 'fail' | 'warn';
  /** Since when the item has been waiting, as far as the source records it. */
  age: Date;
  fix: FixAction;
  /** What "Mark checked" stores, one per finding the item stands for. */
  markItems: InboxMarkItem[];
  /** What "Review later" flags: the review-set ids behind the item (none for a check). */
  flagItems: FlagItem[];
  /** The open review-set flag on the item, if any (a badge, not an item). */
  reviewFlag: { priority: Priority } | null;
  /** A mark exists but the data has changed since: "Changed since you checked it". */
  changedSinceChecked: boolean;
};

export type InboxList = {
  rows: InboxItem[];
  total: number;
  page: number;
  pages: number;
  /** Items of each kind, whatever `kinds` filtered: the filter chips' counts. */
  counts: Record<InboxKind, number>;
  /** The import scan hit its page ceiling: older failures were not read. */
  truncated: boolean;
};

/** The kind badge's word and the filter chip's label (the shell's vocabulary). */
export const KIND_LABEL: Record<InboxKind, string> = {
  check: 'Accuracy',
  report: 'CV report',
  import: 'Import',
  parser: 'Parser',
};

/**
 * `?kinds=` as written ("check,import") to the kinds it names: unknown words
 * and repeats dropped, and naming all four is the same as naming none (no
 * filter), so one address means one list.
 */
export function parseKinds(value: string | string[] | undefined): InboxKind[] {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  const named = new Set(raw.split(',').map((w) => w.trim()));
  const kinds = INBOX_KINDS.filter((k) => named.has(k));
  return kinds.length === INBOX_KINDS.length ? [] : kinds;
}

/** The kinds as the address writes them; empty for "all". */
export const kindsParam = (kinds: readonly InboxKind[]): string => kinds.join(',');

/** Why a "? Check" status has no stored tournament behind it (the Inbox and the Imports tab say the same). */
export const CHECK_REASON =
  'Stored or not is unknown: the address matches more than one stored tournament, or none it can name. Search the tournament list by name.';
