'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';

type Theme = 'light' | 'dark';

/**
 * Light/dark switch for the Tab Room Terminal theme. The source of truth
 * is `document.documentElement.dataset.theme`, set before paint by the
 * inline script in app/layout.tsx (stored preference, else OS). This
 * component just flips it and persists — no context/provider needed
 * because every themed style reads CSS variables, not React state.
 */
function subscribeTheme(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const readTheme = (): Theme => (document.documentElement.dataset.theme as Theme) ?? 'light';

export function ThemeToggle() {
  // null on the server and the first client render: the server doesn't know
  // the visitor's theme, so we render a neutral placeholder and read the real
  // value from the document once hydrated.
  const theme = useSyncExternalStore<Theme | null>(subscribeTheme, readTheme, () => null);

  const flip = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem('theme', next);
    } catch {
      // Storage blocked — the choice just won't persist across visits.
    }
  };

  return (
    <Tooltip content={theme === 'dark' ? 'Light mode' : 'Dark mode'} align="end">
      <button
        type="button"
        onClick={flip}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink coarse:h-11 coarse:w-11"
        data-print-hide="true"
      >
        {theme === 'dark' ? (
          <Sun className="h-4 w-4" aria-hidden />
        ) : (
          <Moon className="h-4 w-4" aria-hidden />
        )}
      </button>
    </Tooltip>
  );
}
