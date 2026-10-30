import { prisma } from '@/lib/db';
import { parseTabAddress } from '@/lib/admin/tabAddress';
import { storedMatchesByUrl } from '@/lib/admin/tournamentLookup';
import {
  ambiguousTab,
  loadTabStates,
  tabState,
  UNMATCHABLE_TAB,
  type TabState,
} from '@/lib/admin/tabStatus';
import { scrubComment } from '@/lib/admin/scrub';
import { clampPage } from '@/lib/admin/cvReportTypes';

/**
 * Read model for the "Recent parser warnings" ledger on /admin (Task 5d):
 * the parser runs' warnings grouped by `[parser] headline`, busiest first,
 * twenty groups a page, each with the tournaments whose pages raised it.
 *
 * The read is bounded twice: runs from the last 30 days, and of those the
 * newest 2,000 with any warning. Grouping happens in memory over that set,
 * and the page's caption says so ("from the latest 2,000 parser runs"), so a
 * count is never read as all-time. Tournaments are looked up for the page's
 * twenty groups only, in one batched host-plus-slug query
 * (storedMatchesByUrl) and one Tab-state query.
 *
 * A run's SourceDocument URL is the page as fetched, which is often a
 * user's private URL. It is used here only to find the tournament's site
 * address and never leaves this module: a row carries the public tab
 * address instead. Warning text can quote that URL too, so the headline and
 * the sample are scrubbed (scrubComment) before they are grouped or shown.
 */

export const WARNINGS_PER_PAGE = 20;
export const WARNING_RUN_CAP = 2000;
export const WARNING_WINDOW_DAYS = 30;
/** Tournaments listed per group before "+n more". */
export const TOURNAMENTS_SHOWN = 5;

const HEADLINE_CHARS = 200;
const SAMPLE_CHARS = 200;
const DAY_MS = 86_400_000;

export type WarningGroup = {
  /** `<parserName>|<headline>`: the review set's sourceId for the group. */
  key: string;
  parserName: string;
  headline: string;
  /** Warnings with this headline across the runs read (one run can raise several). */
  count: number;
  latestAt: Date;
  /** The newest full warning, scrubbed. */
  sample: string;
  /** The runs' page URLs, newest first, distinct. Private: never leave this module. */
  urls: string[];
};

export type WarningTournament = {
  /** The stored tournament's id; null when not stored or not told apart. */
  id: string | null;
  /** Its stored name, or its site address ("host/slug") when there is none to show. */
  name: string;
  /** The public tab address, or null when the address names no tournament. */
  tabUrl: string | null;
  tab: TabState;
};

export type ParserWarningView = Omit<WarningGroup, 'urls' | 'sample'> & {
  sample: string;
  tournaments: WarningTournament[];
  /** Tournaments past the first five. */
  moreTournaments: number;
};

export type ParserWarningList = {
  rows: ParserWarningView[];
  total: number;
  page: number;
  pages: number;
};

/**
 * The diagnostic format puts ` — ` between a headline and its details (often
 * a URL or a count), so equivalent warnings group on the text before it.
 */
export function warningHeadline(w: string): string {
  const sep = w.indexOf(' — ');
  return sep > 0 ? w.slice(0, sep) : w;
}

type RunLike = {
  parserName: string;
  warnings: string[];
  createdAt: Date;
  sourceDocument: { url: string };
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Groups runs (newest first) by `[parser] headline`; busiest first, then most recent. */
export function groupWarnings(runs: readonly RunLike[]): WarningGroup[] {
  const groups = new Map<string, WarningGroup & { seen: Set<string> }>();
  for (const run of runs) {
    for (const w of run.warnings) {
      const headline = clip(scrubComment(warningHeadline(w)), HEADLINE_CHARS);
      const key = `${run.parserName}|${headline}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          parserName: run.parserName,
          headline,
          count: 0,
          latestAt: run.createdAt,
          sample: clip(scrubComment(w), SAMPLE_CHARS),
          urls: [],
          seen: new Set(),
        };
        groups.set(key, g);
      }
      g.count += 1;
      if (run.createdAt > g.latestAt) g.latestAt = run.createdAt;
      if (!g.seen.has(run.sourceDocument.url)) {
        g.seen.add(run.sourceDocument.url);
        g.urls.push(run.sourceDocument.url);
      }
    }
  }
  return [...groups.values()]
    .map(({ seen: _seen, ...g }) => g)
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.latestAt.getTime() - a.latestAt.getTime() ||
        a.key.localeCompare(b.key),
    );
}

/** Every group over the bounded read: the newest 2,000 runs with warnings in 30 days. */
export async function loadWarningGroups(now: Date): Promise<WarningGroup[]> {
  const runs = await prisma.parserRun.findMany({
    where: {
      warnings: { isEmpty: false },
      createdAt: { gte: new Date(now.getTime() - WARNING_WINDOW_DAYS * DAY_MS) },
    },
    orderBy: { createdAt: 'desc' },
    take: WARNING_RUN_CAP,
    select: {
      parserName: true,
      warnings: true,
      createdAt: true,
      sourceDocument: { select: { url: true } },
    },
  });
  return groupWarnings(runs);
}

export async function listParserWarnings({
  page,
  now,
}: {
  page: number;
  now: Date;
}): Promise<ParserWarningList> {
  const groups = await loadWarningGroups(now);
  const total = groups.length;
  const pages = Math.max(1, Math.ceil(total / WARNINGS_PER_PAGE));
  const shown = clampPage(page, pages);
  const slice = groups.slice((shown - 1) * WARNINGS_PER_PAGE, shown * WARNINGS_PER_PAGE);
  const lists = await tournamentsOf(slice);
  const rows = slice.map(({ urls: _urls, ...g }, i): ParserWarningView => {
    const all = lists[i] ?? [];
    return {
      ...g,
      tournaments: all.slice(0, TOURNAMENTS_SHOWN),
      moreTournaments: Math.max(0, all.length - TOURNAMENTS_SHOWN),
    };
  });
  return { rows, total, page: shown, pages };
}

/**
 * Each group's distinct tournaments, newest run first, one entry per site
 * address. Stored → its name, Tab state and public tab; two stored rows on
 * one address, or an address with no slug → "? Check"; otherwise not
 * loaded. URLs that are not tab sites at all are skipped.
 */
export async function tournamentsOf(
  groups: ReadonlyArray<Pick<WarningGroup, 'urls'>>,
): Promise<WarningTournament[][]> {
  const urls = [...new Set(groups.flatMap((g) => g.urls))];
  if (urls.length === 0) return groups.map(() => []);
  const { stored, ambiguous } = await storedMatchesByUrl(urls);
  const tabs = await loadTabStates([...stored.values()].map((r) => r.id));
  return groups.map((g) => {
    const byAddress = new Map<string, WarningTournament>();
    for (const url of g.urls) {
      const a = parseTabAddress(url);
      if (!a) continue;
      const address = a.slug ? `${a.host}/${a.slug}`.toLowerCase() : a.host.toLowerCase();
      if (byAddress.has(address)) continue;
      const ref = stored.get(url);
      byAddress.set(address, {
        id: ref?.id ?? null,
        name: ref?.name ?? (a.slug ? `${a.host}/${a.slug}` : a.host),
        tabUrl: a.publicUrl,
        tab: tabOf({ id: ref?.id ?? null, count: ambiguous.get(url), slug: a.slug }, tabs),
      });
    }
    return [...byAddress.values()];
  });
}

/** A stored tournament's state; else "? Check" when it cannot be told; else not loaded. */
function tabOf(
  m: { id: string | null; count: number | undefined; slug: string | null },
  tabs: ReadonlyMap<string, TabState>,
): TabState {
  if (m.id) return tabs.get(m.id) ?? tabState(m.id, []);
  if (m.count) return ambiguousTab(m.count);
  return m.slug ? tabState(null, []) : UNMATCHABLE_TAB;
}

/**
 * What the review set's export says about flagged warnings: the group's
 * parser, headline, count and a few tournaments by name, read again from
 * the same bounded window. A warning no longer in it keeps its parser and
 * headline (from its sourceId) with a null count.
 */
export async function warningDetails(
  keys: string[],
  now: Date,
): Promise<
  Map<
    string,
    {
      parser: string;
      headline: string;
      count: number | null;
      sampleTournaments: Array<{ id: string | null; name: string; tabUrl: string | null }>;
    }
  >
> {
  if (keys.length === 0) return new Map();
  const groups = await loadWarningGroups(now);
  const wanted = new Set(keys);
  const found = groups.filter((g) => wanted.has(g.key));
  const lists = await tournamentsOf(found);
  const byKey = new Map(found.map((g, i) => [g.key, { g, list: lists[i] ?? [] }] as const));
  return new Map(
    keys.map((key) => {
      const hit = byKey.get(key);
      const sep = key.indexOf('|');
      return [
        key,
        {
          parser: hit?.g.parserName ?? (sep > 0 ? key.slice(0, sep) : key),
          headline: hit?.g.headline ?? (sep > 0 ? key.slice(sep + 1) : ''),
          count: hit?.g.count ?? null,
          sampleTournaments: (hit?.list ?? [])
            .slice(0, TOURNAMENTS_SHOWN)
            .map(({ id, name, tabUrl }) => ({ id, name, tabUrl })),
        },
      ];
    }),
  );
}
