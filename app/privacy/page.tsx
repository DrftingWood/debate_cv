import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How debate cv handles your Gmail data and tournament records.',
};

export default function Privacy() {
  return (
    <article className="prose prose-zinc max-w-none">
      <h1>Privacy Policy</h1>
      <p className="lead">
        debate cv is a personal-use tool for debaters. We try to collect and retain as little as
        possible. Last updated: 2026.
      </p>

      <h2>What we access</h2>
      <p>
        When you sign in with Google, we request the{' '}
        <code>https://www.googleapis.com/auth/gmail.readonly</code> scope. We use it to search
        your Gmail for Tabbycat private URLs matching <code>calicotab.com</code> or{' '}
        <code>herokuapp.com</code> with a <code>/privateurls/</code> path.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your Google profile (id, email, name, picture) — standard account record.</li>
        <li>A Gmail OAuth refresh token so scheduled ingest jobs can run without you being online.</li>
        <li>The matched private URLs plus minimal metadata (subject, message id, date).</li>
        <li>
          Public tournament data fetched from each URL's landing and tab pages (team, speaker,
          break, round results).
        </li>
      </ul>
      <p>
        We do <strong>not</strong> store the body of your emails or anything else from Gmail
        beyond the matched URLs.
      </p>

      <h2>Who can see your CV</h2>
      <p>
        Every server query is filtered by your user id. Other signed-in users cannot see your CV,
        your private URLs, or your claimed identities. Tournament rows are deduplicated across
        accounts for efficiency — if you and another user both have a URL for the same event, we
        scrape it once — but the CV view is always scoped to your own claimed Person rows.
      </p>

      <h2>Data deletion</h2>
      <p>
        Revoke access at{' '}
        <a href="https://myaccount.google.com/permissions">Google Account permissions</a>. To have
        your database rows deleted, open an issue on{' '}
        <a href="https://github.com/DrftingWood/debate_cv" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>{' '}
        and we'll purge your user record and related rows.
      </p>

      <h2>Third parties</h2>
      <p>
        The app runs on Vercel and stores data in a managed Postgres database. We do not share
        your data with any other third-party services.
      </p>

      <h2>Security</h2>
      <p>
        OAuth tokens and database rows are stored on Vercel-managed infrastructure. We do not yet
        encrypt refresh tokens at rest — this is a known gap flagged in the repository's README
        for fixing before any broader public launch.
      </p>
    </article>
  );
}
