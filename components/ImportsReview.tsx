import Link from 'next/link';
import { isAdminEmail } from '@/lib/admin';
import { isDiscoveryEnabled } from '@/lib/discovery/flag';
import { buttonClasses } from '@/components/ui/Button';
import { FoundReview } from '@/components/FoundReview';

/**
 * The Review stage of the Imports page (`/dashboard?stage=review`): every
 * question we need the user to answer before something reaches their record,
 * in one place (redesign, owner decision 2026-10-29).
 *
 *   1. Imports that ingested but where we could not find the user: they pick
 *      their name in the existing Unmatched table.
 *   2. With the discovery flag, the Found list: appearances on public tabs at
 *      tournaments they have no private URL for.
 *
 * The Unmatched count is already on the stage tile; the Found search is only
 * run here, because it is slow (see FoundReview).
 */
export async function ImportsReview({
  userId,
  email,
  unmatched,
}: {
  userId: string;
  email: string | null | undefined;
  unmatched: number;
}) {
  // FoundReview is a hook-free async server component, so awaiting it here
  // renders exactly what <FoundReview /> would, and keeps this stage
  // renderable to static HTML in tests (renderToStaticMarkup cannot wait on
  // an async child).
  const found = isDiscoveryEnabled(email)
    ? await FoundReview({ userId, isAdmin: isAdminEmail(email) })
    : null;
  return (
    <div className="space-y-section">
      <section aria-labelledby="review-names" className="space-y-tight">
        <h2 id="review-names" className="font-display text-h3 font-medium text-ink">
          Your name on your imports
        </h2>
        {unmatched > 0 ? (
          <>
            <p className="max-w-2xl text-body text-ink-soft">
              We could not find you on {unmatched} imported {unmatched === 1 ? 'tab' : 'tabs'}. Pick
              your name on each one so its results join your record.
            </p>
            {/* Outline, not primary: the page header already holds this
                view's one primary action (UX-65). */}
            <Link
              href="/dashboard?filter=unmatched"
              className={buttonClasses({ variant: 'outline' })}
            >
              Review {unmatched} {unmatched === 1 ? 'import' : 'imports'}
            </Link>
          </>
        ) : (
          <p className="max-w-2xl text-body text-ink-soft">
            Every import has your name on it. Nothing to review here.
          </p>
        )}
      </section>
      {found}
    </div>
  );
}
