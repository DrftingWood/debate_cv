import type { Metadata, Viewport } from 'next';
import { Archivo, Libre_Franklin, Spline_Sans_Mono } from 'next/font/google';
import { cn } from '@/lib/utils/cn';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

// Tab Sheet type trio (2026-06 teardown, owner ruling D4): Archivo carries
// the display voice (its width axis gives the masthead poster weight without
// poster sizes), Libre Franklin carries text — the Franklin Gothic lineage
// is the typeface of printed results pages — and Spline Sans Mono carries
// every numeral, rank, and identifier via `.num` / `font-mono`.
const fontSans = Libre_Franklin({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
const fontDisplay = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-display',
  display: 'swap',
});
const fontMono = Spline_Sans_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://debate-cv.vercel.app');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'debate cv — verified tournament records for debaters',
    template: '%s · debate cv',
  },
  description:
    'Build a private, source-backed debate CV with tournaments, breaks, speaker scores, growth signals, and share controls.',
  applicationName: 'debate cv',
  authors: [{ name: 'DrftingWood', url: 'https://github.com/DrftingWood' }],
  openGraph: {
    title: 'debate cv',
    description: 'Your debate tournament history, verified and ready to share.',
    type: 'website',
    siteName: 'debate cv',
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'debate cv',
    description: 'Your debate tournament history, verified and ready to share.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // One theme. Credential artifacts don't have moods (teardown ruling D1) —
  // a first-time visitor on a dark-mode phone still meets sheet white.
  themeColor: '#FAF9F4',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(fontSans.variable, fontDisplay.variable, fontMono.variable)}
    >
      <body className="min-h-screen flex flex-col font-sans antialiased">
        <ToastProvider>
          <a href="#main" className="skip-link">Skip to content</a>
          <main id="main" className="flex-1">
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
