'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { urlWithTab } from '@/lib/utils/tabParam';

/*
 * Tabs that switch panels within one page (UX-56): the Statistics layout is
 * three levels of these (role, then outcome or conditions, then a vertical
 * list of sections; owner decision 2026-10-29). A control that changes the
 * URL path is a link, not this.
 *
 * APG tabs pattern (UX-59): one tab stop for the whole list; arrow keys move
 * along it (Left/Right horizontal, Up/Down vertical), Home and End jump to
 * the ends; `aria-selected` and `aria-controls` tie each tab to its panel.
 * Activation is automatic, moving selects, because every panel is already
 * rendered, so switching costs nothing.
 *
 * Every panel is rendered and the inactive ones are `hidden`. The server has
 * computed all of them anyway (one buildCvData call), so a switch is
 * instant and needs no round trip.
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

export type TabItem = { value: string; label: string; panel: ReactNode };

export function Tabs({
  label,
  param,
  items,
  initialValue,
  orientation = 'horizontal',
  phoneSelect = false,
  selectLabel = 'Section',
  prominent = false,
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
  className?: string;
}) {
  const fallback = items[0]?.value ?? '';
  const [value, setValue] = useState(
    items.some((i) => i.value === initialValue) ? (initialValue as string) : fallback,
  );
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabId = (v: string) => `${id}-tab-${v}`;
  const panelId = (v: string) => `${id}-panel-${v}`;
  const vertical = orientation === 'vertical';

  const select = (next: string) => {
    setValue(next);
    window.history.replaceState(
      window.history.state,
      '',
      urlWithTab(window.location, { param, value: next, fallback }),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((i) => i.value === value);
    const keys: Record<string, number> = {
      [vertical ? 'ArrowDown' : 'ArrowRight']: current + 1,
      [vertical ? 'ArrowUp' : 'ArrowLeft']: current - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = (keys[e.key] + items.length) % items.length;
    select(items[next].value);
    tabRefs.current[next]?.focus();
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
        onKeyDown={onKeyDown}
        className={cn(
          vertical
            ? 'flex flex-col gap-px self-start border-l border-border'
            : 'flex gap-hair overflow-x-auto border-b border-border',
          vertical && phoneSelect && 'hidden md:flex',
        )}
      >
        {items.map((item, i) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(item.value)}
              aria-selected={selected}
              aria-controls={panelId(item.value)}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(item.value)}
              // Two cues for the current tab (UX-47): weight and an emerald
              // rule (under a horizontal tab, beside a vertical one), never
              // colour alone.
              className={cn(
                'shrink-0 transition-colors duration-120 motion-reduce:transition-none',
                prominent ? 'text-body' : 'text-ui',
                vertical
                  ? '-ml-px border-l-2 px-tight py-inline text-left coarse:min-h-11'
                  : cn(
                      '-mb-px border-b-2 px-inline whitespace-nowrap coarse:min-h-11',
                      prominent ? 'py-stack' : 'py-tight',
                    ),
                selected
                  ? 'border-primary font-semibold text-ink'
                  : 'border-transparent text-ink-soft hover:text-ink',
                vertical && selected && 'bg-surface-2',
              )}
            >
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
          // A panel often opens with prose, not a control, so it takes focus
          // itself (APG) and Tab from the list lands on the content.
          tabIndex={0}
          className={cn('min-w-0', !vertical && 'pt-panel')}
        >
          {item.panel}
        </div>
      ))}
    </div>
  );
}
