import type { Metadata } from 'next';
import Link from 'next/link';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { cn } from '@/lib/utils/cn';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'debate cv',
  description: 'Build your debate tournament CV from your Gmail inbox.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(GeistSans.variable, GeistMono.variable)}>
      <body className="min-h-screen font-sans antialiased">
        <ToastProvider>
          <a href="#main" className="skip-link">Skip to content</a>
          <header className="border-b border-border bg-bg">
            <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
              <Link href="/" className="font-semibold text-ink-1">debate cv</Link>
              <nav className="text-sm text-ink-3 space-x-4">
                <Link href="/dashboard" className="hover:text-ink-1">Dashboard</Link>
                <Link href="/cv" className="hover:text-ink-1">My CV</Link>
                <Link href="/privacy" className="hover:text-ink-1">Privacy</Link>
              </nav>
            </div>
          </header>
          <main id="main" className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
