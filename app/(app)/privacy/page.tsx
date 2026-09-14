import type { Metadata } from 'next';
import { getPrivacyContactEmail } from '@/lib/utils/site';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How debate cv handles your Gmail data and tournament records.',
};

export default function Privacy() {
  const contactEmail = getPrivacyContactEmail();
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="kicker">LEGAL · PRIVACY</div>
        <h1 className="font-display text-h2 font-medium tracking-tight text-ink">
          What we store, and why
        </h1>
        <hr className="hairline" />
      </header>

      <article className="prose prose-stone max-w-none font-display">
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

      <h2>Public tournament data</h2>
      <p>
        Tournament results displayed on your CV are public data sourced from Tabbycat tournament
        pages. These results — team standings, speaker scores, break records, and judge
        assignments — are published by tournament organisers on publicly-accessible Tabbycat
        instances. We retain this data independently of user accounts: if you delete your account,
        your personal links and identity claims are removed, but the underlying public tournament
        records remain in our database as they may be referenced by other users who participated
        in the same events.
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
        You can delete your data yourself at any time. Go to{' '}
        <a href="/settings">Settings</a>, click <strong>Delete my data</strong>, and confirm by
        typing your email. Your account, OAuth tokens, discovered URLs, ingest jobs, and identity
        claims are removed immediately.
      </p>
      <p>
        To revoke our access to your Gmail without deleting the account, use{' '}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
          Google Account permissions
        </a>{' '}
        — that revokes the OAuth grant. Settings → Disconnect does the same.
      </p>

      <h2>If you don't have an account but your name is here</h2>
      <p>
        Most of the people in our database have never used this site. Tabbycat tabs are
        published in full, so scraping one event brings in every speaker, team and judge who
        competed at it — and those names then appear on the CVs of the people who <em>do</em>{' '}
        use the site, as teammates, and inside the field-wide statistics their results are
        compared against. If that includes you, this section is the one that applies to you.
      </p>
      <ul>
        <li>
          <strong>What we hold about you:</strong> your name as it was printed on the public
          tab, your team name, your speaker scores and ranks, which rounds you judged, and
          whether you broke. Nothing else — no contact details, no email, no Gmail data. We
          have no way to contact you and never will.
        </li>
        <li>
          <strong>Where it came from:</strong> a publicly-accessible results page published by
          the tournament's organisers, not from you and not from any private source.
        </li>
        <li>
          <strong>Why we think we may hold it:</strong> legitimate interest in maintaining an
          accurate record of published competitive results, the same basis a rankings site or
          a tournament archive relies on. If you object, we do not argue the point — see
          below.
        </li>
      </ul>
      <p>
        <strong>To have your name removed</strong>, write to{' '}
        {contactEmail ? (
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        ) : (
          <a
            href="https://github.com/DrftingWood/debate_cv/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            the project's issue tracker
          </a>
        )}{' '}
        with the tournament and the name as it appears on the tab. We will confirm you are the
        person on the tab and then suppress the record.
      </p>
      <p>
        Suppression replaces your name with <code>[name withdrawn]</code> everywhere it would
        otherwise be shown, stops anyone from claiming the record as their own, and survives
        re-scraping — if we fetch that tab again tomorrow, your name is not written back. What
        it does <em>not</em> do is delete the result row itself. A debate result is a fact
        about a public event: removing the row would silently corrupt the other competitors'
        records and every field statistic derived from that tab. What identifies you is the
        name, and the name is what goes. If you want the row itself gone as well, say so in
        your message and we will discuss it — but that is a change to other people's records,
        so it is a conversation rather than a button.
      </p>

      <h2>Third parties</h2>
      <p>
        The app runs on Vercel and stores data in a managed Postgres database. We do not share
        your data with any other third-party services.
      </p>

      <h2>Security</h2>
      <p>
        OAuth refresh tokens are encrypted at rest with AES-256-GCM, keyed from a server-only
        secret (<code>TOKEN_ENCRYPTION_KEY</code>). Database rows live on Vercel-managed
        infrastructure. The encryption was added on 2026-04 and any older plaintext rows are
        re-encrypted on next access.
      </p>
      </article>
    </div>
  );
}
