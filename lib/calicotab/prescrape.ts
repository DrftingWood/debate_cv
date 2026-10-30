import { isAllowedTabHost } from '@/lib/gmail/extract';
import { normalizeStageLabel } from './judgeStats';
import type { RoundDebate } from './parseTabs';

/**
 * Pure helpers behind the B9 pre-scrape (ingest.ts prescrapeTournament).
 * Design: docs/superpowers/specs/2026-10-25-b9-prescrape-design.md.
 */

/**
 * The public base of a tournament — `https://<host>/<slug>/` — from any URL
 * on it, for the pre-scrape. Throws for anything that is not a public
 * tournament page on an allowed tab host:
 *   - a private URL: the pre-scrape reads public pages only, and a private
 *     URL is someone's identity, which only their own ingest may use;
 *   - no slug (a root-hosted tournament): its private URLs carry a slug its
 *     public URL lacks, so the fingerprints would not meet and the stored
 *     row could never be matched (design: "Identification").
 */
export function publicTournamentBase(url: string): { base: string; host: string; slug: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a URL: ${url.slice(0, 120)}`);
  }
  if (
    parsed.protocol !== 'https:' ||
    !isAllowedTabHost(parsed.hostname) ||
    parsed.port ||
    parsed.username
  ) {
    throw new Error(`not an allowed tab host: ${parsed.host}`);
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === 'privateurls')) {
    throw new Error('refusing a private URL: the pre-scrape reads public pages only');
  }
  const slug = parts[0];
  if (!slug)
    throw new Error(
      `no tournament slug in ${parsed.host}: root-hosted tournaments are not pre-scraped`,
    );
  return { base: `https://${parsed.host}/${slug}/`, host: parsed.host, slug };
}

/** A scrapedAt before this is the "never scraped" marker Re-ingest all writes (epoch). */
const NEVER_SCRAPED_BEFORE = new Date('2000-01-01T00:00:00Z');

/**
 * Is a stored tournament complete enough to serve without re-scraping?
 *
 * Age no longer matters. A stored tournament is served from the database
 * however long ago it was scraped: its tabs do not change once the rounds
 * are out, and a calendar window (the earlier 30 days / one year) only
 * re-scraped finished tournaments for nothing (design: "Match flow"). What
 * still forces a refresh is that the data may be incomplete, and the callers
 * check that separately: the landing page advertising more result rounds
 * than are stored (checkCacheFreshness), a parser-version bump, or a forced
 * re-ingest. Re-ingest all marks rows by writing an epoch scrapedAt, which is
 * never fresh (#124).
 */
export function storedTournamentFresh(existing: { scrapedAt: Date; year: number | null }): boolean {
  return existing.scrapedAt.getTime() >= NEVER_SCRAPED_BEFORE.getTime();
}

/**
 * Has the tournament published a team or speaker tab that we have not stored?
 *
 * Once the last round and both tabs are out, nothing more is released, so a
 * stored tournament is complete. `discovered` is the landing page's
 * navigation meta: a tab only appears there once Tabbycat links it (a tab we
 * merely constructed a URL for does not count). The team tab is stored as the
 * roundNumber=0 TeamResult rows, the speaker tab as speaker score totals on
 * the participants.
 *
 * The motions page is deliberately NOT judged here. Tabbycat can link
 * /motions/ before any motion is released, and a blocked or unparseable page
 * leaves zero rows, so "linked and none stored" would re-scrape the whole
 * tournament on every load. It is judged by motionsGained below instead.
 *
 * Re-scrape triggers, all told (rule 2 of the ingest freshness rules):
 *   1. the landing page advertises more result rounds than are stored;
 *   2. this function: a linked team tab or speaker tab is not stored; or
 *      motionsGained: the motions page lists more motions than are stored
 *      (owner rule I49: a later release, e.g. outround motions, re-scrapes);
 *   3. a PARSER_VERSION bump (owner-accepted, I50), or Re-ingest all's epoch scrapedAt;
 *   4. an admin forces it (I53; app/api/ingest/url and lib/admin.ts).
 * Age alone never triggers one.
 */
export function releasedTabMissing(
  discovered: readonly string[],
  stored: { hasTeamTab: boolean; hasSpeakerTab: boolean },
): boolean {
  if (discovered.includes('teamTab') && !stored.hasTeamTab) return true;
  if (discovered.includes('speakerTab') && !stored.hasSpeakerTab) return true;
  return false;
}

/**
 * Does the motions page list more motions than are stored? Counted as they
 * are stored, one per (round label, seq), so a page that repeats a motion does
 * not look like a release. An empty page, or one that lists no more than we
 * hold, never re-scrapes: that is what keeps a withheld, blocked or
 * unparseable page from looping.
 */
export function motionsGained(
  storedCount: number,
  parsed: ReadonlyArray<{ roundLabel: string; seq: number }>,
): boolean {
  const distinct = new Set(parsed.map((m) => `${m.roundLabel}|${m.seq}`));
  return distinct.size > storedCount;
}

/**
 * In-memory guard so repeated loads of one tournament in the same server
 * instance do not each fetch the motions page. Per-instance on purpose: the
 * worst case on a cold instance is one cheap request, and no schema is needed.
 */
const MOTIONS_CHECK_WINDOW_MS = 10 * 60_000;
const motionsCheckedAt = new Map<bigint, number>();

/** True (and starts the window) when this tournament's motions page may be fetched now. */
export function motionsCheckDue(tournamentId: bigint, now: number = Date.now()): boolean {
  const last = motionsCheckedAt.get(tournamentId);
  if (last !== undefined && now - last < MOTIONS_CHECK_WINDOW_MS) return false;
  motionsCheckedAt.set(tournamentId, now);
  return true;
}

export function resetMotionsChecks(): void {
  motionsCheckedAt.clear();
}

export type JudgeHit = {
  stage: string;
  role: 'chair' | 'panellist' | 'trainee';
  roundNumber: number | null;
};

/**
 * Every panel seat in `rounds` whose judge `matches`, as JudgeAssignment
 * shapes: the stage label normalised as the landing path does, the role
 * (a trainee stays a trainee — filing one as a panellist would credit a
 * non-voting seat), and the round number for prelims only. Shared by the
 * URL owner's round-results fallback and the pre-scrape's every-judge
 * writer, so both read panels identically.
 */
export function judgeHitsFromRounds(
  rounds: RoundDebate[],
  matches: (judgeName: string) => boolean,
): JudgeHit[] {
  const hits: JudgeHit[] = [];
  for (const round of rounds) {
    if (!round) continue;
    const { stage, roundNumber } = judgeRoundKey(round);
    for (const j of round.judgeAssignments) {
      if (!matches(j.personName)) continue;
      hits.push({
        stage,
        role:
          j.panelRole === 'chair' ? 'chair' : j.panelRole === 'trainee' ? 'trainee' : 'panellist',
        roundNumber,
      });
    }
  }
  return hits;
}

/**
 * How a round's JudgeAssignment rows are keyed: by round number for a prelim,
 * by normalised stage label for an outround (whose number is stored null).
 */
function judgeRoundKey(round: RoundDebate): { stage: string; roundNumber: number | null } {
  const stage = normalizeStageLabel(
    round.roundLabel ||
      (round.isOutround
        ? round.roundNumber != null
          ? `Round ${round.roundNumber}`
          : 'Outround'
        : `Round ${round.roundNumber ?? '?'}`),
  );
  return { stage, roundNumber: round.isOutround ? null : round.roundNumber };
}

export type JudgeRowScope = {
  OR: ({ roundNumber: { in: number[] } } | { roundNumber: null; stage: { in: string[] } })[];
};

/**
 * The JudgeAssignment rows that the given rounds own, as a Prisma `where`
 * fragment, so a rewrite from them replaces only what they cover. Since
 * partial scrapes (owner decision 2026-10-30), a round page can fail while
 * the rest of the tournament is written, and a wholesale delete would then
 * drop the failed round's stored panels with nothing to replace them. Null
 * when no round loaded: there is nothing to replace, so delete nothing. Keys
 * match judgeHitsFromRounds exactly: prelims by number (any stage), anything
 * stored without a number by its stage.
 */
export function judgeRowsOwnedByRounds(
  rounds: (RoundDebate | null | undefined)[],
): JudgeRowScope | null {
  const numbers = new Set<number>();
  const stages = new Set<string>();
  for (const round of rounds) {
    if (!round) continue;
    const key = judgeRoundKey(round);
    if (key.roundNumber != null) numbers.add(key.roundNumber);
    else stages.add(key.stage);
  }
  const OR: JudgeRowScope['OR'] = [];
  if (numbers.size > 0) OR.push({ roundNumber: { in: [...numbers] } });
  if (stages.size > 0) OR.push({ roundNumber: null, stage: { in: [...stages] } });
  return OR.length > 0 ? { OR } : null;
}

/** One row per (stage, role, round): the JudgeAssignment unique, with NULL rounds deduped too. */
export function dedupeJudgeHits(hits: JudgeHit[]): JudgeHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.stage}|${h.role}|${h.roundNumber ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Path segments a Tabbycat site serves at its root that are not tournaments.
 * A root page links these on every install, alongside the tournaments.
 */
const NON_TOURNAMENT_SEGMENTS = new Set([
  'accounts',
  'admin',
  'api',
  'database',
  'static',
  'jet',
  'i18n',
  'login',
  'logout',
  'notifications',
  'style',
  'archive',
  'create',
  'donate',
  'blank',
  'about',
]);

/**
 * The tournament slugs a site's root page links to (`/<slug>/` on the same
 * host), for resolving a root-hosted corpus entry. The caller pre-scrapes
 * only when exactly one comes back: several tournaments on one root, or
 * none, and there is no telling which the entry meant.
 */
export function tournamentSlugsFromRootPage(html: string, host: string): string[] {
  const slugs = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#?]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(m[1]!, `https://${host}/`);
    } catch {
      continue;
    }
    if (u.host !== host) continue;
    const seg = u.pathname.split('/').filter(Boolean)[0];
    if (!seg || NON_TOURNAMENT_SEGMENTS.has(seg.toLowerCase())) continue;
    if (!/^[A-Za-z0-9_-]+$/.test(seg)) continue;
    slugs.add(seg);
  }
  return [...slugs];
}

/**
 * The tournaments a root-hosted entry stands for. One link: that tournament.
 * Several: all of them, except those whose slug names a year after `maxYear`
 * (a root such as tido2025 also links the not-yet-played tido2026). A slug
 * with no year is kept. Nothing linked: none, so the caller skips the entry.
 */
export function expandRootSlugs(slugs: string[], maxYear: number): string[] {
  return slugs.filter((slug) => {
    const years = [...slug.matchAll(/(?:^|[^0-9])((?:19|20)[0-9]{2})(?![0-9])/g)].map((m) =>
      Number(m[1]),
    );
    return years.length === 0 || Math.max(...years) <= maxYear;
  });
}

/**
 * Which of `total` shards a tournament belongs to, decided by its HOST.
 *
 * The load is split across parallel jobs to finish sooner. Sharding by host
 * (not by position in the list) keeps every tournament of one site in one
 * shard, so a host such as edudrift.calicotab.com (several tournaments) is
 * only ever fetched by one job at a time and the per-host politeness of the
 * ingest still holds. Deterministic and independent of list order, so a
 * shard re-run after a failure picks up exactly the same tournaments.
 */
export function shardOf(url: string, total: number): number {
  if (!Number.isInteger(total) || total < 1)
    throw new Error(`shard count must be a positive integer, got ${total}`);
  const host = new URL(url).hostname.toLowerCase();
  let h = 0;
  for (const ch of host) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % total;
}

/** "2/4" -> shard index 2 of 4; unset -> null (the whole list). Nonsense throws, never loads a wrong slice. */
export function parseShard(spec: string | undefined): { index: number; total: number } | null {
  if (spec === undefined || spec.trim() === '') return null;
  const m = spec.trim().match(/^(\d+)\/(\d+)$/);
  if (!m) throw new Error(`PRESCRAPE_SHARD must look like "2/4", got "${spec}"`);
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1 || index >= total)
    throw new Error(`PRESCRAPE_SHARD index must be below the total, got "${spec}"`);
  return { index, total };
}
