/**
 * Where focus goes in "Flagged for review" when "Mark done" takes a row off
 * the list (done rows hidden): the button pressed goes with its row, and
 * focus left on a removed node falls back to <body> (UX-7). Kept apart from
 * the table so the decision is a pure function a Node test can check.
 */

/** Where focus goes once a row is marked done and leaves the list. */
export type DoneFocus = { row: string } | 'caption' | 'toggle';

/**
 * The next row's first control; past the last row, the table's caption, so
 * a screen reader is back at the table's name; and when the row was the
 * only one, the table goes with it, so the "Show done" toggle.
 */
export function focusTargetAfterDone(ids: readonly string[], doneId: string): DoneFocus {
  const i = ids.indexOf(doneId);
  const next = i >= 0 ? ids[i + 1] : undefined;
  if (next) return { row: next };
  return ids.length > 1 ? 'caption' : 'toggle';
}

const FOCUSABLE = 'a[href], button, select, input, textarea, [tabindex]:not([tabindex="-1"])';

/** Moves focus to `target`, inside the table's panel or to the "Show done" toggle. */
export function moveFocusAfterDone(
  target: DoneFocus,
  { panel, toggle }: { panel: HTMLElement | null; toggle: HTMLElement | null },
) {
  if (target === 'toggle') return toggle?.focus();
  if (target === 'caption') {
    const caption = panel?.querySelector('caption');
    if (!caption) return toggle?.focus();
    caption.tabIndex = -1;
    return caption.focus();
  }
  const row = panel?.querySelector(`tr[data-flag="${CSS.escape(target.row)}"]`);
  // The first control a person can see: a phone hides the Priority cell.
  const control = [...(row?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].find(
    (el) => el.getClientRects().length > 0,
  );
  control?.focus();
}
