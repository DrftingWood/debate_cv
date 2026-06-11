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

        // Tab Sheet semantics (2026-06 teardown): the editorial-era
        // ink/paper/oxblood aliases died with the call-site rename. `sheet`
        // is the one background alias; everything else is record-*.
        sheet: 'hsl(var(--background))',
        record: {
          ink: 'hsl(var(--record-ink))',
          muted: 'hsl(var(--record-muted))',
          rule: 'hsl(var(--record-rule) / 0.35)',
          surface: 'hsl(var(--record-surface))',
          green: 'hsl(var(--record-green))',
          'green-soft': 'hsl(var(--record-green) / 0.10)',
        },
        break: {
          gold: 'hsl(var(--break-gold))',
        },
        score: {
          blue: 'hsl(var(--score-blue))',
        },
      },
      fontFamily: {
        // Tab Sheet trio (owner ruling D4): Archivo carries the display
        // voice, Libre Franklin the text, Spline Sans Mono every numeral.
        // The serif slot is gone — the system no longer impersonates one.
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Two reading modes: agate (label/caption/table — dense tab text the
        // audience already reads daily) and document (ui/body). Display
        // hierarchy comes from Archivo weight/width as much as size.
        label: ['11px', { lineHeight: '1.2', letterSpacing: '0.14em', fontWeight: '600' }],
        meta: ['12px', { lineHeight: '1.4', letterSpacing: '0.02em' }],
        caption: ['12.5px', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        table: ['13.5px', { lineHeight: '1.5' }],
        ui: ['14px', { lineHeight: '1.5' }],
        body: ['15px', { lineHeight: '1.6' }],
        h4: ['18px', { lineHeight: '1.3', letterSpacing: '-0.005em' }],
        h3: ['22px', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        stat: ['28px', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        h2: ['34px', { lineHeight: '1.15', letterSpacing: '-0.01em' }],
        h1: ['44px', { lineHeight: '1.06', letterSpacing: '-0.015em' }],
        display: ['58px', { lineHeight: '1.04', letterSpacing: '-0.02em' }],
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
