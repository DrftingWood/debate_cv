import Link from 'next/link';
import { BrandMark } from './BrandMark';

/**
 * `width` matches the page the footer closes, so its left edge lines up
 * with the header and the content above it (owner review 2026-10-29: it sat
 * 192 px inside them). Signed-in pages are 96rem wide; signed-out pages,
 * the landing page's 80rem (`max-w-wide`).
 */
export function Footer({ width = 'app' }: { width?: 'app' | 'public' } = {}) {
  // 48 px above the footer (owner review 2026-10-29: 128 px of blank).
  return (
    <footer className="mt-section pb-[env(safe-area-inset-bottom)]">
      <div
        className={
          width === 'app' ? 'mx-auto max-w-(--breakpoint-2xl) px-5' : 'mx-auto max-w-wide px-5'
        }
      >
        <hr className="hairline" />
        <div className="flex flex-col gap-4 py-8 text-table text-ink-soft sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark />
            <span className="hidden text-ink-soft sm:inline">
              · a verified record of competitive debating
            </span>
          </div>
          {/*
            min-h-[44px] on each link. These were 20px tall — under the
            24×24 WCAG 2.2 AA floor — and they are the only route to the
            privacy and terms pages, on every page in the product. The
            negative inline margin keeps the enlarged hit areas from
            visually widening the row.
          */}
          <nav
            aria-label="Site links"
            className="-my-2 flex flex-wrap items-center gap-x-6 gap-y-1"
          >
            <Link
              href="/privacy"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center hover:text-ink sm:justify-start"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center hover:text-ink sm:justify-start"
            >
              Terms
            </Link>
            <a
              href="https://github.com/DrftingWood/debate_cv"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center hover:text-ink sm:justify-start"
            >
              GitHub
            </a>
            <span className="text-ink-soft">© {new Date().getFullYear()}</span>
          </nav>
        </div>
      </div>
    </footer>
  );
}
