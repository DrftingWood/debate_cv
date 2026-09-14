import { permanentRedirect } from 'next/navigation';

/**
 * /cv/analytics is the pre-rebuild name for what is now /cv/stats.
 *
 * `permanentRedirect` (308), not `redirect` (307): the old path is in
 * users' history, in bookmarks and in notification deep links, and the page
 * it pointed at no longer exists in any form worth rendering. A 307 leaves
 * clients asking for the dead path forever.
 */
export default function CvAnalyticsRedirect() {
  permanentRedirect('/cv/stats');
}
