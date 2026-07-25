import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1.25rem', lg: '2rem' },
      screens: { '2xl': '1280px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border) / 0.16)',  // hairline default
        input: 'hsl(var(--input) / 0.22)',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))',
          soft: 'hsl(var(--primary-soft) / 0.08)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ── Ledger palette ───────────────────────────────────────────────
        // Surface tiers, in order of depth. `surface` is the statement
        // sheet, `surface-2` a zebra row or well, `surface-3` a chart
        // gutter / progress track.
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          2: 'hsl(var(--surface-2))',
          3: 'hsl(var(--surface-3))',
        },
        // Directional value colours. These are the ONLY tints allowed on a
        // number, and they always mean up/down — never brand, never mood.
        pos: {
          DEFAULT: 'hsl(var(--pos))',
          soft: 'hsl(var(--pos) / 0.10)',
        },
        neg: {
          DEFAULT: 'hsl(var(--neg))',
          soft: 'hsl(var(--neg) / 0.10)',
        },
        break: {
          gold: 'hsl(var(--break-gold))',
          soft: 'hsl(var(--break-gold) / 0.12)',
        },
        score: {
          blue: 'hsl(var(--score-blue))',
          soft: 'hsl(var(--score-blue) / 0.12)',
        },

        // Abstract aliases kept from the previous system (ink = foreground,
        // paper = background, oxblood = accent). Re-pointed at the ledger
        // values; renaming them would churn ~30 files for zero visual change.
        paper: 'hsl(var(--background))',
        ink: {
          DEFAULT: 'hsl(var(--foreground))',
          soft: 'hsl(var(--muted-foreground))',
        },
        rule: 'hsl(var(--border) / 0.16)',
        oxblood: {
          DEFAULT: 'hsl(var(--primary))',
          soft: 'hsl(var(--primary-soft) / 0.08)',
        },
        archive: {
          white: 'hsl(var(--archive-white))',
        },
        record: {
          ink: 'hsl(var(--record-ink))',
          muted: 'hsl(var(--record-muted))',
          rule: 'hsl(var(--record-rule) / 0.35)',
          surface: 'hsl(var(--record-surface))',
          green: 'hsl(var(--record-green))',
          'green-soft': 'hsl(var(--record-green) / 0.10)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // The statement UI has no serif voice. The slot stays mapped to the
        // display grotesk so any stray `font-serif` renders as a heading
        // rather than falling back to Times.
        serif: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Micro labels → body → headings → figures. The `figure-*` steps are
        // for monospaced numbers in stat tiles and are deliberately tighter
        // than the heading scale at the same optical size.
        kicker: ['10.5px', { lineHeight: '1.2', letterSpacing: '0.13em', fontWeight: '600' }],
        byline: ['12px', { lineHeight: '1.45' }],
        caption: ['12.5px', { lineHeight: '1.45' }],
        table: ['13.5px', { lineHeight: '1.5' }],
        ui: ['14px', { lineHeight: '1.5' }],
        body: ['15px', { lineHeight: '1.6' }],
        'body-serif': ['16px', { lineHeight: '1.6' }],
        h4: ['17px', { lineHeight: '1.35', letterSpacing: '-0.006em' }],
        h3: ['21px', { lineHeight: '1.3', letterSpacing: '-0.012em' }],
        stat: ['26px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'figure-sm': ['20px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'figure-md': ['28px', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
        'figure-lg': ['40px', { lineHeight: '1', letterSpacing: '-0.03em' }],
        h2: ['32px', { lineHeight: '1.15', letterSpacing: '-0.018em' }],
        h1: ['44px', { lineHeight: '1.08', letterSpacing: '-0.024em' }],
        display: ['60px', { lineHeight: '1.02', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        card: 'var(--radius-card)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 480ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 400ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [typography],
};

export default config;
