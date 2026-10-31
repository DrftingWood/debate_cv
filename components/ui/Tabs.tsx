'use client';

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { urlWithTab } from '@/lib/utils/tabParam';
import { tabKeyAction } from '@/lib/utils/tabKeys';
import { usePrinting } from '@/components/ui/Deferred';

/*
 * Tabs that switch panels within one page (UX-56): the Statistics layout is
 * three levels of these (role, then outcome or conditions, then a vertical
 * list of sections; owner decision 2026-10-29). A control that changes the
 * URL path is a link, not this.
 *
 * APG tabs pattern (UX-59): one tab stop for the whole list; arrow keys move
 * along it (Left/Right horizontal, Up/Down vertical), Home and End jump to
 * the ends; `aria-selected` and `aria-controls` tie each tab to its panel.
 * In the default mode activation is automatic, moving selects, because every
 * panel is already rendered, so switching costs nothing. In the navigating
 * mode (`onSelect`, below) activation is manual: arrows move focus and Enter
 * or Space activates, since each activation is a page navigation.
 *
 * By default every panel is rendered and the inactive ones are `hidden`. The
 * server has computed all of them anyway (one buildCvData call), so a switch
 * is instant and needs no round trip. The navigating mode (the /admin shell)
 * renders only the active panel: the others are not read at all.
 *
 * The selection lives in the URL (`?<param>=`, UX-60, UX-79) through
 * history.replaceState, the same reasoning as FilterableStats: a router
 * navigation would refetch the whole force-dynamic page for a change the
 * browser can make alone, and replaceState adds no history entry, so Back
 * leaves the page instead of stepping through tabs. The server resolves the
 * starting tab with `resolveTab` (lib/utils/tabParam.ts) and passes it in.
 *
 * Phones (UX-63): a vertical list with `phoneSelect` becomes a labelled
 * <select> below `md`, so a long list of sections never wraps or scrolls
 * sideways. Both controls drive the same state; only one is visible.
 */

export type TabItem = {
  value: string;
  label: string;
  panel: ReactNode;
  /**
   * The year-anchor prefix this panel holds ("y" for #y2025, "j" for
   * #j2025), so a chart link into a tab not yet built can open it first
   * (components/OpenYearOnHash.tsx).
   */
  anchor?: string;
  /**
   * Navigating mode only: the address of this tab. The tab is then a real
   * link, so it works without JavaScript; a plain click is intercepted and
   * handed to `onSelect`.
   */
  href?: string;
};

export function Tabs({
  label,
  param,
  items,
  initialValue,
  orientation = 'horizontal',
  phoneSelect = false,
  selectLabel = 'Section',
  prominent = false,
  onSelect,
  pending = false,
  className,
}: {
  /** Accessible name of the tab list ("Statistics by role"). */
  label: string;
  /** Query parameter that holds the selection. */
  param: string;
  items: TabItem[];
  /** From `resolveTab` on the server; the first item when absent. */
  initialValue?: string;
  orientation?: 'horizontal' | 'vertical';
  /** Vertical lists only: a <select> replaces the list below `md`. */
  phoneSelect?: boolean;
  /** Visible label for that <select>. */
  selectLabel?: string;
  /** The top level of a nested set: larger, so the levels read as a hierarchy. */
  prominent?: boolean;
  /**
   * For a page whose panels are read per tab on the server (/admin): the
   * caller moves the address itself (a navigation that fetches the new
   * panel), so Tabs does not replaceState. Without it every panel is
   * already rendered and the switch is local.
   *
   * In this navigating mode the selected tab follows `initialValue` (the
   * server's answer), not local state, so the old panel stays until the new
   * one arrives; activation is manual (arrows move focus, Enter, Space or a
   * click activate) because each switch is a round trip; and each tab is a
   * link when its item has an `href`.
   */
  onSelect?: (value: string) => void;
  /** Navigating mode: a switch is in flight; the list is marked busy. */
  pending?: boolean;
  className?: string;
}) {
  const fallback = items[0]?.value ?? '';
  const startValue = items.some((i) => i.value === initialValue)
    ? (initialValue as string)
    : fallback;
  const [localValue, setValue] = useState(startValue);
  const navigating = !!onSelect;
  const value = navigating ? startValue : localValue;
  // Panels are built the first time they are shown and kept after (owner
  // review 2026-10-29: hidden panels were most of the Record's 12,375 DOM
  // nodes). Printing builds them all, because Print to PDF prints every tab.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([value]));
  const printing = usePrinting();
  // A server that reads the panels per tab hands a new starting tab when a
  // link elsewhere on the page (the summary line) changes the address. State
  // adjusted during render, not in an effect, so the new tab never paints
  // after the old one; the tab buttons keep their focus.
  const [seenStart, setSeenStart] = useState(startValue);
  if (startValue !== seenStart) {
    setSeenStart(startValue);
    setValue(startValue);
    setVisited((v) => (v.has(startValue) ? v : new Set([...v, startValue])));
  }
  const id = useId();
  const tabRefs = useRef<(HTMLElement | null)[]>([]);
  const tabId = (v: string) => `${id}-tab-${v}`;
  const panelId = (v: string) => `${id}-panel-${v}`;
  const vertical = orientation === 'vertical';

  const select = (next: string) => {
    if (onSelect) {
      onSelect(next);
      return;
    }
    setValue(next);
    setVisited((v) => (v.has(next) ? v : new Set([...v, next])));
    window.history.replaceState(
      window.history.state,
      '',
      urlWithTab(window.location, { param, value: next, fallback }),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Browser and OS shortcuts (Ctrl+Home, Alt+Left, Cmd+Arrow) are not the
    // strip's keys: leave them to the browser.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const focusedId = (e.target as HTMLElement).closest('[role="tab"]')?.id;
    const focused = items.findIndex((i) => tabId(i.value) === focusedId);
    const action = tabKeyAction({
      key: e.key,
      focused: focused >= 0 ? focused : items.findIndex((i) => i.value === value),
      count: items.length,
      vertical,
      manual: navigating,
    });
    if (!action) return;
    e.preventDefault();
    if (action.activate !== undefined) select(items[action.activate].value);
    if (action.focus !== undefined) tabRefs.current[action.focus]?.focus();
  };

  return (
    <div
      className={cn(vertical ? 'grid gap-panel md:grid-cols-[13rem_minmax(0,1fr)]' : '', className)}
    >
      {vertical && phoneSelect ? (
        <label className="block md:hidden">
          <span className="data-label">{selectLabel}</span>
          <select
            value={value}
            onChange={(e) => select(e.target.value)}
            className="mt-hair block h-11 w-full rounded-md border border-input bg-card px-tight text-ui text-ink"
          >
            {items.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div
        role="tablist"
        aria-label={label}
        aria-orientation={orientation}
        aria-busy={navigating ? pending : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          vertical
            ? 'flex flex-col gap-px self-start border-l border-border'
            : // The rule under the row is an inset shadow, not a border: a tab's
              // own underline used to overlap the border by sitting at -1px,
              // and with overflow-x auto that 1px made the row scroll
              // vertically too, which Windows drew as a ▲●▼ scrollbar.
              'flex gap-hair overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]',
          vertical && phoneSelect && 'hidden md:flex',
        )}
      >
        {items.map((item, i) => {
          const selected = item.value === value;
          const shared = {
            ref: (el: HTMLElement | null) => {
              tabRefs.current[i] = el;
            },
            role: 'tab',
            id: tabId(item.value),
            'aria-selected': selected,
            'aria-controls': panelId(item.value),
            tabIndex: selected ? 0 : -1,
            // Two cues for the current tab (UX-47): weight and an emerald
            // rule (under a horizontal tab, beside a vertical one), never
            // colour alone.
            className: cn(
              'shrink-0 transition-colors duration-120 motion-reduce:transition-none',
              prominent ? 'text-body' : 'text-ui',
              vertical
                ? '-ml-px border-l-2 px-tight py-inline text-left coarse:min-h-11'
                : cn(
                    'border-b-2 px-inline whitespace-nowrap coarse:min-h-11',
                    prominent ? 'py-stack' : 'py-tight',
                  ),
              selected
                ? 'border-primary font-semibold text-ink'
                : 'border-transparent text-ink-soft hover:text-ink',
              vertical && selected && 'bg-surface-2',
              // A switch in flight: the old panel stays, the list dims a little.
              pending && 'opacity-70',
            ),
          };
          if (navigating && item.href) {
            return (
              <Link
                key={item.value}
                {...shared}
                href={item.href}
                prefetch={false}
                // A plain click navigates through onSelect; a modified click
                // (new tab, new window) is left to the browser.
                onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  select(item.value);
                }}
              >
                {item.label}
              </Link>
            );
          }
          return (
            <button key={item.value} type="button" {...shared} onClick={() => select(item.value)}>
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.value}
          role="tabpanel"
          id={panelId(item.value)}
          aria-labelledby={tabId(item.value)}
          hidden={item.value !== value}
          data-anchor={item.anchor}
          // A panel often opens with prose, not a control, so it takes focus
          // itself (APG) and Tab from the list lands on the content.
          tabIndex={0}
          // The 200 ms cross-fade (decision 23): a CSS animation restarts
          // each time `hidden` comes off, so every switch fades the new panel
          // in. Opacity only, so reduced motion keeps it.
          className={cn('min-w-0 animate-fade-in', !vertical && 'pt-panel')}
        >
          {visited.has(item.value) || printing ? item.panel : null}
        </div>
      ))}
    </div>
  );
}
