import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { scrapedStamp } from '@/lib/utils/scrapedLabel';

/**
 * Whether a row's tournament is stored, as the server worked it out: its id,
 * its name (for the "Open" link's accessible name; omitted where the row
 * already names it) and when it was scraped, already in words so a client
 * table's first render matches the HTML. Null for "not stored", or for an
 * address that matched no single stored row (the cell's `check`).
 */
export type InDatabase = {
  id: string;
  name?: string;
  /** `iso` is null for the re-scrape marker, which has no real date. */
  scraped: { text: string; iso: string | null } | null;
} | null;

/** The cell's value from a stored row's id and scrape time, against the page's clock. */
export function inDatabase(
  stored: { id: string | bigint; name?: string; scrapedAt: Date | null } | null | undefined,
  now: Date,
): InDatabase {
  if (!stored) return null;
  return {
    id: stored.id.toString(),
    ...(stored.name ? { name: stored.name } : {}),
    scraped: stored.scrapedAt ? scrapedStamp(stored.scrapedAt, now) : null,
  };
}

/**
 * The "In database" cell (owner, 2026-10-31: "a view if that tournament is
 * present in the database or not"). The words carry the answer, not a
 * colour (UX-34): "Stored", with when it was scraped, or a quiet "Not
 * stored".
 *
 * "Open" links the tournament's admin page. A table whose row already
 * names the tournament with that same link passes `open={false}`: two links
 * to one place on one row are one tab stop too many, and a screen reader's
 * list of links would read each tournament twice.
 */
export function InDatabaseCell({
  stored,
  open = true,
  check = false,
}: {
  stored: InDatabase;
  open?: boolean;
  /**
   * The row's address matched two or more stored tournaments, or names no
   * slug (its Tab cell reads "? Check"): whether it is stored is unknown, so
   * this cell says the same rather than a false "Not stored".
   */
  check?: boolean;
}) {
  if (!stored && check) {
    return (
      <span className="whitespace-nowrap text-ink">
        <span aria-hidden>?</span> Check
      </span>
    );
  }
  if (!stored) return <Badge variant="quiet">Not stored</Badge>;
  return (
    <span className="block">
      <span className="text-ink">Stored</span>
      {open ? (
        <>
          <span className="text-ink-soft" aria-hidden>
            {' · '}
          </span>
          <Link
            href={`/admin/tournaments/${stored.id}`}
            // Names whose page it opens (UX-11), starting with the visible word.
            aria-label={`Open ${stored.name ?? 'the tournament'}`}
            className="text-ink underline underline-offset-4 hover:text-primary"
          >
            Open
          </Link>
        </>
      ) : null}
      {stored.scraped ? (
        stored.scraped.iso ? (
          <time
            dateTime={stored.scraped.iso}
            className="block font-mono text-caption tabular-nums text-ink-soft"
          >
            {stored.scraped.text}
          </time>
        ) : (
          <span className="block font-mono text-caption tabular-nums text-ink-soft">
            {stored.scraped.text}
          </span>
        )
      ) : null}
    </span>
  );
}
