export const metadata = { title: 'Privacy · debate cv' };

export default function Privacy() {
  return (
    <article className="prose max-w-none text-gray-800 space-y-4">
      <h1 className="text-2xl font-bold text-ink">Privacy Policy</h1>
      <p className="text-sm text-gray-500">Last updated: 2026.</p>
      <h2 className="text-lg font-semibold mt-6">What we access</h2>
      <p>
        When you sign in with Google, we request the <code>gmail.readonly</code> scope. We use it to
        search your inbox for Tabbycat private URLs matching
        <code>calicotab.com</code> or <code>herokuapp.com</code> hosts with a
        <code>/privateurls/</code> path.
      </p>
      <h2 className="text-lg font-semibold mt-6">What we store</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li>Your Google profile (id, email, name, picture) — standard account record.</li>
        <li>An OAuth refresh token so scheduled ingest jobs can run without you being online.</li>
        <li>The private URLs themselves plus minimal metadata (subject, message id, date).</li>
        <li>
          Publicly-visible tournament data (teams, speaker scores, break rounds) fetched from the
          private URL pages.
        </li>
      </ul>
      <p>
        We do <strong>not</strong> store the body of your emails or anything else from Gmail beyond the matched URLs.
      </p>
      <h2 className="text-lg font-semibold mt-6">Data deletion</h2>
      <p>
        Sign out and revoke the app at{' '}
        <a href="https://myaccount.google.com/permissions" className="text-accent underline">
          myaccount.google.com/permissions
        </a>
        . Email the maintainer to request full deletion of your rows from our database.
      </p>
      <h2 className="text-lg font-semibold mt-6">Third parties</h2>
      <p>The app is deployed on Vercel and stores data in a managed Postgres database. No other third-party services receive your data.</p>
    </article>
  );
}
