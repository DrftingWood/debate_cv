import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_QUERY_LENGTH = 3;
const RESULT_LIMIT = 10;
const MIN_SIMILARITY = 0.5;

// Jaro-Winkler — used only to *rank* user-driven search results, never to
// auto-claim. Inlined to avoid a dependency.
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const win = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  if (win < 0) return 0;
  const aM = new Array<boolean>(a.length).fill(false);
  const bM = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - win);
    const hi = Math.min(i + win + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (!bM[j] && a[i] === b[j]) {
        aM[i] = bM[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
}

function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let p = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) p++;
    else break;
  }
  return j + p * 0.1 * (1 - j);
}

// A token-set similarity that catches "Abhishek Acharya" inside
// "Abhishek Lalatendu Acharya" — JW alone misses that.
function tokenContainmentBonus(qTokens: string[], cTokens: string[]): number {
  if (qTokens.length === 0 || cTokens.length === 0) return 0;
  const cSet = new Set(cTokens);
  const matched = qTokens.filter((t) => cSet.has(t)).length;
  return matched / qTokens.length;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  let tournamentId: bigint;
  try {
    tournamentId = BigInt(id);
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [], reason: 'query_too_short' });
  }

  // Authorization: a user can only enumerate participants of a tournament
  // they've ingested a private URL for. Without this, any logged-in user can
  // iterate `tournamentId` and pull the participant roster of every
  // tournament in the database — and then claim Persons via /api/persons/[id]/claim.
  const ownership = await prisma.discoveredUrl.findFirst({
    where: { userId: session.user.id, tournamentId },
    select: { id: true },
  });
  if (!ownership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Only consider participants that aren't already owned by someone else.
  // Users can re-claim Persons already claimed by themselves, so we include
  // their own claims in the candidate set.
  const participants = await prisma.tournamentParticipant.findMany({
    where: {
      tournamentId,
      OR: [
        { person: { claimedByUserId: null } },
        { person: { claimedByUserId: session.user.id } },
      ],
    },
    select: {
      teamName: true,
      judgeTypeTag: true,
      roles: { select: { role: true } },
      person: {
        select: {
          id: true,
          displayName: true,
          normalizedName: true,
          claimedByUserId: true,
        },
      },
    },
  });

  const normQ = normalizePersonName(q);
  const qTokens = normQ.split(/\s+/).filter(Boolean);

  type Scored = {
    personId: string;
    displayName: string;
    teamName: string | null;
    role: string;
    isMine: boolean;
    score: number;
  };
  const scored: Scored[] = [];
  for (const p of participants) {
    const norm = p.person.normalizedName;
    const cTokens = norm.split(/\s+/).filter(Boolean);
    const jw = jaroWinkler(normQ, norm);
    const containment = tokenContainmentBonus(qTokens, cTokens);
    // Combined score: JW captures typos, containment captures
    // "Abhishek Acharya" matching "Abhishek Lalatendu Acharya".
    const score = Math.max(jw, 0.3 * jw + 0.7 * containment);
    if (score < MIN_SIMILARITY) continue;
    const isJudge =
      p.roles.some((r) => r.role === 'judge') || !!p.judgeTypeTag;
    const role = isJudge ? 'Judge' : p.roles.length ? 'Speaker' : '—';
    scored.push({
      personId: p.person.id.toString(),
      displayName: p.person.displayName,
      teamName: p.teamName,
      role,
      isMine: p.person.claimedByUserId === session.user.id,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return NextResponse.json({ results: scored.slice(0, RESULT_LIMIT) });
}
