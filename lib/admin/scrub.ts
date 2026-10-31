import { publicPieceUrl } from '@/lib/audit/types';

/**
 * Text as it may be stored and shown on an admin page: trimmed, every pasted
 * URL in its public form, and any leftover `privateurls/<key>` (a URL
 * without its scheme) removed. A private key signs in as the participant; it
 * has no place in a review-set comment, a user's CV report or a parser
 * warning's sample, all of which reach the page or an export.
 *
 * Born in the review set (Task 5c) and moved here when the CV reports and
 * parser warnings ledgers needed it too (Task 5d), so the parser-warnings
 * read model and the review set do not import each other.
 */
export function scrubComment(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, (url) => publicPieceUrl(url) ?? '[link removed]')
    .replace(/\S*privateurls\S*/gi, '[private link removed]')
    .trim();
}
