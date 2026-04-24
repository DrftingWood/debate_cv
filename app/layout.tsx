import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'debate cv',
  description: 'Build your debate tournament CV from your Gmail inbox.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
            <a href="/" className="font-semibold text-ink">debate cv</a>
            <nav className="text-sm text-gray-600 space-x-4">
              <a href="/dashboard" className="hover:text-ink">Dashboard</a>
              <a href="/cv" className="hover:text-ink">My CV</a>
              <a href="/privacy" className="hover:text-ink">Privacy</a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
