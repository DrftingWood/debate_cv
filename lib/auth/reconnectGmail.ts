'use server';

import { signIn } from '@/lib/auth';

/**
 * Server action that triggers Google OAuth with `prompt: 'consent'`.
 * Forces Google to re-show the consent screen even if the user has
 * an active Google session, which guarantees a fresh refresh token
 * gets persisted via the NextAuth callback in lib/auth.ts.
 *
 * Used by components/ReconnectGmailButton.tsx to recover from a
 * deleted/expired GmailToken row without requiring the user to first
 * sign out and revoke access in their Google account dashboard.
 */
export async function reconnectGmail(redirectTo: string): Promise<void> {
  await signIn('google', {
    redirectTo,
    redirect: true,
    authorizationParams: {
      prompt: 'consent',
      // Force access_type=offline too so Google definitely issues a
      // refresh_token (not just an access_token). NextAuth's default
      // for the Google provider is already 'offline', but pinning here
      // makes the contract explicit and survives any future provider
      // default change.
      access_type: 'offline',
    },
  });
}
