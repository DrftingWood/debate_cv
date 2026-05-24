'use server';

import { signOut } from '@/lib/auth';

/**
 * Server action wrapping NextAuth's signOut for use inside client
 * components (the header UserMenu in particular). Mirrors the
 * reconnectGmail pattern so a client popover can mount a `<form
 * action={signOutAction}>` without pulling NextAuth's full server
 * surface into the client bundle.
 *
 * Always redirects to `/` — the public landing page — so the user
 * lands somewhere coherent regardless of which app surface they
 * signed out from.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/' });
}
