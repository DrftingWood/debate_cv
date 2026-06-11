'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

/**
 * Light/dark theme switch. The source of truth is
 * `document.documentElement.dataset.theme`, set before paint by the
 * inline script in app/layout.tsx (stored preference, else OS). This
 * component just flips it and persists — no context/provider needed
 * because every themed style reads CSS variables, not React state.
 */
export function ThemeToggle() {
  // null until mounted: the server doesn't know the visitor's theme, so we
  // render a neutral placeholder and hydrate the real state client-side.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) ?? 'light');
  }, []);

  const flip = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem('theme', next);
    } catch {
      // Storage blocked — the choice just won't persist across visits.
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      className="rounded-md p-2 text-ink-soft transition-colors hover:bg-ink/[0.06] hover:text-ink"
      data-print-hide="true"
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" aria-hidden />
      ) : (
        <Moon className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
