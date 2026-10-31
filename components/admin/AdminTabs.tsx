'use client';

import { useTransition, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui/Tabs';
import { ADMIN_TABS, switchTabHref, type AdminTab } from '@/lib/admin/adminTabs';

/**
 * The /admin tab strip. It is the shared APG `Tabs` with one difference: the
 * server reads only the active tab's data (the other panels arrive as null),
 * so choosing a tab is a navigation that fetches that panel, not a local
 * switch. `router.replace` keeps Back leaving /admin instead of stepping
 * through tabs, as the other tab sets do. The tab-scoped parameters (a page
 * number, a search) do not follow to another tab (lib/admin/adminTabs.ts).
 *
 * Each tab is a real link to that address (without JavaScript the strip
 * still reaches every tab), and while a switch is in flight the old panel
 * stays and the strip is marked busy.
 */
export function AdminTabs({
  active,
  panels,
}: {
  active: AdminTab;
  /** The active tab's panel; the rest are null and not read. */
  panels: Partial<Record<AdminTab, ReactNode>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const search = useSearchParams().toString();
  return (
    <div>
      <Tabs
        label="Admin sections"
        param="tab"
        initialValue={active}
        items={ADMIN_TABS.map((t) => ({
          value: t.value,
          label: t.label,
          href: switchTabHref(search, t.value),
          panel: panels[t.value] ?? null,
        }))}
        pending={pending}
        onSelect={(next) =>
          startTransition(() => router.replace(switchTabHref(search, next as AdminTab)))
        }
      />
    </div>
  );
}
