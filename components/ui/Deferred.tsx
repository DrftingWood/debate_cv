'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

/*
 * Render-on-reveal for folded content (owner review 2026-10-29: "don't let
 * any page get too heavy"). The Record built every year's table, every
 * round table and every hidden tab into the page, 12,375 DOM nodes, most of
 * it folded away. These wrappers keep folded content out of the DOM until
 * it is first shown, and keep it once shown, so a second open is instant.
 *
 * Print is the one reader who sees everything at once (Print to PDF expands
 * every year and both tabs, owner decision 15), so each wrapper also renders
 * on `beforeprint`. The update is flushed synchronously, so the content is
 * in the DOM before the browser lays out the print copy.
 */

let printing = false;
const listeners = new Set<() => void>();
function subscribePrint(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    }
  };
}
function onBefore() {
  printing = true;
  flushSync(() => listeners.forEach((l) => l()));
}
function onAfter() {
  printing = false;
  listeners.forEach((l) => l());
}

/** True while the browser prepares or shows a print copy. */
export function usePrinting(): boolean {
  return useSyncExternalStore(
    subscribePrint,
    () => printing,
    () => false,
  );
}

/**
 * The body of a <details>: rendered when the details is open, from then on
 * kept, and always when printing. `initiallyOpen` must match the details'
 * own `open`, so the server and the first client render agree.
 */
export function DetailsBody({
  initiallyOpen,
  children,
}: {
  initiallyOpen: boolean;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(initiallyOpen);
  const ref = useRef<HTMLDivElement>(null);
  const print = usePrinting();
  useEffect(() => {
    const details = ref.current?.closest('details');
    if (!details) return;
    const onToggle = () => {
      if (details.open) setShown(true);
    };
    // Opened before hydration (a hash link, a quick click): catch up.
    onToggle();
    details.addEventListener('toggle', onToggle);
    return () => details.removeEventListener('toggle', onToggle);
  }, []);
  return <div ref={ref}>{shown || print ? children : null}</div>;
}

/**
 * The content of a row that is hidden until its toggle shows it (the
 * Record's round tables): rendered when the enclosing element loses its
 * `hidden` attribute, from then on kept, and always when printing.
 */
export function RevealedBody({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const print = usePrinting();
  useEffect(() => {
    const host = ref.current?.closest('[hidden], [data-reveal-host]');
    if (!host) return;
    const check = () => {
      if (!host.hasAttribute('hidden')) setShown(true);
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(host, { attributes: true, attributeFilter: ['hidden'] });
    return () => mo.disconnect();
  }, []);
  return <div ref={ref}>{shown || print ? children : null}</div>;
}
