import { isAdminEmail } from '@/lib/admin';

/**
 * Who sees the Found tab (phase 1 of the discovery design).
 *
 * The owner's rule: behind a flag, the owner first. The owner is reached
 * through the existing admin allowlist (`ADMIN_EMAIL`), not a hard-coded
 * address, so the flag follows whoever administers the deployment. Two env
 * variables widen or close it without a deploy of new code:
 *
 *   DISCOVERY_LIST         'admins' (default): admins only.
 *                          'off': nobody, admins included (kill switch).
 *   DISCOVERY_LIST_EMAILS  comma-separated extra addresses (opted-in testers).
 *
 * Read on every request, like `isAdminEmail`, so a Vercel env change takes
 * effect on the next cold start. Every gate (page, nav item, API) calls this
 * one function, so they cannot disagree.
 */
export function isDiscoveryEnabled(email: string | null | undefined): boolean {
  if (!email) return false;
  const mode = (process.env.DISCOVERY_LIST ?? 'admins').trim().toLowerCase();
  if (mode === 'off') return false;
  if (isAdminEmail(email)) return true;
  const extra = (process.env.DISCOVERY_LIST_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(email.toLowerCase());
}
