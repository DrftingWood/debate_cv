import { auth, signIn, signOut } from '@/lib/auth';

export async function SignInButton() {
  return (
    <form
      action={async () => {
        'use server';
        await signIn('google', { redirectTo: '/dashboard' });
      }}
    >
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-white font-medium hover:opacity-90"
      >
        Sign in with Google
      </button>
    </form>
  );
}

export async function SignOutButton() {
  return (
    <form
      action={async () => {
        'use server';
        await signOut({ redirectTo: '/' });
      }}
    >
      <button
        type="submit"
        className="text-sm text-gray-600 underline hover:text-ink"
      >
        Sign out
      </button>
    </form>
  );
}

export async function SessionBadge() {
  const session = await auth();
  if (!session?.user) return null;
  return (
    <span className="text-sm text-gray-600">
      Signed in as {session.user.email ?? session.user.name}
    </span>
  );
}
