import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowSquareOut } from '@/components/ui/icons';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PieceGrid } from '@/components/admin/PieceGrid';
import { requireAdmin } from '@/lib/admin';
import { orderTabs, toPieceCard } from '@/lib/admin/pieceGrid';
import { getTournamentPieces } from '@/lib/admin/scrapeHealth';
import { publicTournamentUrl } from '@/lib/cv/publicTournamentUrl';

export const metadata: Metadata = {
  title: 'Tournament pieces · Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * One tournament's scrape, piece by piece: every tab and every results
 * round, whether it loaded, and a picker to re-scrape any of them now. The
 * overview's "Partly loaded tournaments" rows link here.
 */
export default async function AdminTournamentPiecesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Same guard as /admin: requireAdmin throws for anyone else, and they are
  // sent home rather than shown an error page that confirms the route.
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }

  // Digits only, as the rescrape route accepts: BigInt('5abc') throws, and
  // BigInt(' 5') quietly reads 5.
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const data = await getTournamentPieces(BigInt(id));
  if (!data) notFound();

  // One clock for every relative time on the page, worked out here so the
  // client's first render matches the server's HTML.
  const now = new Date();
  const tabs = orderTabs(data.tabs.map((p) => toPieceCard(p, now)));
  const rounds = data.rounds.map((p) => toPieceCard(p, now));
  const total = tabs.length + rounds.length;
  const failed = [...tabs, ...rounds].filter((p) => p.status === 'failed').length;
  // Never the stored value: on an old row it can be someone's private URL.
  const publicUrl = publicTournamentUrl(data.tournament.sourceUrl);

  return (
    <div className="space-y-group">
      <header className="space-y-tight">
        <div className="kicker">ADMIN · TOURNAMENT</div>
        <h1 className="font-display text-h2 font-medium tracking-tight wrap-break-word text-ink">
          {data.tournament.name}
        </h1>
        <hr className="hairline" />
        <div className="flex flex-col gap-tight sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-caption tabular-nums text-ink-soft">
            {total === 0
              ? 'No pieces tracked'
              : `${total} ${total === 1 ? 'piece' : 'pieces'} · ${failed} failed`}
          </p>
          <div className="flex flex-wrap items-center gap-inline">
            {publicUrl ? (
              <a href={publicUrl} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                Public tab <ArrowSquareOut className="h-4 w-4" aria-hidden />
              </a>
            ) : null}
            <Link href="/admin" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
              ← Admin
            </Link>
          </div>
        </div>
      </header>

      {total === 0 ? (
        <EmptyState
          title="No pieces recorded yet"
          description="They are recorded from the next scrape."
          headingLevel={2}
        />
      ) : (
        <PieceGrid tournamentId={id} tabs={tabs} rounds={rounds} />
      )}
    </div>
  );
}
