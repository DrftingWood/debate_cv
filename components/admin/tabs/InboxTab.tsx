import { EmptyState } from '@/components/ui/EmptyState';
import { LoadFailed } from '@/components/admin/LoadFailed';
import { readInbox } from '@/lib/admin/summary';
import { orNull } from '@/lib/admin/orNull';

/**
 * The Inbox panel's place in the shell. Task R4 replaces the body with the
 * real list (rows, actions, filters); until then it names how many items wait
 * and says where the working views are, so the default tab is never blank.
 */
export async function InboxTab() {
  const inbox = await readInbox(1).catch(orNull('inbox'));
  return (
    <section aria-labelledby="inbox" className="space-y-stack rounded-lg border p-panel">
      <h2 id="inbox" className="font-display text-h3 font-medium text-ink">
        Inbox
      </h2>
      {!inbox ? (
        <LoadFailed what="the inbox" />
      ) : inbox.total === 0 ? (
        <EmptyState
          title="Nothing needs you"
          description="No unchecked accuracy findings, open reports, unstored failed imports or parser problems."
          headingLevel={3}
        />
      ) : (
        <p className="max-w-prose text-body text-ink-soft">
          {inbox.total.toLocaleString('en-GB')} {inbox.total === 1 ? 'item needs' : 'items need'}{' '}
          you. The list arrives with the next update; the Tournaments, Imports, Reports and Parser
          tabs hold the same findings meanwhile.
        </p>
      )}
    </section>
  );
}
