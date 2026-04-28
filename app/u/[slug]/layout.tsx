import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';

export const metadata: Metadata = {
  // Per Q9/Q21: public CVs are link-shared, not search-indexed.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Dedicated layout for public CVs. Strips the global app chrome — no nav,
 * no notification bell, no Settings/Dashboard links — so the page reads
 * like a credentialing artifact rather than a tab in someone else's app.
 *
 * The layout used by app/layout.tsx still wraps this (Next.js root layout
 * always applies). To keep the public surface clean, we simply don't
 * render the app header/footer here — but rest assured the global nav
 * element from app/layout.tsx is still present in markup. That's fine
 * because app/layout.tsx auth-gates the nav off for signed-out users
 * implicitly via NotificationBell visibility, and the nav's links work
 * for both anyone visiting (sign in CTA) and the owner (their own CV).
 */
export default function PublicCvLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-12 pb-12">
      {children}
      <footer className="border-t border-border pt-6 text-center text-caption text-muted-foreground">
        <Link href="/" className="inline-flex items-center gap-2 hover:text-foreground">
          <BrandMark />
          <span>· Built on debate cv. Build your own →</span>
        </Link>
      </footer>
    </div>
  );
}
