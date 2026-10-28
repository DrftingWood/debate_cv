import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// Type-aware rules (typescript-eslint `strict-type-checked`, the type-aware-only
// half, so nothing already in next/typescript is duplicated), WARNINGS only.
// Scoped to lib/ and app/api/ (the server code). Over the whole tree the
// type-aware pass made `npm run lint` about 4x slower (24 s to 102 s locally);
// even this scope costs about 117 s, because most of it is building the
// TypeScript program, not running rules. Every rule in the preset is forced to
// 'warn' while keeping its options. The per-rule counts are baselined in
// scripts/check-ratchet.mjs and may only fall; see docs/CODING_STANDARDS.md
// (ST-7). The plugin is the copy that eslint-config-next already installs.
const TYPE_AWARE_FILES = ['app/api/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'];

const asWarn = (value) =>
  value === 'off' || value === 0
    ? 'off'
    : Array.isArray(value)
      ? ['warn', ...value.slice(1)]
      : 'warn';

const typeAware = tsPlugin.configs['flat/strict-type-checked-only'].map((c) => ({
  ...c,
  files: TYPE_AWARE_FILES,
  ...(c.rules
    ? { rules: Object.fromEntries(Object.entries(c.rules).map(([k, v]) => [k, asWarn(v)])) }
    : {}),
  ...(c.languageOptions
    ? {
        languageOptions: {
          ...c.languageOptions,
          parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
        },
      }
    : {}),
}));

const config = [
  {
    ignores: ['.next/**', '.claude/**', 'node_modules/**', 'prisma/migrations/**', 'next-env.d.ts'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  ...typeAware,
  {
    // Numbers in template literals are harmless; the preset's default flags
    // 473 of them and would drown the findings that matter.
    files: TYPE_AWARE_FILES,
    rules: { '@typescript-eslint/restrict-template-expressions': ['warn', { allowNumber: true }] },
  },
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
