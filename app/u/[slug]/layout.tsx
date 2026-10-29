import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Dedicated layout for public CVs. Strips all app chrome — no nav, no
 * notification bell, no settings/dashboard links — so the page reads
 * like a credentialing artifact rather than a tab in someone else's app.
 *
 * With the (app) route-group split applied in the editorial redesign,
 * the global sticky header no longer leaks into this route. This layout
 * only adds the page wrapper, the paper background, and the colophon
 * footer.
 */
export default function PublicCvLayout({ children }: { children: React.ReactNode }) {
  return (
    // Follows the visitor's theme (redesign owner decision 3, 2026-10-29).
    // It used to be pinned light so every viewer saw the same page; the
    // owner chose instead that only print, the PDF and the share image are
    // fixed light, which the print stylesheet and the OG route already do.
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-5xl space-y-group px-5 pb-16 pt-group">
        <main id="main" className="space-y-group">
          {children}
        </main>
        <footer className="pt-8">
          <hr className="hairline" />
          <div className="mt-6 flex flex-col items-start justify-between gap-3 text-table text-ink-soft sm:flex-row sm:items-center">
            <div className="data-label">Compiled by debate cv</div>
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border bg-paper px-3.5 text-table font-medium text-ink hover:bg-surface-2"
            >
              Build your own →
            </Link>
            <nav aria-label="Legal" className="flex gap-4">
              <Link
                href="/privacy"
                className="inline-flex min-h-6 items-center underline-offset-2 hover:underline"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="inline-flex min-h-6 items-center underline-offset-2 hover:underline"
              >
                Terms
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
