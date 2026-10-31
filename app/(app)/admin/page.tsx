import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { SummaryLine } from '@/components/admin/SummaryLine';
import { ImportsTab } from '@/components/admin/tabs/ImportsTab';
import { InboxTab } from '@/components/admin/tabs/InboxTab';
import { ParserTab } from '@/components/admin/tabs/ParserTab';
import { ReportsTab } from '@/components/admin/tabs/ReportsTab';
import { ReviewSetTab } from '@/components/admin/tabs/ReviewSetTab';
import { ToolsTab } from '@/components/admin/tabs/ToolsTab';
import { TournamentsTab } from '@/components/admin/tabs/TournamentsTab';
import { readAdminTab, type AdminTab } from '@/lib/admin/adminTabs';
import { getSummary } from '@/lib/admin/summary';
import type { SearchValues } from '@/lib/admin/adminHref';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The operator page: a summary line, then one panel at a time (`?tab=`).
 * Only the active tab's data is read; each panel is its own async server
 * component under components/admin/tabs, each guarding its own reads so a
 * failure says so inside that panel and leaves the strip and the other tabs
 * working. Panels page through the address with their own parameters
 * (`?reportsPage=`, `?warningsPage=`, `?q=`, `?page=`), kept apart by
 * adminHref.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<SearchValues>;
} = {}) {
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }
  const search = (await searchParams) ?? {};
  const active = readAdminTab(search.tab);
  // One clock for every relative time on the page, so two cells written a
  // millisecond apart cannot disagree about "just now".
  const now = new Date();

  const [summary, panel] = await Promise.all([getSummary(), renderPanel(active, search, now)]);

  return (
    <div className="space-y-group">
      <header className="space-y-tight">
        <div className="kicker">ADMIN · INTERNAL</div>
        <h1 className="font-display text-h2 font-medium tracking-tight text-ink">
          Admin: operator tools
        </h1>
        <SummaryLine summary={summary} />
        <hr className="hairline" />
      </header>

      <AdminTabs active={active} panels={{ [active]: panel }} />
    </div>
  );
}

/** The one panel the request asked for, read and rendered. */
async function renderPanel(tab: AdminTab, search: SearchValues, now: Date) {
  switch (tab) {
    case 'inbox':
      return InboxTab();
    case 'tournaments':
      return TournamentsTab({ search, now });
    case 'imports':
      return ImportsTab({ now });
    case 'reports':
      return ReportsTab({ search, now });
    case 'parser':
      return ParserTab({ search, now });
    case 'review':
      return ReviewSetTab({ now });
    case 'tools':
      return ToolsTab();
  }
}
