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
        border: 'hsl(var(--border) / 0.14)',  // hairline default
        input: 'hsl(var(--input) / 0.20)',
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

        // Semantic aliases — self-documenting in JSX. The names are an
        // abstract contract (ink=fg, paper=bg, oxblood=accent) used across
        // ~30 files; values are repointed in app/globals.css, not here.
        // `oxblood` currently resolves to the tournament-green primary
        // (see docs/DESIGN_INSTRUCTIONS.md §6 on color). Renaming the alias
        // would churn every call site for zero visual change — do it only
        // alongside a real refactor.
        paper: 'hsl(var(--background))',
        ink: {
          DEFAULT: 'hsl(var(--foreground))',
          soft: 'hsl(var(--muted-foreground))',
        },
        rule: 'hsl(var(--border) / 0.14)',
        oxblood: {
          DEFAULT: 'hsl(var(--primary))',
          soft: 'hsl(var(--primary-soft) / 0.08)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // The serif slot intentionally renders the display grotesk. Kept
        // as an alias for the handful of remaining `font-serif` call sites
        // (mobile-card tournament names, the public-CV initials avatar);
        // brief §6 reserves italic for sparse emphasis, not the default.
        serif: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        kicker: ['10.5px', { lineHeight: '1.2', letterSpacing: '0.2em', fontWeight: '600' }],
        byline: ['11.5px', { lineHeight: '1.4', letterSpacing: '0.04em' }],
        caption: ['12.5px', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        table: ['13.5px', { lineHeight: '1.5' }],
        ui: ['14px', { lineHeight: '1.5' }],
        body: ['15px', { lineHeight: '1.6' }],
        'body-serif': ['16.5px', { lineHeight: '1.55' }],
        h4: ['18px', { lineHeight: '1.3', letterSpacing: '-0.005em' }],
        h3: ['22px', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        stat: ['28px', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        h2: ['36px', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
        h1: ['48px', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        display: ['64px', { lineHeight: '1.02', letterSpacing: '-0.025em' }],
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
        // glow retired
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
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
        'fade-up': 'fade-up 600ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 500ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [typography],
};

export default config;
