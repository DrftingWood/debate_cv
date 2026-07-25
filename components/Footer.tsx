import Link from 'next/link';
import { BrandMark } from './BrandMark';

export function Footer() {
  return (
    <footer className="mt-24">
      <div className="mx-auto max-w-6xl px-5">
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
            <Link href="/privacy" className="inline-flex min-h-[44px] items-center hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" className="inline-flex min-h-[44px] items-center hover:text-ink">
              Terms
            </Link>
            <a
              href="https://github.com/DrftingWood/debate_cv"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center hover:text-ink"
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
