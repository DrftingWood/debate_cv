export const metadata = { title: 'Terms · debate cv' };

export default function Terms() {
  return (
    <article className="prose max-w-none text-gray-800 space-y-4">
      <h1 className="text-2xl font-bold text-ink">Terms of Use</h1>
      <p className="text-sm text-gray-500">Last updated: 2026.</p>
      <p>
        This site is provided as-is for personal use. By signing in you authorize the application to
        read your Gmail with the <code>gmail.readonly</code> scope for the sole purpose of extracting
        Tabbycat private URLs and compiling a debate CV for you.
      </p>
      <ul className="list-disc pl-5 space-y-1">
        <li>You are responsible for the private URLs linked to your account.</li>
        <li>The site scrapes public Tabbycat tournament pages; respect each tournament's terms.</li>
        <li>No warranty of uptime, accuracy, or completeness. Data may be missing or incorrect.</li>
        <li>We may stop the service or delete stored data at any time.</li>
      </ul>
      <p>
        For questions or deletion requests, contact the repository maintainer via{' '}
        <a href="https://github.com/DrftingWood/debate_cv" className="text-accent underline">GitHub</a>.
      </p>
    </article>
  );
}
