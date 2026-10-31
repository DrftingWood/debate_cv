import Link from 'next/link';
import { prisma } from '@/lib/db';
import { ClearDataButton, FullWipeButton, ReingestAllButton } from '@/components/AdminActions';
import { IngestProgressTracker } from '@/components/IngestProgressTracker';
import { buttonClasses } from '@/components/ui/Button';
import { FillCoresButton } from '@/components/admin/FillCoresButton';
import { FillFormatsButton } from '@/components/admin/FillFormatsButton';
import { TournamentLookup } from '@/components/admin/TournamentLookup';
import { countMissingCores } from '@/lib/admin/coreFill';
import { orNull } from '@/lib/admin/orNull';

/**
 * Operator tools: the lookup, the other tools' doors, the queue action with
 * the two URL counts that bear on it, and the destructive pair folded away.
 * The Locked and Discovered counts used to be tiles that drove nothing; they
 * sit beside Re-ingest all, which they explain (it skips the locked ones).
 */
export async function ToolsTab() {
  const [discovered, locked, noFormat, noCore] = await Promise.all([
    prisma.discoveredUrl.count().catch(orNull('discovered URL count')),
    prisma.discoveredUrl
      .count({ where: { reingestLocked: true } })
      .catch(orNull('locked URL count')),
    prisma.tournament.count({ where: { format: null } }).catch(orNull('missing format count')),
    countMissingCores().catch(orNull('missing adjudication core count')),
  ]);
  const count = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-GB'));
  const reingestable =
    discovered !== null && locked !== null ? Math.max(0, discovered - locked) : 0;

  return (
    <div className="space-y-group">
      <IngestProgressTracker scope="global" />

      <LookupSection />
      <CheckAndTag />
      <FillFormats missing={noFormat} />
      <FillCores missing={noCore} />
      <ReingestAll
        discovered={count(discovered)}
        locked={count(locked)}
        reingestable={reingestable}
      />
      <DangerZone />
    </div>
  );
}

// The same search box as the Tournaments tab (owner, 2026-10-31: "a view if
// that tournament is present in the database or not").
function LookupSection() {
  return (
    <section aria-labelledby="in-database" className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id="in-database" className="font-display text-h3 font-medium text-ink">
          Is it in the database?
        </h2>
        <p className="mt-hair max-w-prose text-body text-ink-soft">
          Paste a tab or private URL to see whether its tournament is stored, or type part of a name
          to list the matches.
        </p>
      </div>
      <TournamentLookup />
    </section>
  );
}

// Tags and Verify used to sit in the CV sub-bar (admins only). That bar went
// with the 2026-10-29 navigation change, so they are reached from here.
function CheckAndTag() {
  return (
    <section aria-labelledby="other-tools" className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id="other-tools" className="font-display text-h3 font-medium text-ink">
          Check and tag
        </h2>
        <p className="mt-hair max-w-prose text-body text-ink-soft">
          Check what the parser read, tag tournaments and motions, and review the tags users
          proposed. Approvals write straight to the tournament and motion records.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-inline">
        <Link href="/cv/verify" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          Verify parsed tournaments →
        </Link>
        <Link href="/cv/tags" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          Tag tournaments and motions →
        </Link>
        <Link href="/admin/tags" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          Review tag proposals →
        </Link>
      </div>
    </section>
  );
}

// Tournaments stored with no format (R9). The button reads the stored rounds
// and team sizes, so it fetches nothing and is safe to press at any time.
function FillFormats({ missing }: { missing: number | null }) {
  return (
    <section aria-labelledby="fill-formats" className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id="fill-formats" className="font-display text-h3 font-medium text-ink">
          Fill missing formats
        </h2>
        <p className="mt-hair max-w-prose text-body text-ink-soft">
          Works out the format of tournaments stored without one, from their rounds and team sizes.
          Nothing is fetched. A tournament it cannot decide is left as it is: re-scrape its first
          round and team tab from its page.
        </p>
      </div>
      {missing === null ? (
        <p className="text-body text-ink-soft">
          Couldn&rsquo;t count the tournaments with no format.
        </p>
      ) : (
        <FillFormatsButton missing={missing} />
      )}
    </section>
  );
}

// Tournaments that name no adjudication core (R10). Unlike the format fill this
// fetches: it reads each tournament's public home page, and its participants
// list if that was never read, so a press goes over only 20.
function FillCores({ missing }: { missing: number | null }) {
  return (
    <section aria-labelledby="fill-cores" className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id="fill-cores" className="font-display text-h3 font-medium text-ink">
          Fill missing adjudication cores
        </h2>
        <p className="mt-hair max-w-prose text-body text-ink-soft">
          Reads the Tournament Staff block on each tab&rsquo;s home page for tournaments that name
          no CA, CAP or core panel, and the participants list where it was never read. A tournament
          whose page names nobody is left as it is. Only the home page and the participants list are
          fetched, never the whole tab.
        </p>
      </div>
      {missing === null ? (
        <p className="text-body text-ink-soft">
          Couldn&rsquo;t count the tournaments with no adjudication core.
        </p>
      ) : (
        <FillCoresButton missing={missing} />
      )}
    </section>
  );
}

function ReingestAll({
  discovered,
  locked,
  reingestable,
}: {
  discovered: string;
  locked: string;
  reingestable: number;
}) {
  return (
    <section aria-labelledby="reingest" className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id="reingest" className="font-display text-h3 font-medium text-ink">
          Re-ingest all
        </h2>
        <p className="mt-hair max-w-prose text-body text-ink-soft">
          Queues every discovered URL for fresh ingestion, except those locked on user dashboards.
          Use after parser fixes, then <span className="font-medium">Ingest all</span> on the
          dashboard to process the queue.
        </p>
      </div>
      <dl className="flex flex-wrap gap-x-group gap-y-hair text-body text-ink-soft">
        <div className="flex gap-inline">
          <dt>Discovered URLs</dt>
          <dd className="num font-medium text-ink">{discovered}</dd>
        </div>
        <div className="flex gap-inline">
          <dt>Locked URLs</dt>
          <dd className="num font-medium text-ink">{locked}</dd>
        </div>
      </dl>
      <ReingestAllButton count={reingestable} />
    </section>
  );
}

// Folded: nothing here is wanted by accident, and each button keeps its own
// confirm.
function DangerZone() {
  return (
    <details className="rounded-lg border border-destructive/30 bg-destructive/3 p-panel">
      <summary className="cursor-pointer font-display text-h3 font-medium text-ink">
        Danger zone
      </summary>
      <div className="mt-stack space-y-group">
        <div className="space-y-stack">
          <div>
            <h3 className="font-display text-h4 font-medium text-ink">Clear data</h3>
            <p className="mt-hair max-w-prose text-body text-ink-soft">
              Deletes scraped tournament records and resets ingest state on every DiscoveredUrl.
              User identity claims (Person records) and discovered URLs are preserved, so the next
              scan re-uses everyone&rsquo;s existing claims.
            </p>
          </div>
          <ClearDataButton />
        </div>
        <div className="space-y-stack">
          <div>
            <h3 className="font-display text-h4 font-medium text-ink">Full wipe (destructive)</h3>
            <p className="mt-hair max-w-prose text-body text-ink-soft">
              All of the above, <em>plus</em> deletes every DiscoveredUrl, every Person row, and
              every PersonRejection across all users. User accounts and Gmail tokens are preserved
              so users can re-run the Gmail scan from zero. Use only to test the discovery and claim
              flow end-to-end.
            </p>
            <p className="mt-inline text-table text-destructive">
              Irreversible. Every user loses their claimed identities.
            </p>
          </div>
          <FullWipeButton />
        </div>
      </div>
    </details>
  );
}
