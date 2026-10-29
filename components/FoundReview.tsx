import Link from 'next/link';
import { loadFound } from '@/lib/discovery/loader';
import { loadFoundWithBudget, type FoundOutcome } from '@/lib/discovery/budget';
import { shapeFoundView, type FoundView } from '@/lib/discovery/view';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { FoundList } from '@/components/FoundList';

/** Where the Review stage lives: the Imports page's `?stage=review` view. */
export const REVIEW_HREF = '/dashboard?stage=review';

/**
 * The Found list, phase 1 (docs/superpowers/specs/2026-10-27-discovery-tab-design.md),
 * as the second half of the Imports Review stage. It was its own page at
 * /cv/found until the 2026-10-29 navigation change (Record · Statistics ·
 * Motions · Imports, owner decision); /cv/found now redirects here.
 *
 * Lists appearances on public tabs we already store, at tournaments the user
 * has no private URL for, whose stored name equals one of the names the user
 * has claimed, or (two or more words) holds its words whole and in order
 * (owner's decision 2026-10-27; lib/discovery/names.ts). The user answers
 * "This is me" or "Not me"; the answers are recorded and nothing else
 * happens: no row reaches the CV until option B phases 1-4 and discovery
 * phase 3 ship.
 *
 * The caller checks the discovery flag (lib/discovery/flag.ts) and renders
 * nothing of this without it. The search runs only here, inside the Review
 * view, never on the Imports summary: it can take seconds and has a 12 s
 * budget.
 */
export async function FoundReview({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const outcome = await loadFoundWithBudget(loadFound, userId);
  return (
    <section aria-labelledby="found-intro" className="space-y-6">
      <div>
        <div id="found-intro" className="data-label">
          Found on public tabs
        </div>
        <p className="mt-2 max-w-2xl text-body text-ink-soft">
          These come from public tabs we have stored, at tournaments you have no private URL for. We
          found a name you have claimed on them, spelled exactly the same (sometimes with a title or
          a middle name around it), but we have not checked that they are you. Tell us which ones
          you were at. Nothing is added to your record yet.
        </p>
      </div>
      {outcome.status === 'ok' ? (
        <FoundBody view={shapeFoundView(outcome.load.input)} />
      ) : (
        <FoundFailure outcome={outcome} isAdmin={isAdmin} />
      )}
    </section>
  );
}

/**
 * The loader ran past its budget or failed. Either way the section says so
 * and offers a way on, instead of an endless skeleton or the generic error
 * page. The technical detail (a missing table means a migration has not run)
 * is for an admin only; everyone else gets plain words.
 */
function FoundFailure({
  outcome,
  isAdmin,
}: {
  outcome: Exclude<FoundOutcome, { status: 'ok' }>;
  isAdmin: boolean;
}) {
  const retry = (
    <Link href={REVIEW_HREF} prefetch={false} className={buttonClasses()}>
      Try again
    </Link>
  );
  if (outcome.status === 'timeout') {
    return (
      <EmptyState
        title="This is taking too long"
        description="Searching the stored tabs for your name took longer than it should. Nothing was lost. Try again in a minute."
        action={retry}
      />
    );
  }
  const adminNote =
    outcome.kind === 'missing_table'
      ? `Admin: a table this page reads does not exist, so a migration has probably not run on this database (${outcome.detail}).`
      : `Admin: the search failed with a database error (${outcome.detail}).`;
  return (
    <EmptyState
      title="We could not search right now"
      description={
        isAdmin
          ? adminNote
          : 'Something went wrong while searching the stored tabs. Nothing was lost. Try again later.'
      }
      action={retry}
    />
  );
}

function FoundBody({ view }: { view: FoundView }) {
  const recordLink = (
    <Link href="/cv" className={buttonClasses({ variant: 'outline' })}>
      Back to your record
    </Link>
  );
  if (view.state === 'no_anchors') {
    return (
      <EmptyState
        title="Nothing to search with yet"
        description="We search for the names you have claimed as yours, spelled exactly. Claim your names first, in Settings under Profile (or during onboarding), then come back here."
        action={
          <Link href="/settings/profile" className={buttonClasses()}>
            Open your profile
          </Link>
        }
      />
    );
  }
  if (view.state === 'unsearchable') {
    return (
      <EmptyState
        title="We cannot search for your name yet"
        description="The names you have claimed are written in a script our stored names do not keep yet, so there is nothing to compare it with. This will change when names are stored in full."
        action={recordLink}
      />
    );
  }
  if (view.state === 'zero') {
    return (
      <EmptyState
        title="No other tabs list your name"
        description="No other tab we store lists a name you have claimed. We check again each time you open this view."
        action={recordLink}
      />
    );
  }
  return <FoundList view={view} />;
}
