import { auth } from '@/lib/auth';

/**
 * Pure allowlist check, shared by requireAdmin and UI affordances (the
 * header's conditional Admin link). Security never rests on this alone —
 * every admin route still calls requireAdmin server-side; this only
 * decides whether to SHOW admin entry points.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.ADMIN_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(email.toLowerCase());
}

export async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) {
    throw Object.assign(new Error('unauthorized'), { status: 401 });
  }
  if (!isAdminEmail(session.user.email)) {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  return session.user.email;
}
