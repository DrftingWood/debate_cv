import type { Metadata, Viewport } from 'next';
import { Inter, Plus_Jakarta_Sans, Fraunces } from 'next/font/google';
import { cn } from '@/lib/utils/cn';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
const fontDisplay = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});
const fontSerif = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-serif',
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
    { media: '(prefers-color-scheme: light)', color: '#FAF6EC' },
    { media: '(prefers-color-scheme: dark)', color: '#181A1F' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(fontSans.variable, fontDisplay.variable, fontSerif.variable)}
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
