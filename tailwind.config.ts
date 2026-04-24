import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: {
          DEFAULT: '#FFFFFF',
          subtle: '#FAFAFA',
          muted: '#F4F4F5',
        },
        border: {
          DEFAULT: '#E4E4E7',
          strong: '#A1A1AA',
        },
        // Text (semantic numbers: lower = stronger)
        ink: {
          1: '#09090B',
          2: '#18181B',
          3: '#3F3F46',
          4: '#71717A',
          5: '#A1A1AA',
        },
        // Brand
        primary: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          500: '#4F46E5',
          600: '#4338CA',
          700: '#3730A3',
          900: '#1E1B4B',
        },
        // Semantic
        success: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          600: '#059669',
          700: '#047857',
        },
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
        },
        danger: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          600: '#DC2626',
          700: '#B91C1C',
        },
        accent: '#4F46E5',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        xs: '0 1px 0 0 rgba(9, 9, 11, 0.04)',
        sm: '0 1px 2px 0 rgba(9, 9, 11, 0.06), 0 1px 3px 0 rgba(9, 9, 11, 0.04)',
        md: '0 4px 8px -2px rgba(9, 9, 11, 0.08), 0 2px 4px -2px rgba(9, 9, 11, 0.04)',
        lg: '0 12px 24px -6px rgba(9, 9, 11, 0.12), 0 4px 8px -4px rgba(9, 9, 11, 0.06)',
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '6px',
        md: '6px',
        lg: '10px',
      },
      keyframes: {
        'slide-in-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'slide-in-up': 'slide-in-up 180ms ease-out',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [typography],
};

export default config;
