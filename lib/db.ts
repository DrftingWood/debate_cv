import { PrismaClient } from '@prisma/client';
import { DRAIN_CONCURRENCY } from '@/lib/queueDrain';

/**
 * Ensure the pooled connection string can serve the concurrent drain.
 *
 * The queue ingests several tournaments at once. Most of a job is network
 * waiting and holds no connection, but each worker still needs one for its
 * claim and — critically — for the interactive write transaction that
 * commits a tournament. With a pool smaller than the drain concurrency
 * those transactions queue on the pool rather than the network and can
 * exceed Prisma's connection timeout, surfacing as a P2024 under exactly
 * the load the concurrency was added to handle.
 *
 * Deriving it here rather than relying on the env var is deliberate:
 * Vercel's Postgres/Neon integration owns POSTGRES_PRISMA_URL and can
 * rewrite it, so a hand-edited `connection_limit` is not guaranteed to
 * survive. This keeps the pool and the concurrency consistent by
 * construction.
 *
 * Only ever RAISES the limit — an operator who set something higher keeps
 * it — and anything unparseable passes through untouched rather than
 * risking a mangled connection string.
 */
export function poolSizedUrl(raw: string | undefined, minimum: number): string | undefined {
  if (!raw) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const current = Number(url.searchParams.get('connection_limit'));
  if (Number.isFinite(current) && current >= minimum) return raw;
  url.searchParams.set('connection_limit', String(minimum));
  return url.toString();
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const datasourceUrl = poolSizedUrl(process.env.POSTGRES_PRISMA_URL, DRAIN_CONCURRENCY);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
