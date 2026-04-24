import Link from 'next/link';
import { BrandMark } from './BrandMark';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-10 text-[13.5px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="hidden sm:inline text-muted-foreground/70">
            · a personal-use tool for debaters
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <a
            href="https://github.com/DrftingWood/debate_cv"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </a>
          <span className="text-muted-foreground/70">
            © {new Date().getFullYear()}
          </span>
        </nav>
      </div>
    </footer>
  );
}
