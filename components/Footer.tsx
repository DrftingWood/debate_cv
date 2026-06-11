import Link from 'next/link';
import { BrandMark } from './BrandMark';

export function Footer() {
  return (
    <footer className="mt-24">
      <div className="mx-auto max-w-6xl px-5">
        <hr className="hairline" />
        <div className="flex flex-col gap-4 py-8 text-table text-ink-soft sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark />
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <a
              href="https://github.com/DrftingWood/debate_cv"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink"
            >
              GitHub
            </a>
            <span className="text-ink-soft/70">© {new Date().getFullYear()}</span>
          </nav>
        </div>
      </div>
    </footer>
  );
}
