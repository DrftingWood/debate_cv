import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SignInButton } from '@/components/SignInOut';

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Your debate CV, auto-built from your inbox.</h1>
      <p className="mt-4 text-gray-700">
        Sign in with Google. We scan your Gmail for Tabbycat private URLs
        (<code>calicotab.com</code> / <code>herokuapp.com</code>), fetch each tournament's
        team, speaker, and break tabs, and compile them into a personal history page.
      </p>
      <ul className="mt-6 text-sm text-gray-600 list-disc pl-5 space-y-1">
        <li>Read-only Gmail scope; no emails stored.</li>
        <li>Only your own private URLs are ingested.</li>
        <li>You can disconnect and delete your data at any time.</li>
      </ul>
      <div className="mt-8">
        <SignInButton />
      </div>
      <p className="mt-3 text-xs text-gray-500">
        By signing in you agree to our <a className="underline" href="/terms">Terms</a> and <a className="underline" href="/privacy">Privacy Policy</a>.
      </p>
    </div>
  );
}
