import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { CheckActionsProvider } from '@/components/admin/CheckActions';
import { InboxTable, type InboxRow } from '@/components/admin/InboxTable';
import { LoadFailed } from '@/components/admin/LoadFailed';
import { adminHref, type SearchValues } from '@/lib/admin/adminHref';
import {
  CHECK_REASON,
  INBOX_KINDS,
  INBOX_PER_PAGE,
  kindsParam,
  parseKinds,
  type InboxItem,
  type InboxKind,
  type InboxList,
} from '@/lib/admin/inboxTypes';
import { readPage } from '@/lib/admin/cvReportTypes';
import { orNull } from '@/lib/admin/orNull';
import { readInbox } from '@/lib/admin/summary';
import { publicPieceUrl } from '@/lib/audit/types';
import { scrubComment } from '@/lib/admin/scrub';
import { relativeTime } from '@/lib/utils/relativeTime';
import type { TabState } from '@/lib/admin/tabStatus';

const HASH = 'inbox';

/** Plural chip words; the badge uses the singular (KIND_LABEL). */
const CHIP_LABEL: Record<InboxKind, string> = {
  check: 'Accuracy',
  report: 'CV reports',
  import: 'Imports',
  parser: 'Parser',
};

/** The status cell's state for an item: its stored tournament's, or the lack of one. */
function tabOf(item: InboxItem): TabState {
  const t = item.tournament;
  if (!t) return { state: 'not_applicable', tournamentId: null, errors: [] };
  return {
    state: t.status,
    tournamentId: t.id,
    errors: t.status === 'check' ? [CHECK_REASON] : [],
  };
}

/** What a row with no tournament is called: its sentence, short enough for a button's name. */
const NAME_CHARS = 60;
const nameOf = (item: InboxItem): string =>
  item.tournament?.name ??
  (item.summary.length > NAME_CHARS
    ? `${item.summary.slice(0, NAME_CHARS - 1).trimEnd()}…`
    : item.summary);

/**
 * Server side of the Inbox: each item as the row the client table shows as
 * it is. Everything that crosses to the client is made here, at the last
 * step: the tab address goes through publicPieceUrl (a stored URL can be a
 * `/privateurls/<key>/` address, which signs in as the participant), the age
 * is put into words against the page's clock, and a fix link that names a
 * private path is dropped for the admin page.
 */
export function toInboxRows(items: readonly InboxItem[], now: Date): InboxRow[] {
  return items.map((item) => {
    const fix: InboxRow['fix'] =
      item.fix.type === 'open' && /privateurls/i.test(item.fix.href)
        ? { type: 'open', href: '/admin' }
        : item.fix;
    return {
      key: item.key,
      kind: item.kind,
      name: scrubComment(nameOf(item)),
      tournamentId: item.tournament?.id ?? null,
      tabUrl: item.tournament?.tabUrl ? publicPieceUrl(item.tournament.tabUrl) : null,
      tab: tabOf(item),
      summary: scrubComment(item.summary),
      more: item.more,
      users: item.usersAffected,
      severity: item.severity,
      age: { text: relativeTime(item.age, now), iso: item.age.toISOString() },
      fix:
        fix.type === 'rescrape' || fix.type === 'infer_format'
          ? {
              ...fix,
              pieces: fix.pieces.map((p) => ({ ...p, url: p.url ? publicPieceUrl(p.url) : null })),
            }
          : fix,
      markItems: item.markItems,
      flagItems: item.flagItems,
      reviewPriority: item.reviewFlag?.priority ?? null,
      changed: item.changedSinceChecked,
    };
  });
}

/**
 * The Inbox panel: only what needs the owner, with the three things to do
 * about each (Fix, Mark checked, Review later). Kind chips (`?kinds=`) and
 * 20 a page (`?inboxPage=`) are plain links that keep the page's other
 * parameters, so Back steps through them. The read is the cached readInbox,
 * the one the summary line shares on this tab.
 */
export async function InboxTab({ search, now }: { search: SearchValues; now: Date }) {
  const kinds = parseKinds(search.kinds);
  const kindsKey = kindsParam(kinds);
  const list = await readInbox(readPage(search.inboxPage), kindsKey).catch(orNull('inbox'));
  return (
    <section aria-labelledby={HASH} className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id={HASH} className="font-display text-h3 font-medium text-ink">
          Inbox
        </h2>
        <p className="mt-hair text-body text-ink-soft">
          Only what needs you. Fix it, mark it checked when the data is right, or set it aside to
          review later.
        </p>
      </div>
      {!list ? (
        <LoadFailed what="the inbox" />
      ) : (
        <InboxBody list={list} kinds={kinds} search={search} now={now} />
      )}
    </section>
  );
}

function InboxBody({
  list,
  kinds,
  search,
  now,
}: {
  list: InboxList;
  kinds: InboxKind[];
  search: SearchValues;
  now: Date;
}) {
  const all = INBOX_KINDS.reduce((sum, k) => sum + list.counts[k], 0);
  const pageHref = (n: number) => adminHref(search, { inboxPage: n > 1 ? String(n) : null }, HASH);
  return (
    <>
      <KindChips counts={list.counts} all={all} kinds={kinds} search={search} />
      {list.truncated ? (
        <p role="status" className="text-caption text-ink-soft">
          Older failures weren't scanned: only the newest failed imports are read, so some older
          ones may be missing from the count.
        </p>
      ) : null}
      {list.total === 0 ? (
        all === 0 ? (
          <EmptyState
            title="Nothing needs you. Every flag is fixed or checked."
            description="New findings appear here after a scrape, an audit or a user report."
            headingLevel={3}
          />
        ) : (
          <EmptyState
            title="Nothing of this kind needs you"
            description="Choose All above to see the rest of the Inbox."
            headingLevel={3}
          />
        )
      ) : (
        <>
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            perPage={INBOX_PER_PAGE}
            label="Inbox pages"
            href={pageHref}
            always
          />
          {/* The provider hands every Fix, Mark checked and Review later in the
              table one flight, so a re-scrape and a mark never run together. */}
          <CheckActionsProvider>
            <InboxTable rows={toInboxRows(list.rows, now)} />
          </CheckActionsProvider>
        </>
      )}
    </>
  );
}

/**
 * "All 10", "Accuracy 4", ...: links, each kind toggling in or out of
 * `?kinds=`, the ones showing marked (UX-12). The counts are over the whole
 * Inbox, whatever the filter, so a chip says what choosing it would add.
 */
function KindChips({
  counts,
  all,
  kinds,
  search,
}: {
  counts: Record<InboxKind, number>;
  all: number;
  kinds: InboxKind[];
  search: SearchValues;
}) {
  const href = (next: InboxKind[]) =>
    adminHref(search, { kinds: next.length ? kindsParam(next) : null, inboxPage: null }, HASH);
  const chip = (c: { key: string; label: string; count: number; to: string; on: boolean }) => (
    <li key={c.key}>
      <Link
        href={c.to}
        aria-current={c.on ? 'true' : undefined}
        className={buttonClasses({ variant: c.on ? 'primary' : 'outline', size: 'sm' })}
      >
        {c.label} <span className="font-mono tabular-nums">{c.count}</span>
      </Link>
    </li>
  );
  return (
    <nav aria-label="Show Inbox items by kind">
      <ul className="flex flex-wrap gap-inline">
        {chip({ key: 'all', label: 'All', count: all, to: href([]), on: kinds.length === 0 })}
        {INBOX_KINDS.map((k) => {
          const on = kinds.includes(k);
          // Toggling keeps the kinds already chosen, in the inbox's order.
          const next = INBOX_KINDS.filter((x) => (x === k ? !on : kinds.includes(x)));
          return chip({ key: k, label: CHIP_LABEL[k], count: counts[k], to: href(next), on });
        })}
      </ul>
    </nav>
  );
}
