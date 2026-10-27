// Decides whether the build should run `prisma migrate deploy`.
// Pure function of the environment so it can be unit-tested.

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ migrate: boolean, reason: string }}
 */
export function shouldMigrate(env) {
  const url = env.POSTGRES_URL_NON_POOLING || env.DIRECT_URL;
  if (!url) {
    return {
      migrate: false,
      reason: 'POSTGRES_URL_NON_POOLING unset; skipping prisma migrate deploy.',
    };
  }
  if (env.VERCEL === '1' && env.VERCEL_ENV !== 'production') {
    const kind = env.VERCEL_ENV || 'non-production';
    if (env.ALLOW_PREVIEW_MIGRATIONS === '1') {
      return {
        migrate: true,
        reason: `Vercel ${kind} build with ALLOW_PREVIEW_MIGRATIONS=1; running prisma migrate deploy.`,
      };
    }
    return {
      migrate: false,
      reason:
        `Vercel ${kind} build: skipping prisma migrate deploy so an unmerged migration cannot ` +
        'touch a shared or production database. Migrations run only for production deployments. ' +
        'To force it for a preview that has its OWN isolated database, set ALLOW_PREVIEW_MIGRATIONS=1.',
    };
  }
  return { migrate: true, reason: 'running prisma migrate deploy.' };
}
