import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PieceGrid } from '@/components/admin/PieceGrid';
import { requireAdmin } from '@/lib/admin';
import { orderTabs, toPieceCard } from '@/lib/admin/pieceGrid';
import { AccuracyChecks } from '@/components/admin/AccuracyChecks';
import { getTournamentAccuracy } from '@/lib/admin/tournamentAccuracy';
import { getTournamentPieces } from '@/lib/admin/scrapeHealth';
import { TabLink } from '@/components/admin/TabLink';
import { StaffNames } from '@/components/admin/StaffNames';
import { getTournamentStaff } from '@/lib/admin/tournamentStaff';
import { IgnoreTournament } from '@/components/admin/IgnoreTournament';
import { looksLikeTestTournament } from '@/lib/admin/ignoreSuggestion';
import { DeleteTournament } from '@/components/admin/DeleteTournament';
import { cvUsers } from '@/lib/admin/deletedTournaments';

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
  const [data, audit, staff, onCvs] = await Promise.all([
    getTournamentPieces(BigInt(id)),
    // The checks are extra: if reading them fails, the grid and re-scrape
    // must stay usable. The panel then says the read failed rather than
    // "Not audited yet", which would send the admin to audit a tournament
    // that may well have been audited.
    getTournamentAccuracy(BigInt(id)).catch((err: unknown) => {
      console.error(`admin: accuracy checks for tournament ${id} failed to load`, err);
      return 'failed' as const;
    }),
    staffOrNone(id),
    cvUsersOrNull(id),
  ]);
  if (!data) notFound();

  // One clock for every relative time on the page, worked out here so the
  // client's first render matches the server's HTML.
  const now = new Date();
  const tabs = orderTabs(data.tabs.map((p) => toPieceCard(p, now)));
  const rounds = data.rounds.map((p) => toPieceCard(p, now));
  const cards = [...tabs, ...rounds];

  return (
    <div className="space-y-group">
      <PageHeader name={data.tournament.name} sourceUrl={data.tournament.sourceUrl} cards={cards} />

      <AccuracyChecks
        tournamentId={id}
        tournamentName={data.tournament.name}
        audit={audit === 'failed' ? null : audit}
        loadFailed={audit === 'failed'}
        now={now}
      />

      <StaffNames rows={staff} />

      <IgnoreSection id={id} name={data.tournament.name} ignored={data.tournament.ignored} />

      <DeleteTournament tournamentId={id} tournamentName={data.tournament.name} onCvs={onCvs} />

      {cards.length === 0 ? (
        <EmptyState
          title="No pieces recorded yet"
          description="They are recorded from the next scrape."
          headingLevel={2}
        />
      ) : (
        <PieceGrid
          tournamentId={id}
          tabs={tabs}
          rounds={rounds}
          suggested={(audit && audit !== 'failed' ? audit.suggested : []).map(({ kind, key }) => ({
            kind,
            key,
          }))}
        />
      )}
    </div>
  );
}

// Extra, like the checks: a failed read leaves the list empty, not the page broken.
const staffOrNone = (id: string) =>
  getTournamentStaff(BigInt(id)).catch((err: unknown) => {
    console.error(`admin: staff names for tournament ${id} failed to load`, err);
    return [];
  });

// Extra too: unknown (null) leaves the delete to the route's own check.
const cvUsersOrNull = (id: string) =>
  cvUsers(BigInt(id)).catch((err: unknown) => {
    console.error(`admin: CV users for tournament ${id} failed to load`, err);
    return null;
  });

// Ignore control; the suggestion is the name's alone, never an automatic ignore.
function IgnoreSection({ id, name, ignored }: { id: string; name: string; ignored: boolean }) {
  return (
    <IgnoreTournament
      tournamentId={id}
      tournamentName={name}
      ignored={ignored}
      looksLikeTest={looksLikeTestTournament(name)}
    />
  );
}

// Withheld pages (the tournament keeps them back) are counted apart from the
// failures: they are its choice, not a fault.
const countStatus = (cards: Array<{ status: string }>, status: 'failed' | 'withheld') =>
  cards.filter((p) => p.status === status).length;

function PageHeader({
  name,
  sourceUrl,
  cards,
}: {
  name: string;
  sourceUrl: string;
  cards: Array<{ status: string }>;
}) {
  const total = cards.length;
  const failed = countStatus(cards, 'failed');
  const withheld = countStatus(cards, 'withheld');
  return (
    <header className="space-y-tight">
      <div className="kicker">ADMIN · TOURNAMENT</div>
      <h1 className="font-display text-h2 font-medium tracking-tight wrap-break-word text-ink">
        {name}
      </h1>
      <hr className="hairline" />
      <div className="flex flex-col gap-tight sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-caption tabular-nums text-ink-soft">
          {total === 0
            ? 'No pieces tracked'
            : `${total} ${total === 1 ? 'piece' : 'pieces'} · ${failed} failed${withheld > 0 ? ` · ${withheld} withheld` : ''}`}
        </p>
        <div className="flex flex-wrap items-center gap-inline">
          {/* A new tab, so the grid keeps its place; TabLink keeps the
              href public and names the tournament (UX-11). */}
          <TabLink url={sourceUrl} text="Public tab" of={name} asButton />
          <Link href="/admin" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            ← Admin
          </Link>
        </div>
      </div>
    </header>
  );
}
