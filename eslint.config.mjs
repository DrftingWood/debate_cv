import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'prisma/migrations/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Phase 3 rewrites all this copy. No value in escaping apostrophes now.
      'react/no-unescaped-entities': 'off',
      // Size and complexity, as WARNINGS only (Q1 phase 1). They exist to
      // make a baseline visible, not to block anything: the counts are
      // recorded in docs/CODE_STANDARDS_BASELINE-2026-10-27.md and should
      // only fall. Thresholds are the "Warn" column of the table in
      // docs/CODE_STANDARDS-CHECKLIST-2026-10-26.md. Do not promote these to
      // errors until the baseline is near zero.
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      complexity: ['warn', { max: 15 }],
      'max-params': ['warn', { max: 3 }],
      'max-depth': ['warn', { max: 3 }],
    },
  },
];

export default config;
