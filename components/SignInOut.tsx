import { LogIn, LogOut } from 'lucide-react';
import { auth, signIn, signOut } from '@/lib/auth';
import { Button } from '@/components/ui/Button';

export async function SignInButton() {
  return (
    <form
      action={async () => {
        'use server';
        await signIn('google', { redirectTo: '/dashboard' });
      }}
    >
      <Button type="submit" variant="primary" leftIcon={<LogIn className="h-4 w-4" aria-hidden />}>
        Sign in with Google
      </Button>
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
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        leftIcon={<LogOut className="h-3.5 w-3.5" aria-hidden />}
      >
        Sign out
      </Button>
    </form>
  );
}

export async function SessionBadge() {
  const session = await auth();
  if (!session?.user) return null;
  return (
    <span className="text-sm text-muted-foreground">
      Signed in as <span className="font-medium text-foreground">{session.user.email ?? session.user.name}</span>
    </span>
  );
}
