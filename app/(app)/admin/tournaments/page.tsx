import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { adminTabHref } from '@/lib/admin/adminTabs';
import { hasPrivateKeyPath, publicFormOf } from '@/lib/admin/tabAddress';

export const dynamic = 'force-dynamic';

type Search = { q?: string | string[]; page?: string | string[] };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The old "Tournaments in the database" page. Its list is now the
 * Tournaments tab of /admin, so this address only forwards: bookmarks, the
 * lookup box's no-JavaScript fallback and old links keep working, with their
 * `q` and `page`. A private URL in `q` is turned into its public form first,
 * so the key is never written into the new address.
 */
export default async function AdminTournamentsRedirect({
  searchParams,
}: {
  searchParams?: Promise<Search>;
} = {}) {
  // Same guard as /admin: anyone else is sent home, not shown the route.
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }
  const params = (await searchParams) ?? {};
  const raw = one(params.q)?.trim() ?? '';
  const q = hasPrivateKeyPath(raw) ? (publicFormOf(raw) ?? '') : raw;
  const asked = Number.parseInt(one(params.page) ?? '1', 10);
  redirect(
    adminTabHref('tournaments', {
      ...(q ? { q } : {}),
      ...(Number.isFinite(asked) && asked > 1 ? { page: String(asked) } : {}),
    }),
  );
}
