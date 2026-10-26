// Architecture rules (Q1 phase 1b; docs/CODING_STANDARDS.md ST-4 to ST-6,
// docs/CI_PLAN-2026-10-27.md). Report-only in CI for now: every rule is
// `warn`, so `npm run arch` prints violations but exits 0. A rule moves to
// `error` once its count is zero, the same graduation path as the lint
// warnings. Rule syntax: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'An import cycle means neither module can be understood, tested or split on its own, ' +
        'and module initialisation order starts to matter. Break the cycle by moving the shared ' +
        'piece into a third module.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-prisma-outside-lib',
      comment:
        'Routes, pages and components reach the database through lib/ (lib/db.ts is the only ' +
        'PrismaClient; CLAUDE.md "DB access"). Type-only imports of generated types are fine. ' +
        'A value import of @prisma/client from app/ or components/ is either a second client ' +
        'or an enum that lib/ could hand over; either way it is reviewed.',
      severity: 'warn',
      from: { path: '^(app|components)/' },
      to: { path: '@prisma/client', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'lib-not-to-app-or-components',
      comment:
        'lib/ is the inner layer: routes and components depend on it, never the reverse. ' +
        'A lib module that imports from app/ or components/ drags React or route code into ' +
        'the scraper, the queue and the statistics engine.',
      severity: 'warn',
      from: { path: '^lib/' },
      to: { path: '^(app|components)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // node_modules is not excluded (that would hide @prisma/client from the
    // rule above); doNotFollow keeps it out of the walk instead.
    exclude: { path: '^(\\.next|prisma/migrations)/' },
    // Count `import type` as a dependency so the prisma rule can tell type-only
    // imports apart, and so cycles made only of types are still visible.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.d.ts'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
