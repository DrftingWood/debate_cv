import { RemoveTabMoveButton } from '@/components/admin/RemoveTabMoveButton';
import { TabMoveForm } from '@/components/admin/TabMoveForm';
import { siteLabel, type TabMove } from '@/lib/calicotab/tabMoves';
import { relativeTime } from '@/lib/utils/relativeTime';

/**
 * The Tools tab's moved tabs (owner, 2026-10-31: "allow me to add an
 * alternate url feature"): the form, and each recorded move with when and by
 * whom. `rows` null means the list could not be read.
 */
export function TabMoves({ rows, now }: { rows: TabMove[] | null; now: Date }) {
  return (
    <section aria-labelledby="tab-moves" className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id="tab-moves" className="font-display text-h3 font-medium text-ink">
          Moved tabs
        </h2>
        <p className="mt-hair max-w-prose text-body text-ink-soft">
          When a tab stops working at its old address but lives on at a new one, record the move:
          every import and pre-scrape of the old address reads the new one, and the old
          address&rsquo;s failed imports are queued again. Paste any URL on each tab; only the site
          and the tournament&rsquo;s part of the path are kept.
        </p>
      </div>
      <TabMoveForm />
      {rows === null ? (
        <p className="text-body text-ink-soft">Couldn&rsquo;t read the moved tabs.</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-ink-soft">No moves recorded.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((m) => {
            const from = siteLabel(m.fromHost, m.fromSlug);
            const to = siteLabel(m.toHost, m.toSlug);
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-stack px-panel py-stack"
              >
                <div className="min-w-0 space-y-hair">
                  <p className="text-body text-ink [overflow-wrap:anywhere]">
                    {from} <span aria-label="moved to">→</span> {to}
                  </p>
                  <p className="text-caption text-ink-soft">
                    Added {relativeTime(m.addedAt, now)} by {m.addedBy}
                  </p>
                </div>
                <RemoveTabMoveButton id={m.id} label={`${from} → ${to}`} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
