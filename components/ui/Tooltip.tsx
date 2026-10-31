'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
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
 *
 * `fixed` is that portal's cheaper stand-in, for a control inside a table
 * (the Tab cell's "? Partly", Task 5c): the open label is placed against
 * the viewport from the wrapper's box, so the table's scrolling panel does
 * not clip it. It stays a DOM child of the wrapper, so moving the pointer
 * onto it still counts as hovering, and it closes on any scroll rather than
 * float away from its control. A fixed label that would run past the
 * bottom of the screen opens upwards instead, when there is more room above
 * (a "? Partly" on the last rows of a table).
 *
 * Tap to pin (the Tab cell's error list): hover and focus are not there on
 * a phone, so a list that is the cell's whole point needs a tap. Pass
 * `children` as a function and it is handed `pinned` and `togglePin`: the
 * trigger becomes a button whose `aria-expanded` is `pinned`, and a tap
 * shows the label until the next tap, a tap elsewhere, Escape, focus
 * leaving or a scroll. Hover and focus work as before.
 */

type Side = 'top' | 'bottom' | 'left';

/** What a function child is handed, for a trigger that pins the label on a tap. */
export type PinApi = { pinned: boolean; togglePin: () => void };

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
  fixed = false,
  className,
  children,
}: {
  /** A string for a control's name; a short list (a cell's errors) as nodes. */
  content: ReactNode;
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
  /** Top and bottom only: position the open label against the viewport (see above). */
  fixed?: boolean;
  /** Classes for the wrapper; a fixed-position control puts its positioning here. */
  className?: string;
  /** The control; as a function, a trigger that pins the label on a tap (see above). */
  children: ReactNode | ((pin: PinApi) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState<{ style: CSSProperties; side: Side } | null>(null);
  const wrapper = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const visible = (open || pinned) && !disabled;
  const place = () => {
    if (fixed && wrapper.current)
      setAt(fixedPosition(wrapper.current, label.current, { side, align }));
  };
  const togglePin = () => {
    if (!pinned) place();
    setPinned((p) => !p);
  };

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const menuOpen = () => !!wrapper.current?.querySelector('[aria-expanded="true"]');
  const show = () => {
    if (disabled || menuOpen()) return;
    place();
    setOpen(true);
  };
  const hide = () => {
    cancel();
    setOpen(false);
  };

  useDismiss(visible, {
    fixed,
    wrapper,
    close: () => {
      setOpen(false);
      setPinned(false);
    },
  });

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
      onBlur={() => {
        hide();
        setPinned(false);
      }}
    >
      <Trigger control={children} pin={{ pinned, togglePin }} />
      <span
        ref={label}
        aria-hidden
        style={fixed && at ? at.style : undefined}
        className={cn(
          labelPlacement({ fixed, side, placed: at?.side, align }),
          visible ? 'block' : 'hidden',
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

/**
 * Escape, a scroll (for a fixed label, which would float away) or a tap
 * outside the control and its label closes an open or pinned label.
 */
function useDismiss(
  visible: boolean,
  {
    fixed,
    wrapper,
    close,
  }: { fixed: boolean; wrapper: RefObject<HTMLSpanElement | null>; close: () => void },
) {
  const onClose = useRef(close);
  useEffect(() => {
    onClose.current = close;
  });
  useEffect(() => {
    if (!visible) return;
    const shut = () => onClose.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') shut();
    };
    const onPointer = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) shut();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    if (fixed) window.addEventListener('scroll', shut, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', shut, true);
    };
  }, [visible, fixed, wrapper]);
}

/** The label's positioning classes; a fixed label pads on the side it opened towards. */
function labelPlacement({
  fixed,
  side,
  placed,
  align,
}: {
  fixed: boolean;
  side: Side;
  placed: Side | undefined;
  align: keyof typeof ALIGN;
}): string {
  if (fixed && side !== 'left')
    return cn('fixed z-50', (placed ?? side) === 'top' ? 'pb-hair' : 'pt-hair');
  return cn('absolute z-50', OUTER[side], side !== 'left' && ALIGN[align]);
}

/**
 * The control, or what a function child makes of the pin state. A component
 * of its own, so the function is called while this renders, not handed the
 * Tooltip's ref-reading callbacks in the middle of the Tooltip's render.
 */
function Trigger({
  control,
  pin,
}: {
  control: ReactNode | ((pin: PinApi) => ReactNode);
  pin: PinApi;
}) {
  return <>{typeof control === 'function' ? control(pin) : control}</>;
}

/**
 * Which way a `fixed` label opens: as asked, unless a downward label would
 * run past the bottom of the screen and there is more room above.
 */
export function fixedSide(
  side: Side,
  box: { top: number; bottom: number },
  { labelHeight, viewportHeight }: { labelHeight: number; viewportHeight: number },
): Side {
  if (side !== 'bottom') return side;
  const below = viewportHeight - box.bottom;
  return labelHeight > below && box.top > below ? 'top' : 'bottom';
}

/**
 * The label's height, measured while it is closed: shown for the moment of
 * the measurement, unseen, and put back at once, so it never paints in the
 * wrong place.
 */
function closedHeight(label: HTMLElement | null): number {
  if (!label) return 0;
  const { display, visibility } = label.style;
  label.style.visibility = 'hidden';
  label.style.display = 'block';
  const h = label.getBoundingClientRect().height;
  label.style.display = display;
  label.style.visibility = visibility;
  return h;
}

/** Where a `fixed` label goes, from its control's box on screen. */
function fixedPosition(
  el: HTMLElement,
  label: HTMLElement | null,
  { side: asked, align }: { side: Side; align: keyof typeof ALIGN },
): { style: CSSProperties; side: Side } {
  const r = el.getBoundingClientRect();
  const side = fixedSide(asked, r, {
    labelHeight: closedHeight(label),
    viewportHeight: window.innerHeight,
  });
  const vertical: CSSProperties =
    side === 'top' ? { bottom: window.innerHeight - r.top } : { top: r.bottom };
  if (align === 'start') return { side, style: { ...vertical, left: r.left } };
  if (align === 'end') return { side, style: { ...vertical, right: window.innerWidth - r.right } };
  return {
    side,
    style: { ...vertical, left: r.left + r.width / 2, transform: 'translateX(-50%)' },
  };
}
