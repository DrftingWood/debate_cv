import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { cn } from '@/lib/utils/cn';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

// Tab Room Terminal type stack (2026-06 retheme): Space Grotesk carries the
// display voice (it fills BOTH the --font-display and --font-serif slots so
// the hundreds of `font-serif italic` heading call sites lean into oblique
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
    googleBot: { index: true, follow: true },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F2F6F2' },
    { media: '(prefers-color-scheme: dark)', color: '#0C1311' },
  ],
};

// Runs before paint so a stored theme preference never flashes the wrong
// mode. Stored 'light'/'dark' wins; otherwise follow the OS. Kept as a raw
// string (not a component) because it must execute synchronously in <head>.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // Server-rendered fallback; the inline script corrects it before paint.
      data-theme="light"
      className={cn(fontSans.variable, fontDisplay.variable, fontMono.variable)}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
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
