import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-bg">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-ink-4 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} debate cv. A personal-use tool for debaters.
        </p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/privacy" className="hover:text-ink-1">Privacy</Link>
          <Link href="/terms" className="hover:text-ink-1">Terms</Link>
          <a
            href="https://github.com/DrftingWood/debate_cv"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink-1"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
