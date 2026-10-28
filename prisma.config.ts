import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads the datasource URL from schema.prisma or loads .env
// itself. The CLI (migrate, db execute) uses the DIRECT connection; the app
// connects at runtime through the pg adapter in lib/db.ts using the pooled URL.
// Read with process.env, not env(): env() throws when the variable is unset,
// which would break `prisma generate` on installs with no database (CI, fresh
// clones). Commands that do connect fail with their own error when it is
// empty, and scripts/migrate-if-configured.mjs skips migrating without it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.POSTGRES_URL_NON_POOLING ?? '' },
});
