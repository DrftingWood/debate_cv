'use client';

/**
 * Required by Sentry to capture errors thrown during root-layout render.
 * Next.js's per-route `error.tsx` only catches errors below the root
 * layout; anything thrown by the root layout itself bypasses it. This
 * file gives Sentry a hook for those errors and renders a minimal
 * fallback shell so the user isn't staring at a blank screen.
 *
 * Sits outside the Tailwind layer (globals.css may not have loaded yet),
 * so colours are hex literals of the Ledger tokens in globals.css:
 *   light canvas #F6F7F9, ink #141B24, muted #626C7A, paper #FFFFFF;
 *   dark canvas #0E1116, ink #E9EDF1, muted #8D98A5, paper #14181F.
 * The dark set follows the OS preference only: the stored theme lives in
 * localStorage and is applied by the root layout's script, which is
 * exactly what did not run if we are here. `lang` is set because this
 * <html> replaces the root layout's, which is the one that carried it.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

const css = `
.ge{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:#F6F7F9;color:#141B24;color-scheme:light}
.ge main{max-width:480px;padding:2rem;text-align:center}
.ge h1{font-size:1.5rem;font-weight:500;margin:0 0 .75rem}
.ge p{font-size:.95rem;color:#626C7A;margin:0 0 1.5rem}
.ge code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ge button{min-height:44px;padding:.5rem 1.25rem;border-radius:6px;cursor:pointer;font-size:.9rem;
border:1px solid #6E7A88;background:#FFFFFF;color:#141B24}
.ge button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
@media (prefers-color-scheme:dark){
.ge{background:#0E1116;color:#E9EDF1;color-scheme:dark}
.ge p{color:#8D98A5}
.ge button{background:#14181F;color:#E9EDF1}
}`;

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
    <html lang="en">
      <body className="ge">
        {/* A constant string of our own, not user or scraped content (SE-5). */}
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <main>
          <h1>Something broke.</h1>
          <p>
            This page did not load, and the error has been reported. Try again, or reload the page.
            {error.digest ? (
              <>
                <br />
                Reference: <code>{error.digest}</code>
              </>
            ) : null}
          </p>
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
