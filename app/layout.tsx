import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Inter, Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { cn } from '@/lib/utils/cn';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

// Tab Room Terminal type stack (2026-06 retheme): Space Grotesk carries the
// display voice (it fills BOTH the --font-display and --font-display slots so
// the hundreds of `font-display` heading call sites lean into oblique
// grotesk headlines without churn), IBM Plex Mono carries every numeral and
// identifier via `.num` / `font-mono`, Inter stays on body copy.
const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
const fontDisplay = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});
const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F6F1' },
    { media: '(prefers-color-scheme: dark)', color: '#0C1311' },
  ],
};

// Runs before paint so a stored theme preference never flashes the wrong
// mode. Stored 'light'/'dark' wins; otherwise follow the OS. Kept as a raw
// string (not a component) because it must execute synchronously in <head>.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce minted per request by middleware.ts. The theme script must carry
  // it or the CSP blocks it and every visitor gets a flash of the wrong
  // theme before hydration.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang="en"
      // Server-rendered fallback; the inline script corrects it before paint.
      data-theme="light"
      className={cn(fontSans.variable, fontDisplay.variable, fontMono.variable)}
      suppressHydrationWarning
    >
      <head>
        {/*
          suppressHydrationWarning is load-bearing, not cosmetic. Browsers
          blank the `nonce` CONTENT attribute once the document is parsed —
          `getAttribute('nonce')` returns '' even though the script ran —
          so React's hydration pass compares the server's real nonce against
          an empty string and reports a mismatch on every single page. The
          value is still live on the `.nonce` IDL property; nothing is
          actually wrong, and there is nothing to patch up.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="min-h-screen flex flex-col font-sans antialiased">
        <ToastProvider>
          <a href="#main" className="skip-link">Skip to content</a>
          {/*
            A flex COLUMN, not just a flex child. The footer is rendered by
            the route layouts (inside this element), so `flex-1` on <main>
            alone did nothing to push it down — on the dashboard the footer
            sat at 756px in a 900px viewport with dead space beneath it.
            Making main a column lets each route's content wrapper claim
            flex-1 and pin the footer to the bottom.
          */}
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
