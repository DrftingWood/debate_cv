import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

function serialize(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serialize(v);
    }
    return out;
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  // Decimal / Prisma types with toString()
  if (value && typeof (value as { toString: unknown }).toString === 'function') {
    return String(value);
  }
  return null;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const [user, discoveredUrls, ingestJobs, claimedPersons] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.discoveredUrl.findMany({
        where: { userId },
        include: { tournament: true, registrationPerson: true },
      }),
      prisma.ingestJob.findMany({ where: { userId } }),
      prisma.person.findMany({
        where: { claimedByUserId: userId },
        include: {
          participations: {
            include: {
              tournament: true,
              roles: true,
              speakerRoundScores: { orderBy: { roundNumber: 'asc' } },
            },
          },
        },
      }),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      user: serialize(user),
      discoveredUrls: serialize(discoveredUrls),
      ingestJobs: serialize(ingestJobs),
      claimedPersons: serialize(claimedPersons),
    };

    const body = JSON.stringify(payload, null, 2);
    const filename = `debate-cv-export-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/account/export]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
