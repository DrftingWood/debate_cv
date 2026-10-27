'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Moves focus to the new page's heading after a client-side route change
 * (UX-77, WCAG 2.4.3). Next.js announces the new title and scrolls, but it
 * leaves focus on the link that was clicked, or on <body> once that link has
 * unmounted, so a keyboard or screen-reader user resumes from nowhere.
 *
 * Only a pathname change counts: filters and sort controls rewrite the query
 * string and must keep the focus they have (UX-60). The first render is
 * skipped so a fresh page load keeps the browser's own behaviour and the
 * skip link still works.
 */
export function FocusOnNavigate() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const first = previous.current === null;
    const changed = previous.current !== pathname;
    previous.current = pathname;
    if (first || !changed) return;

    const main = document.getElementById('main');
    const target = (main?.querySelector('h1') as HTMLElement | null) ?? main;
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}
