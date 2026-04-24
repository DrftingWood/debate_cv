import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'Terms of use for debate cv.',
};

export default function Terms() {
  return (
    <article className="prose prose-zinc max-w-none">
      <h1>Terms of Use</h1>
      <p className="lead">
        debate cv is provided as-is for personal use. Last updated: 2026.
      </p>

      <p>
        By signing in, you authorize the application to read your Gmail with the
        <code>gmail.readonly</code> scope for the sole purpose of extracting Tabbycat private
        URLs and compiling a debate CV for you.
      </p>

      <ul>
        <li>You are responsible for the private URLs linked to your account.</li>
        <li>The site scrapes public Tabbycat tournament pages; respect each tournament's terms.</li>
        <li>No warranty of uptime, accuracy, or completeness. Data may be missing or incorrect.</li>
        <li>We may stop the service or delete stored data at any time.</li>
        <li>debate cv is not affiliated with Tabbycat, Calico, or any tournament organizer.</li>
      </ul>

      <p>
        For questions, deletion requests, or reports, open an issue on{' '}
        <a href="https://github.com/DrftingWood/debate_cv" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        .
      </p>
    </article>
  );
}
