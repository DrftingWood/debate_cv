import { auth } from '@/lib/auth';

export async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) {
    throw Object.assign(new Error('unauthorized'), { status: 401 });
  }
  const allowed = (process.env.ADMIN_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length || !allowed.includes(session.user.email.toLowerCase())) {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  return session.user.email;
}
