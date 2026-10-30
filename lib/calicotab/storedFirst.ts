import { prisma } from '@/lib/db';
import { markJobDone } from '@/lib/queue';
import { isPrivateUrl, normalizePrivateUrl, privateUrlVariants } from '@/lib/gmail/extract';
import { proximityToYou } from '@/lib/identity/nameProximity';
import { storedTournamentFresh } from './prescrape';
import { fillTournamentYearFromEmails } from './yearFromEmail';
import { PARSER_VERSION } from './version';

/**
 * Stored data first (owner decisions, 2026-10-30).
 *
 * A private URL used to be fetched before anything else, and only then was
 * the stored copy of its tournament looked up. When calicotab slowed to
 * 10-40 s a page every new user's import timed out at that first request,
 * including tournaments the pre-scrape had already stored. The work is now
 * split by what each step needs:
 *
 * - Who the user is comes from their private-URL pages, read at the Gmail
 *   step (onboarding preflight): at least ten of them, the majority name is
 *   the one pre-ticked, and the user's tick claims it.
 * - The import step needs no private-URL page for a finished tournament we
 *   have stored. The site address in the URL (host + slug) names the
 *   tournament, and the user's appearances there come from their claimed
 *   names, as they do for every tournament on the CV (buildCvData).
 * - A private-URL page is read at import only when the user's claimed names
 *   are not in that stored tournament: a forwarded link, or a spelling the
 *   user has not claimed. The live ingest reads it and links whoever it names.
 *   For a user still in onboarding (nothing claimed yet), the confirm step
 *   queues exactly those tournaments again (requeueUnmatchedStoredLinks).
 */

/**
 * C1 (B9): the one stored tournament at `http(s)://<host>/<slug>/`, or null.
 *
 * Within a Tabbycat site a slug names one tournament, so host + slug
 * identifies it whatever its title says. Every stored row's sourceUrlRaw is
 * a URL on the tournament (a private URL for an ingest, the public base for
 * a pre-scrape), so a prefix match finds it. Exactly one match is adopted;
 * several are logged and none is adopted — never guess between rows.
 */
export async function findTournamentByHostSlug(
  host: string,
  slug: string | null,
): Promise<Awaited<ReturnType<typeof prisma.tournament.findUnique>>> {
  if (!slug) return null;
  // Either scheme: private URLs have been stored as http:// as well as
  // https:// (15thiitbombaydebate, production 2026-10), and a fallback that
  // only knew one would miss exactly the rows it exists to find.
  const rows = await prisma.tournament.findMany({
    where: {
      OR: [
        { sourceUrlRaw: { startsWith: `https://${host}/${slug}/`, mode: 'insensitive' } },
        { sourceUrlRaw: { startsWith: `http://${host}/${slug}/`, mode: 'insensitive' } },
      ],
    },
    take: 2,
  });
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    console.warn('[ingest] host+slug matches more than one tournament; adopting none', {
      host,
      slug,
    });
  }
  return null;
}

type StoredTournament = NonNullable<Awaited<ReturnType<typeof findTournamentByHostSlug>>>;

/**
 * The stored tournament a private URL belongs to, if it can be served without
 * a fetch: current parser output, not marked for a re-scrape, and finished,
 * i.e. its team tab is stored (owner: finished tournaments only; a running
 * one goes the live way so its later rounds are not missed).
 */
export async function findServableStoredTournament(url: string): Promise<StoredTournament | null> {
  const normalized = normalizePrivateUrl(url);
  if (!isPrivateUrl(normalized)) return null;
  const parsed = new URL(normalized);
  const slug = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  const stored = await findTournamentByHostSlug(parsed.host, slug);
  if (!stored) return null;
  if (!storedTournamentFresh(stored) || stored.parserVersion !== PARSER_VERSION) return null;
  const teamTab = await prisma.teamResult.findFirst({
    where: { tournamentId: stored.id, roundNumber: 0 },
    select: { id: true },
  });
  return teamTab ? stored : null;
}

export type StoredParticipantMatch =
  { kind: 'match'; personId: bigint; displayName: string } | { kind: 'none' };

/**
 * The one stored participant who carries one of the user's verified names.
 *
 * Only an exact name ('match': the same name, the same words reordered, a
 * dropped middle name) counts; a close one is not evidence on its own (owner
 * rule) and goes to the page. Two participants matching is a namesake
 * problem, not an answer, and also goes to the page.
 */
export async function matchStoredParticipant(
  tournamentId: bigint,
  verifiedNames: ReadonlyArray<string>,
): Promise<StoredParticipantMatch> {
  const refs = verifiedNames.filter((r) => r.trim() !== '');
  if (refs.length === 0) return { kind: 'none' };
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId, person: { suppressedAt: null } },
    select: { person: { select: { id: true, displayName: true } } },
  });
  const matches = participants.filter(
    (p) => proximityToYou(p.person.displayName, refs) === 'match',
  );
  const one = matches.length === 1 ? matches[0] : undefined;
  return one
    ? { kind: 'match', personId: one.person.id, displayName: one.person.displayName }
    : { kind: 'none' };
}

/** The user's verified names: the names they have claimed. */
export async function claimedNamesFor(userId: string): Promise<string[]> {
  const claimed = await prisma.person.findMany({
    where: { claimedByUserId: userId },
    select: { displayName: true },
  });
  return claimed.map((p) => p.displayName);
}

export type StoredLinkResult = {
  tournamentId: bigint;
  fingerprint: string;
  totalTeams: number | null;
  totalParticipants: number | null;
  /** The participant linked as this URL's registration person, if a verified name matched. */
  personId: bigint | null;
  personName: string | null;
};

/**
 * Link a private URL to its stored, finished tournament without fetching it.
 *
 * Returns null when the URL must go the live way, which reads its page:
 * - it was linked before (a re-ingest);
 * - its tournament is not stored in a servable state;
 * - the user has verified names and none is in this tournament (a forwarded
 *   link, or a spelling they have not claimed): the page says who it is.
 *
 * A user with no verified names yet (still in onboarding) still gets the
 * tournament linked; their appearances follow from the names they confirm,
 * and confirm queues the ones their names do not reach.
 */
export async function linkFromStoredTournament(
  url: string,
  userId: string,
): Promise<StoredLinkResult | null> {
  const variants = privateUrlVariants(url);
  const discovered = await prisma.discoveredUrl.findFirst({
    where: { userId, url: { in: variants } },
    select: { ingestedAt: true },
  });
  if (discovered?.ingestedAt) return null;

  const stored = await findServableStoredTournament(url);
  if (!stored) return null;

  const verifiedNames = await claimedNamesFor(userId);
  let person: { id: bigint; name: string } | null = null;
  if (verifiedNames.length > 0) {
    const match = await matchStoredParticipant(stored.id, verifiedNames);
    if (match.kind === 'none') return null;
    person = { id: match.personId, name: match.displayName };
  }

  await prisma.discoveredUrl.updateMany({
    where: { userId, url: { in: variants } },
    data: {
      tournamentId: stored.id,
      ingestedAt: new Date(),
      ...(person ? { registrationPersonId: person.id } : {}),
    },
  });
  // The pre-scrape stores no date; this user's email gives a yearless
  // tournament its year.
  await fillTournamentYearFromEmails(stored.id);

  return {
    tournamentId: stored.id,
    fingerprint: stored.fingerprint,
    totalTeams: stored.totalTeams,
    totalParticipants: stored.totalParticipants,
    personId: person?.id ?? null,
    personName: person?.name ?? null,
  };
}

/**
 * The stored pass: link every pending job whose tournament is stored and
 * finished, before the queue proper runs (owner, 2026-10-30).
 *
 * The queue is first come, first served, and runs one calicotab job at a
 * time. A stored tournament needs no request, but it used to wait for that
 * slot behind live scrapes taking minutes, so a user whose links were nearly
 * all pre-scraped still waited on the one or two that were not. This pass
 * reads only the database, so it runs ahead of the queue and outside the
 * host slot; what it cannot link is left pending, attempt untouched, for the
 * queue to fetch the live way.
 *
 * Each job is claimed (pending to running) before it is linked, so a drain
 * running at the same moment never handles it twice. Returns how many were
 * linked.
 */
export async function linkStoredJobsFirst(params: { userId?: string } = {}): Promise<number> {
  const jobs = await prisma.ingestJob.findMany({
    where: {
      status: 'pending',
      scheduledAt: { lte: new Date() },
      ...(params.userId ? { userId: params.userId } : {}),
    },
    orderBy: { scheduledAt: 'asc' },
    select: { id: true, userId: true, url: true },
  });
  let linked = 0;
  for (const job of jobs) {
    if (!(await findServableStoredTournament(job.url))) continue;
    const claim = await prisma.ingestJob.updateMany({
      where: { id: job.id, status: 'pending' },
      data: { status: 'running', startedAt: new Date() },
    });
    if (claim.count === 0) continue;
    let result: StoredLinkResult | null = null;
    try {
      result = await linkFromStoredTournament(job.url, job.userId);
    } finally {
      if (!result) {
        // Not linkable from storage after all (the user's names are not in
        // it): back to the queue as it was, for the page to be read.
        await prisma.ingestJob.updateMany({
          where: { id: job.id, status: 'running' },
          data: { status: 'pending', startedAt: null },
        });
      }
    }
    if (result) {
      await markJobDone(job.id);
      linked += 1;
    }
  }
  return linked;
}

/**
 * After the user confirms their names: queue again every tournament linked
 * from storage that none of those names reaches, so its private-URL page is
 * read (the live way, as the URL is now linked) and names whoever it is for.
 * Returns how many jobs were queued.
 */
export async function requeueUnmatchedStoredLinks(userId: string): Promise<number> {
  const unmatched = await prisma.discoveredUrl.findMany({
    where: {
      userId,
      tournamentId: { not: null },
      ingestedAt: { not: null },
      registrationPersonId: null,
      reingestLocked: false,
      tournament: {
        participants: { none: { person: { claimedByUserId: userId } } },
      },
    },
    select: { url: true },
  });
  if (unmatched.length === 0) return 0;
  const { count } = await prisma.ingestJob.updateMany({
    where: { userId, url: { in: unmatched.map((u) => u.url) }, status: { not: 'running' } },
    data: {
      status: 'pending',
      attempts: 0,
      lastError: null,
      scheduledAt: new Date(),
      startedAt: null,
      finishedAt: null,
    },
  });
  return count;
}
