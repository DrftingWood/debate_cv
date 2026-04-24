// Runs `prisma migrate deploy` only when the non-pooling Postgres URL
// is configured. On Vercel Preview builds without an attached database
// we silently skip instead of failing the whole deploy.

import { spawnSync } from 'node:child_process';

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DIRECT_URL;

if (!url) {
  console.log('[migrate] POSTGRES_URL_NON_POOLING unset; skipping prisma migrate deploy.');
  process.exit(0);
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
