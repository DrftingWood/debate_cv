import { scrubComment } from '@/lib/admin/scrub';
import { shortenUrls } from '@/lib/admin/shortUrl';
import { cn } from '@/lib/utils/cn';

/**
 * Admin text that may quote a page address: shown with each address cut to
 * the path after the tournament slug, the whole text (public addresses only,
 * scrubbed again here) on the title for a pointer to read. `overflow-wrap:
 * anywhere` is the backstop for any other long unbroken string (R7: a quoted
 * URL painted over the Users and Age columns of the Inbox).
 */
export function ShortUrlText({ text, className }: { text: string; className?: string }) {
  // Scrubbed first: a private key must not survive into the shortened path either.
  const clean = scrubComment(text);
  const short = shortenUrls(clean);
  return (
    <span
      className={cn('[overflow-wrap:anywhere]', className)}
      title={short !== clean ? clean : undefined}
    >
      {short}
    </span>
  );
}
