import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { isDiscoveryEnabled } from '@/lib/discovery/flag';
import { loadFound } from '@/lib/discovery/loader';
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
 * has no private URL for, whose name matches a registration name on one of
 * the user's own private URLs. The user answers "This is me" or "Not me"; the
 * answers are recorded and nothing else happens: no row reaches the CV until
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

  const { input } = await loadFound(session.user.id, session.user.name ?? null);
  const view = shapeFoundView(input);
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
          found your name on them, but we have not checked that they are you. Tell us which ones you
          were at. Nothing is added to your record yet.
        </p>
        {isAdmin && view.heldBack > 0 ? (
          <p className="mt-2 max-w-2xl text-caption text-ink-soft">
            Admin: {view.heldBack} registration {view.heldBack === 1 ? 'name is' : 'names are'} held
            back from this search: unlike your other names (possibly a forwarded private URL), or
            past the limit of five.
          </p>
        ) : null}
      </header>

      <CvSubNav active="found" />

      <FoundBody view={view} />
    </div>
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
        description="We search using the name on your private URLs, never a name you type. Import a private URL first; once it is read, your name is searched here."
        action={
          <Link href="/dashboard" className={buttonClasses()}>
            Open imports
          </Link>
        }
      />
    );
  }
  if (view.state === 'unsearchable') {
    return (
      <EmptyState
        title="We cannot search for your name yet"
        description="Your name on your private URLs is written in a script our stored names do not keep yet, so there is nothing to compare it with. This will change when names are stored in full."
        action={recordLink}
      />
    );
  }
  if (view.state === 'zero') {
    return (
      <EmptyState
        title="No other tabs list your name"
        description="Your name does not appear on any other tab we store. We check again each time you open this page."
        action={recordLink}
      />
    );
  }
  return <FoundList view={view} />;
}
