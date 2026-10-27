/**
 * What the user must type to confirm deleting their account.
 *
 * Normally it is their account email, which proves they know which account
 * they are about to destroy. An account with no email on file (possible with
 * Auth.js if the provider ever returns none) used to be stuck: the server
 * compared the typed text against '' and zod refused an empty string, so the
 * button could never succeed. Those accounts type a fixed phrase instead.
 *
 * Shared by the settings form and `/api/account/delete` so the two cannot
 * drift apart.
 */
export const DELETE_PHRASE = 'DELETE';

export function deleteConfirmationTarget(email: string | null | undefined): string {
  const trimmed = email?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : DELETE_PHRASE;
}

/** Case-insensitive, ignores surrounding spaces (phones add a trailing one). */
export function matchesDeleteConfirmation(
  typed: string,
  email: string | null | undefined,
): boolean {
  return typed.trim().toLowerCase() === deleteConfirmationTarget(email).toLowerCase();
}
