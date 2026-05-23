import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Bare `/settings` redirects to the first sub-page. Settings is split into
 * Profile / Public sharing / Reports / Account; each lives at its own
 * sub-route so users can deep-link (and so the side-nav has a single
 * canonical "active page" to highlight).
 */
export default function SettingsIndexPage() {
  redirect('/settings/profile');
}
