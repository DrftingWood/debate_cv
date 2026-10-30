'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/*
 * A visible name for an icon-only control (UX-72, NV-21).
 *
 * The control keeps its own accessible name (aria-label or sr-only text), so
 * the tooltip is a visual copy and is `aria-hidden`: announcing it as well
 * would read the name twice. That also means it never holds anything a
 * screen-reader user lacks, so a hover-only reveal is fine (UX-36).
 *
 * WCAG 1.4.13 (content on hover or focus):
 *   - dismissible: Escape closes it without moving focus;
 *   - hoverable: it is a child of the wrapper, and its padding bridges the
 *     gap to the trigger, so moving the pointer onto it does not close it;
 *   - persistent: it stays until the pointer leaves, focus leaves, or Escape.
 *
 * Shown on mouse hover after a short delay (so sweeping across the header
 * does not flash four labels) and at once on keyboard focus. Not on touch:
 * a tap is an activation, and the control's name is already announced. Not
 * while the control's own menu is open (`aria-expanded="true"`), where it
 * would sit on top of the panel.
 *
 * Positioned absolutely inside the wrapper, so it suits controls that are
 * not inside a clipping container (header, fixed buttons). A control inside
 * a scrolling table would need a portal. Closed, it is `display: none`, not
 * merely invisible: an invisible box still counts towards the page's width,
 * and a label centred on a control at the right edge of a 390px screen made
 * every page scroll sideways by 3px (UX-39). A control near the right edge
 * also passes `align="end"`, so the open label grows leftwards; one at the
 * left edge passes `align="start"`, so it grows rightwards.
 */

type Side = 'top' | 'bottom' | 'left';

const OUTER: Record<Side, string> = {
  bottom: 'top-full pt-hair',
  top: 'bottom-full pb-hair',
  left: 'right-full top-1/2 -translate-y-1/2 pr-1.5',
};

const ALIGN = {
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
  start: 'left-0',
} as const;

const HOVER_DELAY_MS = 400;

export function Tooltip({
  content,
  side = 'bottom',
  align = 'center',
  disabled = false,
  wrap = false,
  className,
  children,
}: {
  content: string;
  side?: Side;
  /** Top and bottom only: `end` / `start` line the label up with the control's right / left edge. */
  align?: keyof typeof ALIGN;
  /** Suppress the tooltip, e.g. while the control itself is hidden. */
  disabled?: boolean;
  /**
   * Let a sentence-length label wrap inside a fixed width instead of running
   * on one line (which at 390px ran off the screen). Off by default: the
   * short names on icon buttons stay single-line.
   */
  wrap?: boolean;
  /** Classes for the wrapper; a fixed-position control puts its positioning here. */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const menuOpen = () => !!wrapper.current?.querySelector('[aria-expanded="true"]');
  const show = () => {
    if (!disabled && !menuOpen()) setOpen(true);
  };
  const hide = () => {
    cancel();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => cancel, []);

  return (
    <span
      ref={wrapper}
      className={cn('relative inline-flex', className)}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        cancel();
        timer.current = window.setTimeout(show, HOVER_DELAY_MS);
      }}
      onPointerLeave={hide}
      // A click opens the control's menu or acts; the label has done its job.
      onPointerDown={hide}
      onFocus={(e) => {
        if (e.target.matches(':focus-visible')) show();
      }}
      onBlur={hide}
    >
      {children}
      <span
        aria-hidden
        className={cn(
          'absolute z-50',
          OUTER[side],
          side !== 'left' && ALIGN[align],
          open && !disabled ? 'block' : 'hidden',
        )}
      >
        <span
          className={cn(
            'block rounded-md bg-foreground px-2 py-1 text-caption font-medium text-background shadow-md',
            wrap ? 'w-max max-w-[16rem] whitespace-normal text-left' : 'whitespace-nowrap',
          )}
        >
          {content}
        </span>
      </span>
    </span>
  );
}
