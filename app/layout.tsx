import type { Metadata } from 'next';
import Link from 'next/link';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { cn } from '@/lib/utils/cn';
import { ToastProvider } from '@/components/ui/Toast';
import { NavLink } from '@/components/NavLink';
import { BrandMark } from '@/components/BrandMark';
import { Footer } from '@/components/Footer';
import './globals.css';

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://debate-cv.vercel.app');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'debate cv — your debate tournament history, from your inbox',
    template: '%s · debate cv',
  },
  description:
    'Sign in with Google and we build your debate tournament CV from the Tabbycat private URLs in your Gmail. Speaker scores, break results, team mates — all in one place.',
  applicationName: 'debate cv',
  authors: [{ name: 'DrftingWood', url: 'https://github.com/DrftingWood' }],
  openGraph: {
    title: 'debate cv',
    description: 'Your debate tournament history, compiled from your Gmail.',
    type: 'website',
    siteName: 'debate cv',
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'debate cv',
    description: 'Your debate tournament history, compiled from your Gmail.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(GeistSans.variable, GeistMono.variable)}>
      <body className="min-h-screen flex flex-col font-sans antialiased">
        <ToastProvider>
          <a href="#main" className="skip-link">Skip to content</a>
          <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
              <Link href="/" className="inline-flex items-center">
                <BrandMark />
              </Link>
              <nav className="flex items-center gap-5 text-sm">
                <NavLink href="/dashboard">Dashboard</NavLink>
                <NavLink href="/cv">My CV</NavLink>
                <NavLink href="/settings">Settings</NavLink>
                <NavLink href="/privacy">Privacy</NavLink>
              </nav>
            </div>
          </header>
          <main id="main" className="flex-1">
            <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
          </main>
          <Footer />
        </ToastProvider>
      </body>
    </html>
  );
}
