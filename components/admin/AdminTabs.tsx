'use client';

import { useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs } from '@/components/ui/Tabs';
import { ADMIN_TABS, switchTabHref, type AdminTab } from '@/lib/admin/adminTabs';

/**
 * The /admin tab strip. It is the shared APG `Tabs` with one difference: the
 * server reads only the active tab's data (the other panels arrive as null),
 * so choosing a tab is a navigation that fetches that panel, not a local
 * switch. `router.replace` keeps Back leaving /admin instead of stepping
 * through tabs, as the other tab sets do. The tab-scoped parameters (a page
 * number, a search) do not follow to another tab (lib/admin/adminTabs.ts).
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
  return (
    <div aria-busy={pending}>
      <Tabs
        label="Admin sections"
        param="tab"
        initialValue={active}
        items={ADMIN_TABS.map((t) => ({
          value: t.value,
          label: t.label,
          panel: panels[t.value] ?? null,
        }))}
        onSelect={(next) =>
          startTransition(() =>
            router.replace(switchTabHref(window.location.search, next as AdminTab)),
          )
        }
      />
    </div>
  );
}
