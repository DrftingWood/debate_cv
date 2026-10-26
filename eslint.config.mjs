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
      // One PrismaClient per process (docs/CODING_STANDARDS.md DB-1). A second
      // client opens its own pool, and on Vercel every warm lambda would then
      // hold two sets of connections against Neon's limit. lib/db.ts is the
      // singleton; the standalone scripts below run outside Next and make their
      // own. Zero hits when this was added (Q1 phase 1b), so it is an error.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='PrismaClient']",
          message: 'Import the singleton from @/lib/db instead of constructing PrismaClient.',
        },
      ],
    },
  },
  {
    files: ['lib/db.ts', 'scripts/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];

export default config;
