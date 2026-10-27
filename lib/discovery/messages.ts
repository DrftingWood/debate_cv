/**
 * Words for the Found tab's decision results. Codes from the decision route
 * never reach the screen (UX-23); each maps to a sentence and, where there is
 * one, a next step. Pure, so the mapping is tested.
 */

export type DecisionKind = 'confirm' | 'reject' | 'restore';

/** The inline note left in a row after a decision, also announced politely. */
export function decisionNote(kind: DecisionKind, tournament: string): string {
  if (kind === 'confirm')
    return `Marked ${tournament} as you. Nothing is added to your record yet.`;
  if (kind === 'reject') return `Hidden ${tournament}. It will not be suggested again.`;
  return `Undone for ${tournament}.`;
}

/** A failed decision, in plain words. `reason` is the server's own sentence, if any. */
export function decisionError(status: number, code: string | undefined, reason?: string): string {
  switch (code) {
    case 'rate_limited':
      return `You have reached today's limit of 50 decisions. ${reason ?? 'Try again tomorrow.'}`;
    case 'not_a_candidate':
      return 'That tournament is no longer in your list. Reload the page to see the current list.';
    case 'blocked':
      return 'That row clashes with one you marked as you, so it cannot be you. You can still hide it.';
    case 'bulk_strong_only':
      return 'Only strong matches can be marked together. Mark the others one at a time.';
    case 'nothing_to_restore':
      return 'There was nothing to undo. Reload the page to see the current list.';
    case 'unauthorized':
      return 'You are signed out. Sign in again, then retry.';
    default:
      break;
  }
  if (status === 404) return 'This page is not available on your account.';
  return 'That did not save. Check your connection and try again.';
}
