import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';
import plugin from 'tailwindcss/plugin';

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
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          hover: 'hsl(var(--primary-hover) / <alpha-value>)',
          soft: 'hsl(var(--primary-soft) / 0.08)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
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
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          2: 'hsl(var(--surface-2) / <alpha-value>)',
          3: 'hsl(var(--surface-3) / <alpha-value>)',
        },
        // Directional value colours. These are the ONLY tints allowed on a
        // number, and they always mean up/down — never brand, never mood.
        pos: {
          DEFAULT: 'hsl(var(--pos) / <alpha-value>)',
          soft: 'hsl(var(--pos) / 0.10)',
        },
        neg: {
          DEFAULT: 'hsl(var(--neg) / <alpha-value>)',
          soft: 'hsl(var(--neg) / 0.10)',
        },
        break: {
          gold: 'hsl(var(--break-gold) / <alpha-value>)',
          soft: 'hsl(var(--break-gold) / 0.12)',
        },
        score: {
          blue: 'hsl(var(--score-blue) / <alpha-value>)',
          soft: 'hsl(var(--score-blue) / 0.12)',
        },

        // Abstract aliases kept from the previous system (ink = foreground,
        // paper = background, oxblood = accent). Re-pointed at the ledger
        // values; renaming them would churn ~30 files for zero visual change.
        // `<alpha-value>` is load-bearing, not decoration. Without it
        // Tailwind cannot apply an opacity modifier to the token and
        // silently emits NO rule at all — `text-ink-soft/60` compiled to
        // nothing, so the element kept its inherited colour and the
        // intended de-emphasis vanished with no build error. Every token
        // below that any call site dims must carry the placeholder.
        paper: 'hsl(var(--background) / <alpha-value>)',
        ink: {
          DEFAULT: 'hsl(var(--foreground) / <alpha-value>)',
          soft: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        rule: 'hsl(var(--border) / 0.16)',
        oxblood: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          soft: 'hsl(var(--primary-soft) / 0.08)',
        },
        archive: {
          white: 'hsl(var(--archive-white) / <alpha-value>)',
        },
        record: {
          ink: 'hsl(var(--record-ink) / <alpha-value>)',
          muted: 'hsl(var(--record-muted) / <alpha-value>)',
          rule: 'hsl(var(--record-rule) / 0.35)',
          surface: 'hsl(var(--record-surface) / <alpha-value>)',
          green: 'hsl(var(--record-green) / <alpha-value>)',
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
        // 12px floor, matching the .kicker / .eyebrow component classes in
        // globals.css. At 10.5px this tier carried 648 text nodes — every
        // column header and stat caption, i.e. the text that says what each
        // number IS — below a legible size for uppercase letterspaced mono.
        kicker: ['12px', { lineHeight: '1.2', letterSpacing: '0.11em', fontWeight: '600' }],
        byline: ['12px', { lineHeight: '1.45' }],
        caption: ['12.5px', { lineHeight: '1.45' }],
        table: ['13.5px', { lineHeight: '1.5' }],
        ui: ['14px', { lineHeight: '1.5' }],
        body: ['15px', { lineHeight: '1.6' }],
        'body-serif': ['16px', { lineHeight: '1.6' }],
        h4: ['17px', { lineHeight: '1.35', letterSpacing: '-0.006em' }],
        // ── Fluid from here up ────────────────────────────────────────────
        // These were fixed desktop sizes used on 29 call sites with no
        // mobile step: `text-h1` put a 44px headline on a 320px screen,
        // where "Your debate history, kept like an account" ran to four
        // lines and ~340px before any content. clamp() makes the scale
        // mobile-first by construction — the small end is the phone size,
        // the large end is exactly what desktop rendered before, so no
        // desktop layout moves. Two call sites still step h1 → display at
        // md and keep working.
        h3: ['clamp(19px, 1rem + 0.6vw, 21px)', { lineHeight: '1.3', letterSpacing: '-0.012em' }],
        stat: ['clamp(22px, 1rem + 1.6vw, 26px)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'figure-sm': ['clamp(18px, 1rem + 0.7vw, 20px)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'figure-md': ['clamp(23px, 1rem + 2vw, 28px)', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
        'figure-lg': ['clamp(30px, 1rem + 4vw, 40px)', { lineHeight: '1', letterSpacing: '-0.03em' }],
        h2: ['clamp(24px, 1rem + 2.6vw, 32px)', { lineHeight: '1.15', letterSpacing: '-0.018em' }],
        h1: ['clamp(30px, 1rem + 4.6vw, 44px)', { lineHeight: '1.08', letterSpacing: '-0.024em' }],
        display: ['clamp(34px, 1rem + 7vw, 60px)', { lineHeight: '1.02', letterSpacing: '-0.03em' }],
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
  plugins: [
    typography,
    /*
     * `coarse:` — a media query on the POINTER rather than the viewport.
     *
     * Every other responsive prefix here is a width query, which quietly
     * assumes width predicts input device. It does not: a phone in
     * landscape is 844px wide and still operated by a thumb, so it was
     * being handed the dense 32px desktop controls. Touch sizing keys off
     * `coarse:`; visual density keys off `md:`. They are different
     * questions and now have different answers.
     */
    plugin(({ addVariant }) => {
      addVariant('coarse', '@media (pointer: coarse)');
      addVariant('fine', '@media (pointer: fine)');
    }),
  ],
};

export default config;
