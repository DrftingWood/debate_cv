'use client';

import { useEffect } from 'react';

/**
 * Follows a career-chart bar to its year (owner decision 11): the bar links
 * to `#y2025` (speaking) or `#j2025` (judging), and the target is a folded
 * <details> that may sit in a hidden tab panel. A browser scrolls to neither,
 * so this opens the tab that holds the year, opens the year and scrolls it
 * into view, on load and on every hash change.
 *
 * Renders nothing. Without JS the link still changes the hash, and the year
 * is one click away.
 */
export function OpenYearOnHash() {
  useEffect(() => {
    const follow = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!/^[yj](\d{4}|undated)$/.test(id)) return;
      const target = document.getElementById(id);
      if (!(target instanceof HTMLDetailsElement)) return;
      const panel = target.closest<HTMLElement>('[role="tabpanel"]');
      if (panel?.hidden) {
        document.querySelector<HTMLElement>(`[role="tab"][aria-controls="${panel.id}"]`)?.click();
      }
      target.open = true;
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return null;
}
