import { AllowAgainButton } from '@/components/admin/AllowAgainButton';
import { TabLink } from '@/components/admin/TabLink';
import type { DeletedRow } from '@/lib/admin/deletedTournaments';
import { relativeTime } from '@/lib/utils/relativeTime';

/**
 * The Tools tab's list of deleted tournaments (owner, 2026-10-31: "note
 * which tournaments i have deleted and avoid ingesting them"): each tab
 * address an admin deleted, when and by whom, and "Allow ingesting again".
 * `rows` null means the list could not be read. The tab link is the public
 * home page only; the table never holds a private URL.
 */
export function DeletedTournaments({ rows, now }: { rows: DeletedRow[] | null; now: Date }) {
  return (
    <section
      aria-labelledby="deleted-tournaments"
      className="space-y-stack rounded-lg border p-panel"
    >
      <div>
        <h2 id="deleted-tournaments" className="font-display text-h3 font-medium text-ink">
          Deleted tournaments
        </h2>
        <p className="mt-hair max-w-prose text-body text-ink-soft">
          Tabs deleted from a tournament&rsquo;s page. Imports and pre-scrapes of these addresses
          are refused before anything is fetched. Allowing one again restores nothing: its next
          import stores it afresh.
        </p>
      </div>
      {rows === null ? (
        <p className="text-body text-ink-soft">Couldn&rsquo;t read the deleted tournaments.</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-ink-soft">None deleted.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-stack px-panel py-stack"
            >
              <div className="min-w-0 space-y-hair">
                <p className="text-body font-medium text-ink">{r.name}</p>
                <p className="text-caption text-ink-soft">
                  <TabLink url={r.tabUrl} text="Tab" of={r.name} /> · Deleted{' '}
                  {relativeTime(r.deletedAt, now)} by {r.deletedBy}
                </p>
              </div>
              <AllowAgainButton id={r.id} name={r.name} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
