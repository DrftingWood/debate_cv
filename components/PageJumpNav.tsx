'use client';

import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type JumpTarget = { id: string; label: string };

/**
 * In-page wayfinding for the long surfaces.
 *
 * Measured before this existed: /cv/verify was 41,435px on desktop and
 * 129,987px on a phone — 144 screens — and /cv/motions, /cv/stats and /cv
 * were 23, 8 and 3. Every one of them had exactly one anchor link in the
 * document, and that one was the skip-link. There was no way to reach the
 * seventh section of a page except to scroll past six, and no way back.
 *
 * Two parts, both deliberately cheap:
 *
 *  - A sticky rail of section links. On desktop it sits beside the content;
 *    on mobile it collapses to a horizontal strip under the sub-nav, which
 *    is the only place a 390px viewport has room for it.
 *  - A back-to-top button that appears once you are two screens down. On a
 *    144-screen page, "scroll back up" is not a reasonable instruction.
 *
 * The active section is tracked with IntersectionObserver rather than a
 * scroll listener so it costs nothing while idle. `scroll-mt` on each
 * target keeps the sticky header from covering the heading it jumped to.
 */
export function PageJumpNav({
  targets,
  className,
}: {
  targets: JumpTarget[];
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(targets[0]?.id ?? null);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const sections = targets
      .map((t) => document.getElementById(t.id))
      .filter((el): el is HTMLElement => el != null);
    if (sections.length === 0) return;

    // rootMargin pulls the "current" band to the upper third of the
    // viewport: without it the heading you just jumped to is technically
    // visible but the entry below it wins, and the rail highlights the
    // wrong row immediately after a click.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [targets]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > window.innerHeight * 2);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (targets.length < 2) return null;

  return (
    <>
      <nav
        aria-label="On this page"
        data-print-hide="true"
        className={cn(
          '-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0',
          className,
        )}
      >
        <div className="inline-flex gap-1 lg:sticky lg:top-24 lg:flex-col lg:gap-0.5">
          <span className="data-label hidden pb-1 lg:block">On this page</span>
          {targets.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              aria-current={active === t.id ? 'true' : undefined}
              className={cn(
                'whitespace-nowrap rounded-md px-2.5 py-2 text-table transition-colors lg:border-l-2 lg:px-3',
                active === t.id
                  ? 'bg-surface-2 font-medium text-ink lg:border-primary lg:bg-transparent'
                  : 'text-ink-soft hover:text-ink lg:border-transparent',
              )}
            >
              {t.label}
            </a>
          ))}
        </div>
      </nav>

      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
        data-print-hide="true"
        className={cn(
          'fixed right-5 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-ink shadow-md transition-opacity hover:bg-surface-2 md:h-11 md:w-11',
          // Clear of the home indicator on a notched phone.
          'bottom-[calc(1.25rem+env(safe-area-inset-bottom))]',
          showTop ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <ArrowUp className="h-4 w-4" aria-hidden />
      </button>
    </>
  );
}
