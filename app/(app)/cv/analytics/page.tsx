import { redirect } from 'next/navigation';

/**
 * /cv/analytics is the pre-rebuild name for what is now /cv/stats. Kept as
 * a permanent redirect because the old path is in users' history, in
 * bookmarks, and in the notification feed's deep links — and because the
 * page it pointed at no longer exists in any form worth rendering.
 */
export default function CvAnalyticsRedirect() {
  redirect('/cv/stats');
}
