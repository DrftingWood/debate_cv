/**
 * What a key does on a tab list (APG tabs pattern), apart from the DOM so it
 * can be tested without one.
 *
 * Arrow keys (Left/Right horizontal, Up/Down vertical) wrap around the list
 * and Home/End jump to the ends. With automatic activation (every panel is
 * already rendered) moving focus also selects. With manual activation (the
 * panel must be fetched, so a switch costs a round trip) moving focus only
 * focuses, and Enter or Space activates the focused tab.
 */
export type TabKeyAction = { focus?: number; activate?: number };

export function tabKeyAction({
  key,
  focused,
  count,
  vertical,
  manual,
}: {
  key: string;
  /** Index of the tab that has focus. */
  focused: number;
  count: number;
  vertical: boolean;
  manual: boolean;
}): TabKeyAction | null {
  if (count === 0) return null;
  const moves: Record<string, number> = {
    [vertical ? 'ArrowDown' : 'ArrowRight']: focused + 1,
    [vertical ? 'ArrowUp' : 'ArrowLeft']: focused - 1,
    Home: 0,
    End: count - 1,
  };
  if (key in moves) {
    const next = (moves[key] + count) % count;
    return manual ? { focus: next } : { focus: next, activate: next };
  }
  // Automatic activation leaves Enter and Space to the browser (a button's
  // own click); manual activation takes them so a link activates on Space too.
  if (manual && (key === 'Enter' || key === ' ')) return { activate: focused };
  return null;
}
