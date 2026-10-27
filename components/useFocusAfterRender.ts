'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Move focus to an element that does not exist yet.
 *
 * The settings and onboarding forms swap one block for another on click
 * (trigger → confirm panel, scan step → read step). The control that had
 * focus unmounts with the old block and focus falls to <body>, so a keyboard
 * or screen-reader user restarts from the top of the page with no word of
 * what changed (SC 2.4.3; UX-7). Callers ask for focus in the event handler,
 * and it is applied after the next commit, once the new element is mounted.
 *
 * A request made from a handler, rather than an effect keyed on state, so
 * nothing is focused on first render (and React's dev double-invoked mount
 * effects cannot steal focus on page load).
 */
export function useFocusAfterRender() {
  const pending = useRef<RefObject<HTMLElement | null> | null>(null);
  useEffect(() => {
    const target = pending.current;
    if (!target?.current) return;
    pending.current = null;
    target.current.focus();
  });
  return useCallback((target: RefObject<HTMLElement | null>) => {
    pending.current = target;
  }, []);
}
