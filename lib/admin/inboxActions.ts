import type { InboxItem, InboxMarkItem } from '@/lib/admin/inboxTypes';
import type { FlagItem } from '@/lib/admin/reviewSetTypes';

/**
 * The Inbox table's pure decisions, apart from the component so they can be
 * tested without a browser: what a bulk "Mark checked" sends, what Undo
 * takes back, which review-set flags a selection stands for, and the toast's
 * words.
 */

/** The most marks the checks route takes in one request (its `.max(200)`). */
export const MARK_BATCH_MAX = 200;

type Markable = Pick<InboxItem, 'key' | 'markItems'>;

/**
 * The POST body for "Mark n checked": every mark of every ticked row, whole
 * rows at a time. A row's marks go together or not at all (half a tournament
 * checked would leave it in the Inbox looking unchanged), so when the next
 * row would pass the route's cap it and the rest wait for another press.
 * `keys` are the rows sent; `left` the ticked rows that did not fit.
 */
export function bulkMarkPayload(
  rows: readonly Markable[],
  ticked: ReadonlySet<string>,
): { items: InboxMarkItem[]; keys: string[]; left: number } {
  const items: InboxMarkItem[] = [];
  const keys: string[] = [];
  let left = 0;
  for (const row of rows) {
    if (!ticked.has(row.key)) continue;
    if (left > 0 || items.length + row.markItems.length > MARK_BATCH_MAX) {
      left += 1;
      continue;
    }
    items.push(...row.markItems);
    keys.push(row.key);
  }
  return { items, keys, left };
}

/** What Undo deletes: one target per mark just stored (the route takes one at a time). */
export const undoTargets = (items: readonly InboxMarkItem[]) =>
  items.map(({ kind, subject }) => ({ kind, subject }));

/** The review-set flags for the ticked rows, each once (an import group may share jobs). */
export function flagItemsOf(
  rows: ReadonlyArray<{ key: string; flagItems: readonly FlagItem[] }>,
  ticked: ReadonlySet<string>,
): FlagItem[] {
  const seen = new Set<string>();
  const out: FlagItem[] = [];
  for (const row of rows) {
    if (!ticked.has(row.key)) continue;
    for (const f of row.flagItems) {
      const id = `${f.source}|${f.sourceId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(f);
    }
  }
  return out;
}

/**
 * The toast after "Mark checked". `applied` is how many accuracy checks the
 * re-audit counted as a pass; fewer than were sent means the data changed
 * since the page was read, so they are saved but the score did not move.
 */
export function markedWords(sentChecks: number, applied: number): string {
  if (sentChecks > 0 && applied < sentChecks) {
    return `${applied} of ${sentChecks} accuracy checks counted in the score; the rest changed since you looked. Reload to see them.`;
  }
  return 'It leaves the Inbox when the page refreshes.';
}
