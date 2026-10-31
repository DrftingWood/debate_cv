import { Fragment } from 'react';
import { publicPieceUrl } from '@/lib/audit/types';
import { buttonClasses } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';

/**
 * A link out to a page of a tournament's tab, so an admin can check a hint
 * by eye (owner, 2026-10-31: "Links to check by hand", and "tournament url
 * should be a clickable link").
 *
 * The href always goes through publicPieceUrl, here, whatever the caller
 * passed: a stored URL can be a user's `/privateurls/<key>/` address, and that
 * key signs in as the participant, so it must never reach an href. When no
 * public address can be made, the text shows without a link rather than a
 * link to nowhere.
 *
 * It opens in a new tab (the admin page keeps its place) with
 * `noopener noreferrer`, and the visible "↗" says so. The accessible name
 * starts with the visible words, then says whose page it is and that it
 * opens a new tab (UX-11): twenty links all named "Tab" cannot be told apart
 * in a screen reader's list of links.
 */
export function TabLink({
  url,
  text,
  of,
  asButton = false,
  missing,
  breakable = false,
  className,
}: {
  url: string | null | undefined;
  /** The visible words, before the arrow. */
  text: string;
  /** Whose page it is, for the accessible name; omit when `text` says it. */
  of?: string;
  /**
   * An outline button (a page header's action) rather than inline text. A
   * button with nowhere to go would look pressable, so without a public
   * address it renders nothing.
   */
  asButton?: boolean;
  /**
   * Words for "no public address" in place of `text`, for a column where an
   * unlinked "Tab" would read as a broken link (UX-27: a real state gets a word).
   */
  missing?: string;
  /**
   * A host or path as the text: offer a line break after each "." and "/",
   * so a narrow column wraps "twinopen2024.calicotab./com/twin" between parts
   * rather than "calicotab.co/m" mid-word (R7 final check, Imports at 1280).
   */
  breakable?: boolean;
  className?: string;
}) {
  const href = url ? publicPieceUrl(url) : null;
  if (!href) {
    if (asButton) return null;
    return missing ? (
      <span className={cn('text-ink-soft', className)}>{missing}</span>
    ) : (
      <span className={className}>{breakable ? breakAfterSeparators(text) : text}</span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${text}${of ? ` of ${of}` : ''}, opens in a new tab`}
      className={cn(
        asButton
          ? buttonClasses({ variant: 'outline', size: 'sm' })
          : 'inline-flex min-h-6 items-center text-ink underline-offset-4 hover:underline',
        className,
      )}
    >
      {/* One span, so the inline-flex link keeps the text as a single item. */}
      <span>{breakable ? breakAfterSeparators(text) : text}</span>
      <span aria-hidden> ↗</span>
    </a>
  );
}

/** The text with a <wbr> after each "." and "/". */
function breakAfterSeparators(text: string) {
  return text.split(/(?<=[./])/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}
