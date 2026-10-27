'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The disclosure-popover mechanics, once (UX-5, audit NAV-11).
 *
 * The account menu and the notification bell each re-implemented
 * outside-click and Escape, and neither moved focus: the panel opened
 * somewhere a keyboard user could not see, and Escape left focus on
 * whatever had it, which was often the now-removed panel, so focus fell
 * back to <body>. This hook does the four things a disclosure popover owes
 * a keyboard user:
 *
 *  - on open, focus the first focusable thing in the panel (or the panel
 *    itself, which callers give `tabIndex={-1}`, when it has none);
 *  - Escape closes and returns focus to the trigger;
 *  - a pointer press outside closes (focus goes where the press went);
 *  - Tab past the end closes, so the panel never floats over the page
 *    after focus has left it.
 *
 * Deliberately not `role="menu"`: that role promises arrow-key navigation
 * and typeahead, and the APG's own navigation examples use a disclosure.
 */
export function usePopover<P extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<P | null>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onPointer = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close(false);
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, close]);

  return { open, setOpen, close, containerRef, triggerRef, panelRef };
}
