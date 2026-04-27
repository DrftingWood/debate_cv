'use client';

/**
 * Required by Sentry to capture errors thrown during root-layout render.
 * Next.js's per-route `error.tsx` only catches errors below the root
 * layout; anything thrown by the root layout itself bypasses it. This
 * file gives Sentry a hook for those errors and renders a minimal
 * fallback shell so the user isn't staring at a blank screen.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#fafafa',
        }}
      >
        <div style={{ maxWidth: 480, padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Something broke.</h1>
          <p style={{ fontSize: '0.95rem', color: '#666', marginBottom: '1.5rem' }}>
            An unexpected error occurred and we&apos;ve been notified. Try refreshing — if it
            persists, your session may need to be restarted.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
