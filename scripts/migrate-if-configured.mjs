// Runs `prisma migrate deploy` only for production deployments (or local builds
// with the non-pooling Postgres URL set). Vercel Preview builds skip it: they can
// see the real database's URL, and an unmerged migration must never run there.
// Force with ALLOW_PREVIEW_MIGRATIONS=1 only if the preview has its own database.
// The decision lives in lib/migrate-gate.mjs.

import { spawnSync } from 'node:child_process';
import { shouldMigrate } from './lib/migrate-gate.mjs';

const { migrate, reason } = shouldMigrate(process.env);
console.log(`[migrate] ${reason}`);
if (!migrate) process.exit(0);

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
