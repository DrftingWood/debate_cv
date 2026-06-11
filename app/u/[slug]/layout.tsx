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
    // Forced light: the public CV is a credentialing artifact and must
    // look identical for every viewer (and match print) regardless of the
    // visitor's theme. data-theme on the wrapper re-scopes the CSS vars.
    <div data-theme="light" className="min-h-screen bg-paper text-ink">
    <div className="mx-auto max-w-5xl space-y-14 px-5 pb-16 pt-10">
      {children}
      <footer className="pt-10">
        <hr className="hairline" />
        <div className="mt-6 flex flex-col items-start justify-between gap-3 text-table text-ink-soft sm:flex-row sm:items-center">
          <div className="text-ink-soft">
            Built with{' '}
            <Link href="/" className="text-ink hover:underline">
              debate cv
            </Link>
            .
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md border border-ink/15 bg-paper px-3 py-1.5 text-table font-medium text-ink hover:bg-ink/[0.04]"
          >
            Build your own →
          </Link>
        </div>
      </footer>
    </div>
    </div>
  );
}
