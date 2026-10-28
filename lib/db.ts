import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DRAIN_CONCURRENCY } from '@/lib/queueDrain';

/**
 * Pool settings for the pg driver adapter, derived from the pooled URL.
 *
 * The queue ingests several tournaments at once. Most of a job is network
 * waiting and holds no connection, but each worker still needs one for its
 * claim and — critically — for the interactive write transaction that
 * commits a tournament. With a pool smaller than the drain concurrency
 * those transactions queue on the pool rather than the network and can
 * exceed the connection timeout, surfacing as a pool timeout under exactly
 * the load the concurrency was added to handle.
 *
 * Deriving it here rather than relying on the env var is deliberate:
 * Vercel's Postgres/Neon integration owns POSTGRES_PRISMA_URL and can
 * rewrite it, so a hand-edited `connection_limit` is not guaranteed to
 * survive. This keeps the pool and the concurrency consistent by
 * construction.
 *
 * Prisma 6 read `connection_limit`, `pool_timeout` and `connect_timeout`
 * from the URL itself. The pg adapter does not, and would pass them to the
 * driver as unknown options, so they are read here and removed from the
 * connection string. Defaults match Prisma 6: a 10 s wait for a pooled
 * connection (which pg also uses as its connect timeout).
 *
 * Only ever RAISES the pool size — an operator who set something higher keeps
 * it — and anything unparseable passes through untouched rather than
 * risking a mangled connection string.
 */
export type PoolConfig = { connectionString: string; max: number; connectionTimeoutMillis: number };

// pg treats these three as 'verify-full' today (full certificate check) and
// warns that pg v9 will switch them to the weaker libpq meaning. Saying
// 'verify-full' outright keeps the strict check across that upgrade.
const IMPLICIT_VERIFY_FULL = new Set(['prefer', 'require', 'verify-ca']);

const PRISMA_ONLY_PARAMS = ['connection_limit', 'pool_timeout', 'connect_timeout', 'pgbouncer'];

export function poolConfig(raw: string | undefined, minimum: number): PoolConfig | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { connectionString: raw, max: minimum, connectionTimeoutMillis: 10_000 };
  }
  const seconds = (name: string): number | undefined => {
    const n = Number(url.searchParams.get(name));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const limit = seconds('connection_limit');
  const wait = seconds('pool_timeout') ?? seconds('connect_timeout') ?? 10;
  for (const name of PRISMA_ONLY_PARAMS) url.searchParams.delete(name);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode && IMPLICIT_VERIFY_FULL.has(sslmode) && !url.searchParams.has('uselibpqcompat')) {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return {
    connectionString: url.toString(),
    max: Math.max(limit ?? 0, minimum),
    connectionTimeoutMillis: wait * 1000,
  };
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const UNCONFIGURED: PoolConfig = {
  connectionString: 'postgresql://unset:unset@POSTGRES_PRISMA_URL-is-not-set.invalid/db',
  max: 1,
  connectionTimeoutMillis: 1000,
};

const pool = poolConfig(process.env.POSTGRES_PRISMA_URL, DRAIN_CONCURRENCY);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Prisma 7 refuses to construct without an adapter, and this module is
    // imported at build time and in unit tests where no database is attached.
    // pg connects lazily, so the placeholder host only surfaces when a query
    // runs, and its name says what was missing.
    adapter: new PrismaPg(pool ?? UNCONFIGURED),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
