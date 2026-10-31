import { resolveTab } from '@/lib/utils/tabParam';

/**
 * The /admin tabs, in the order the owner reads them (spec 2026-10-31): what
 * needs doing first, the ledgers next, the rarely-used tools last. The
 * values are the `?tab=` words; the labels are the shell's vocabulary and are
 * not reworded.
 */
export const ADMIN_TABS = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'tournaments', label: 'Tournaments' },
  { value: 'imports', label: 'Imports' },
  { value: 'reports', label: 'Reports' },
  { value: 'parser', label: 'Parser' },
  { value: 'review', label: 'Review set' },
  { value: 'tools', label: 'Tools' },
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number]['value'];

export const DEFAULT_ADMIN_TAB: AdminTab = 'inbox';

const VALUES = ADMIN_TABS.map((t) => t.value);

/** The tab a request selects; anything unknown opens the Inbox. */
export function readAdminTab(value: string | string[] | undefined): AdminTab {
  return resolveTab(value, VALUES, DEFAULT_ADMIN_TAB);
}

/**
 * Query parameters that belong to one tab's list (its search, its page, its
 * filter). Moving to another tab drops them: page 3 of the tournaments is not
 * a position in the CV reports. Anything else on the address is kept.
 */
export const TAB_SCOPED_PARAMS = [
  'q',
  'page',
  'reportsPage',
  'reportsStatus',
  'warningsPage',
] as const;

/** The /admin address for a tab: the plain address for the Inbox, `?tab=` otherwise. */
export function adminTabHref(tab: AdminTab, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams();
  if (tab !== DEFAULT_ADMIN_TAB) sp.set('tab', tab);
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `/admin?${qs}` : '/admin';
}

/** The address after switching tab on `search`, keeping what is not tab-scoped. */
export function switchTabHref(search: string, tab: AdminTab): string {
  const params = new URLSearchParams(search);
  for (const p of TAB_SCOPED_PARAMS) params.delete(p);
  if (tab === DEFAULT_ADMIN_TAB) params.delete('tab');
  else params.set('tab', tab);
  const qs = params.toString();
  return qs ? `/admin?${qs}` : '/admin';
}
