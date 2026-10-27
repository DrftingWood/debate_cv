import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { isDiscoveryEnabled } from '@/lib/discovery/flag';
import { loadFound } from '@/lib/discovery/loader';
import { loadFoundWithBudget, type FoundOutcome } from '@/lib/discovery/budget';
import { shapeFoundView, type FoundView } from '@/lib/discovery/view';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { CvSubNav } from '@/components/CvSubNav';
import { FoundList } from '@/components/FoundList';

export const metadata: Metadata = {
  title: 'Found',
  description: 'Tournaments on public tabs that may be yours.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The Found tab, phase 1 (docs/superpowers/specs/2026-10-27-discovery-tab-design.md).
 *
 * Lists appearances on public tabs we already store, at tournaments the user
 * has no private URL for, whose stored name equals one of the names the user
 * has claimed, or (two or more words) holds its words whole and in order
 * (owner's decision 2026-10-27; lib/discovery/names.ts). The user answers
 * "This is me" or "Not me"; the answers are recorded and nothing else happens: no row reaches the CV until
 * option B phases 1-4 and discovery phase 3 ship.
 *
 * Behind the discovery flag (lib/discovery/flag.ts). Everyone else gets the
 * not-found page and no nav item. No loading.tsx of its own on purpose: a
 * skeleton would tell a user without the flag that the page exists.
 */
export default async function CvFoundPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  if (!isDiscoveryEnabled(session.user.email)) notFound();

  const outcome = await loadFoundWithBudget(loadFound, session.user.id);
  const isAdmin = isAdminEmail(session.user.email);

  return (
    <div className="space-y-8">
      <header className="border-b border-border pb-6">
        <div className="data-label">Found</div>
        <h1 className="mt-2 font-display text-h1 font-medium tracking-tight text-ink">
          Tournaments that may be yours
        </h1>
        <p className="mt-2 max-w-2xl text-body text-ink-soft">
          These come from public tabs we have stored, at tournaments you have no private URL for. We
          found a name you have claimed on them, spelled exactly the same (sometimes with a title or
          a middle name around it), but we have not checked that they are you. Tell us which ones
          you were at. Nothing is added to your record yet.
        </p>
      </header>

      <CvSubNav active="found" />

      {outcome.status === 'ok' ? (
        <FoundBody view={shapeFoundView(outcome.load.input)} />
      ) : (
        <FoundFailure outcome={outcome} isAdmin={isAdmin} />
      )}
    </div>
  );
}

/**
 * The loader ran past its budget or failed. Either way the page says so and
 * offers a way on, instead of an endless skeleton or the generic error page.
 * The technical detail (a missing table means a migration has not run) is for
 * an admin only; everyone else gets plain words.
 */
function FoundFailure({
  outcome,
  isAdmin,
}: {
  outcome: Exclude<FoundOutcome, { status: 'ok' }>;
  isAdmin: boolean;
}) {
  const retry = (
    <Link href="/cv/found" prefetch={false} className={buttonClasses()}>
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
        description="No other tab we store lists a name you have claimed. We check again each time you open this page."
        action={recordLink}
      />
    );
  }
  return <FoundList view={view} />;
}
