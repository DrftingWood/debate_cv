import { CheckCircle, Prohibit, WarningCircle } from '@/components/ui/icons';
import type { StaffNameRow, StaffMatchState } from '@/lib/admin/tournamentStaff';
import { cn } from '@/lib/utils/cn';

// Symbol plus word, as on every status in the admin: the icon is decoration,
// the words carry the meaning.
const MARK: Record<
  StaffMatchState,
  { Icon: typeof CheckCircle; tone: string; words: (person: string | null) => string }
> = {
  linked: { Icon: CheckCircle, tone: 'text-success', words: (p) => `Linked to ${p ?? ''}` },
  possible: {
    Icon: WarningCircle,
    tone: 'text-warning',
    words: (p) => `Possible match: ${p ?? ''}`,
  },
  none: { Icon: Prohibit, tone: 'text-ink-soft', words: () => 'Not linked' },
};

/**
 * The adjudication core named on the tab's home page (admin only), each name
 * marked by how it was matched. Only "Linked" shows on a CV; a "Possible
 * match" is a guess and does not. Server-rendered; no links, so no URLs.
 */
export function StaffNames({ rows }: { rows: readonly StaffNameRow[] }) {
  return (
    <section aria-labelledby="staff-names" className="space-y-tight">
      <div>
        <h2 id="staff-names" className="font-display text-h3 font-medium text-ink">
          Adjudication core on the home page
        </h2>
        <p className="mt-hair max-w-prose text-caption text-ink-soft">
          Names under the Tournament Staff block. Only an exact full-name match to someone in the
          participant list puts a core role on their CV.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-body text-ink-soft">
          No names stored. Either the home page names no core, or it has not been read yet: use
          &ldquo;Fill missing adjudication cores&rdquo; on the Tools tab, or re-scrape its Home page
          piece below.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((r) => {
            const { Icon, tone, words } = MARK[r.state];
            return (
              <li
                key={r.name}
                className="flex flex-col gap-hair px-tight py-inline sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-body text-ink">{r.name}</span>
                <span className={cn('inline-flex items-center gap-hair text-caption', tone)}>
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="text-ink-soft">{words(r.person)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
