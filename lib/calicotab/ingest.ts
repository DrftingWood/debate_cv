import * as Sentry from '@sentry/nextjs';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { auditAfterScrape } from '@/lib/audit/run';
import {
  FETCH_MIN_INTERVAL_MS,
  fetchHtmlWithProvenance,
  LANDING_FETCH_TIMEOUT_MS,
  fetchRoundWithProvenance,
  isCdnRateLimit,
  isWithheldByTournament,
  withApiSnapshots,
} from './fetch';
import { FetchSession, IngestDeadlineError, isIngestDeadlineError } from './fetchSession';
import { findTournamentByHostSlug, linkFromStoredTournament } from './storedFirst';
import { fillTournamentYearFromEmails } from './yearFromEmail';
import {
  API_TIMEOUT_MS,
  apiBaseFromTournamentUrl,
  fetchTabsFromApi,
  htmlOnly,
  htmlTabsToFetch,
  unreleasedTabWarnings,
  tabbycatApiTabsEnabled,
  type ApiTabsResult,
} from './tabbycatApi';
import { fetchRestFromApi, tabbycatApiRoundsEnabled } from './tabbycatApiRounds';
import {
  apiTabsForPieces,
  clearPieces,
  navForPieces,
  partialWarning,
  pieceLoaded,
  pieceOutcome,
  pieceRefForUrl,
  piecesToClear,
  recordPieceOutcomes,
  wantsPiece,
  type PieceKind,
  type PieceOutcome,
  type PieceRef,
} from './scrapePieces';
import { emptyRoundOutcome, roundPublishedEmpty, unpublishedTabOutcomes } from './unpublished';
import {
  dedupeJudgeHits,
  judgeHitsFromRounds,
  judgeRowsOwnedByRounds,
  publicTournamentBase,
  releasedTabMissing,
  motionsGained,
  motionsCheckDue,
  storedTournamentFresh,
} from './prescrape';
import { parsePrivateUrlPage, extractAdjudicatorRounds, extractSpeakerRounds } from './parseNav';
import {
  parseTeamTab,
  parseSpeakerTab,
  parseRoundResults,
  parseBreakPage,
  parseParticipantsList,
  diagnoseVueData,
  type BreakRow,
  type RoundDebate,
} from './parseTabs';
import { parseMotionsTab } from './parseMotions';
import {
  candidateFingerprints,
  computeFingerprint,
  extractYearFromName,
  inferTournamentYear,
  normalizePersonName,
} from './fingerprint';
import { refuseDeletedSite } from '@/lib/admin/deletedTournaments';
import { PARSER_VERSION } from './version';
import { publicTournamentUrl } from '@/lib/cv/publicTournamentUrl';
import { collectRegistrationWarnings, recordParserRun } from './provenance';
import { inferTournamentFormat } from './format';
import { compareOutroundDepth, outroundRankStrict } from './judgeStats';
import {
  computeJudgeAggregates,
  writeJudgeParticipantRole,
  type JudgeRound,
} from './judgeAggregates';
import { resolveTeamBreaks } from './breakCategoryResolve';
import { buildPersonIndex, findPersonId, personNameMatches } from './personMatch';
import { buildPrimaryTeamMap } from './primaryTeam';
import { findRedactedOwnerRow } from './redactedSpeaker';
import { recordRedactedSpeakers, redactedSpeakersByTeam } from './redactedCounts';
import { isPlaceholderPersonName } from './names';
import { rematchStaffNames } from './staffStore';
import {
  assignMotionRounds,
  isPrelimRoundLabel,
  prelimRoundsFromNav,
  speakerColumnRounds,
} from './roundNumbers';
import { isPrivateUrl, normalizePrivateUrl, privateUrlVariants } from '@/lib/gmail/extract';

type IngestResult = {
  tournamentId: bigint;
  fingerprint: string;
  cached: boolean;
  claimedPersonId: bigint | null;
  claimedPersonName: string | null;
  parserVersion: string;
  totalTeams: number | null;
  totalParticipants: number | null;
  warnings: string[];
};

// ─── Phase function types ─────────────────────────────────────────────────
//
// The orchestrator (ingestPrivateUrl) is a thin wrapper that threads typed
// state through ~8 phase functions. Each phase takes a typed input
// (usually a previous phase's output plus the original userId/options)
// and returns its own typed output. The fetchWarnings buffer is the one
// exception: it's a mutable string[] that crosses phase boundaries by
// reference (every .push() site is preserved unchanged). Keeping it
// mutable is the lower-risk choice — fully functional warnings threading
// would require touching every existing push site.

type LoadedState = {
  normalized: string;
  urlVariants: string[];
  parsedUrl: URL;
  tournamentSlug: string | null;
  fetchSession: FetchSession;
  landingDoc: Extract<Awaited<ReturnType<typeof fetchHtmlWithProvenance>>, { ok: true }>;
  landingHtml: string;
  snapshot: ReturnType<typeof parsePrivateUrlPage>;
  fetchWarnings: string[]; // mutable buffer — accumulates across phases 1-3
  landingWarnings: string[];
  privateUrlSentAt: Date | null;
  tournamentFingerprint: string;
  existing: Awaited<ReturnType<typeof prisma.tournament.findUnique>>;
  parseStart: number;
  year: number | null;
};

type CacheCheckResult = { kind: 'cache-hit'; result: IngestResult } | { kind: 'miss' };

type FetchedTabs = {
  teamRows: ReturnType<typeof parseTeamTab>;
  speakerRows: ReturnType<typeof parseSpeakerTab>;
  mergedParticipantRows: ReturnType<typeof parseParticipantsList>;
  rounds: ReturnType<typeof parseRoundResults>[];
  breakRows: ReturnType<typeof parseBreakPage>;
  motions: ReturnType<typeof parseMotionsTab>;
  tournamentName: string;
  totalParticipants: number | null;
  /**
   * Whether totalParticipants was counted from the participants list (page or
   * API) rather than from the landing card / speaker rows it falls back to.
   * The regression guard only compares like with like; see checkRegressionGuard.
   */
  participantsFromList: boolean;
  totalTeams: number | null;
  prelimRoundCount: number | null;
  format: ReturnType<typeof inferTournamentFormat>;
  teamBreakRankByTeam: Map<string, number>;
  /** Redacted speakers per team from the participants list; null when it was not read. */
  redactedByTeam: Map<string, number> | null;
  fetchLevelFailures: string[];
  /** One per page the scrape tried; an API answer counts for the tab it stands in for. */
  pieceOutcomes: PieceOutcome[];
  /** The pieces that loaded (outcomes with ok), for a partial re-scrape's scoped deletes. */
  fetchedPieces: PieceRef[];
  /**
   * Pieces the tournament never published (unlinked tabs, empty round pages),
   * recorded as withheld beside the outcomes. Kept apart from them so no
   * `!ok` test (nothing-loaded abort, whole-tournament refresh) reads one as a failure.
   */
  unpublishedPieces: PieceOutcome[];
};

type RegressionGuardResult =
  { kind: 'regression-blocked'; result: IngestResult } | { kind: 'proceed' };

type PersonContext = {
  personIdByNormalized: Map<string, bigint>;
  lookupPersonId: (name: string) => bigint | null;
};

type TxResult = {
  tournamentId: bigint;
  speakerRoundScoreCreates: Prisma.SpeakerRoundScoreCreateManyInput[];
  speakerParticipantIds: bigint[];
};

export async function ingestPrivateUrl(
  url: string,
  userId: string,
  options: {
    force?: boolean;
    /**
     * Epoch ms by which this ingest must have stopped — the caller's function
     * budget. Past it, fetches refuse to start and the write phase will not
     * begin without its write reserve left (writeReserveMs); either way the ingest throws
     * IngestDeadlineError having written nothing. Omitted: no limit.
     */
    deadline?: number;
  } = {},
): Promise<IngestResult> {
  // A tab an admin deleted is never stored again (deletedTournaments.ts).
  await refuseDeletedSite(url);
  // Stored data first (owner, 2026-10-30): a URL whose tournament is already
  // stored is linked without a request; its page is fetched later to verify.
  if (!options.force) {
    const stored = await storedFirstResult(url, userId);
    if (stored) return stored;
  }
  const loaded = await loadLandingAndFingerprint(url, userId, options.deadline);
  const cacheCheck = await checkCacheFreshness(loaded, userId, options);
  if (cacheCheck.kind === 'cache-hit') return cacheCheck.result;

  // Concurrent-scrape guard. The advisory lock in writeIngestTransaction
  // serializes the WRITES, but two cache-miss ingests of the same
  // tournament would both have run the ~15-fetch tab phase by then. Claim
  // the scrape slot first; if another ingest holds it, wait briefly for
  // it to finish and serve their result from cache. If the wait times out
  // (slow scrape, crashed holder) we proceed unclaimed — correctness is
  // still guaranteed by the write lock, we just lose the fetch dedup.
  // First-ever ingests (no Tournament row to claim on) skip the guard;
  // the queue drains serially per process, so that window is narrow.
  const claim = await acquireScrapeClaim(loaded.existing?.id ?? null);
  if (claim === 'busy') {
    const settled = await awaitConcurrentScrape(loaded, userId, options);
    if (settled) return settled;
  }

  try {
    return await runFullScrape(loaded, userId, options);
  } catch (err) {
    // Release an acquired claim on failure so the next attempt (queue
    // retry, other user) doesn't have to wait out the TTL.
    if (claim === 'acquired' && loaded.existing) {
      await releaseScrapeClaim(loaded.existing.id);
    }
    throw err;
  }
}

export { findTournamentByHostSlug } from './storedFirst';

export type PrescrapeResult = {
  /** written: scraped and stored; current: already stored, fresh and at this parser version; blocked: the regression guard refused the overwrite. */
  status: 'written' | 'current' | 'blocked';
  base: string;
  tournamentId: bigint | null;
  fingerprint: string;
  name: string | null;
  totalTeams: number | null;
  totalParticipants: number | null;
  judgesWritten: number;
  warnings: string[];
};

/**
 * A tournament's public landing page, read with a fresh FetchSession, and the
 * stored row it matches (by fingerprint, then by host and slug), ready for
 * runFullScrape with no owner. Shared by the pre-scrape and the partial
 * re-scrape (partialScrape.ts) so both identify a tournament the same way.
 * A public page has no registration card; it is forced empty so nothing
 * owner-shaped can reach the write phase.
 */
export async function loadPublicLanding(
  url: string,
  deadline?: number,
): Promise<{ base: string; fingerprint: string; loaded: LoadedState }> {
  const { base, host, slug } = publicTournamentBase(url);
  // Before any fetch: a tab an admin deleted is never stored again. This
  // covers the pre-scrape and the partial re-scrape, which both start here.
  await refuseDeletedSite(base);
  const fetchSession = new FetchSession({ deadline });
  const landingResult = await fetchHtmlWithProvenance(base, { session: fetchSession });
  // The status rides on the error so a partial re-scrape can record it
  // against the pieces it never reached (partialScrape.ts).
  if (!landingResult.ok)
    throw Object.assign(new Error(`fetch public home ${base} → HTTP ${landingResult.status}`), {
      httpStatus: landingResult.status,
    });
  const parseStart = Date.now();
  const parsed = parsePrivateUrlPage(landingResult.html, base);
  const snapshot = {
    ...parsed,
    registration: { personName: null, teamName: null, speakers: [], institution: null },
  };
  const name = snapshot.tournamentName;
  const explicitYear = extractYearFromName(name);
  let existing: LoadedState['existing'] = null;
  // inferredYear null: candidateFingerprints gives the explicit-year
  // fingerprint, or the null-year one a private ingest also tries.
  for (const candidate of candidateFingerprints({
    host,
    tournamentSlug: slug,
    tournamentName: name,
    explicitYear,
    inferredYear: null,
  })) {
    existing = await prisma.tournament.findUnique({ where: { fingerprint: candidate } });
    if (existing) break;
  }
  if (!existing) existing = await findTournamentByHostSlug(host, slug);
  const fingerprint =
    existing?.fingerprint ??
    computeFingerprint({ host, tournamentSlug: slug, tournamentName: name, year: explicitYear });
  return {
    base,
    fingerprint,
    loaded: {
      normalized: base,
      urlVariants: [],
      parsedUrl: new URL(base),
      tournamentSlug: slug,
      fetchSession,
      landingDoc: landingResult,
      landingHtml: landingResult.html,
      snapshot,
      fetchWarnings: [],
      landingWarnings: [],
      privateUrlSentAt: null,
      tournamentFingerprint: fingerprint,
      existing,
      parseStart,
      year: explicitYear,
    },
  };
}

/**
 * B9: store a tournament from its PUBLIC pages, with no owner, so that a
 * user's later private-URL ingest is served from storage by the cache path.
 * Design: docs/superpowers/specs/2026-10-25-b9-prescrape-design.md.
 *
 * The same tab and write phases as a cache-miss ingest (runFullScrape) with
 * no user: nothing is claimed or linked, no DiscoveredUrl is written, and the
 * registration snapshot is forced empty. Afterwards it records every judge's
 * panels from the round results (recordEveryJudgeFromRoundResults) — the
 * cache path has no rounds to read them from when a judge later ingests.
 *
 * Refuses private URLs and root-hosted URLs (publicTournamentBase). A stored
 * tournament that is fresh and at the current PARSER_VERSION is left alone
 * unless `force`; the runner relies on that to resume and to re-scrape only
 * what a parser bump invalidated.
 */
export async function prescrapeTournament(
  url: string,
  options: { force?: boolean; deadline?: number } = {},
): Promise<PrescrapeResult> {
  const { base, fingerprint, loaded } = await loadPublicLanding(url, options.deadline);
  const { existing } = loaded;
  const name = loaded.snapshot.tournamentName;

  const summary = (
    status: PrescrapeResult['status'],
    extra: Partial<PrescrapeResult> = {},
  ): PrescrapeResult => ({
    status,
    base,
    tournamentId: existing?.id ?? null,
    fingerprint,
    name,
    totalTeams: existing?.totalTeams ?? null,
    totalParticipants: existing?.totalParticipants ?? null,
    judgesWritten: 0,
    warnings: [],
    ...extra,
  });
  if (
    existing &&
    !options.force &&
    existing.parserVersion === PARSER_VERSION &&
    storedTournamentFresh(existing)
  ) {
    return summary('current');
  }

  const claim = await acquireScrapeClaim(existing?.id ?? null);
  if (claim === 'busy') throw new ScrapeBusyError(base);
  let judgesWritten = 0;
  try {
    const result = await runFullScrape(
      loaded,
      null,
      { force: options.force },
      async ({ fetched, persons, tournamentId }) => {
        judgesWritten = await recordEveryJudgeFromRoundResults(
          fetched.rounds,
          tournamentId,
          persons.lookupPersonId,
        );
      },
    );
    const blocked = result.warnings.includes('regression-guard: overwrite blocked');
    return summary(blocked ? 'blocked' : 'written', {
      tournamentId: result.tournamentId,
      totalTeams: result.totalTeams,
      totalParticipants: result.totalParticipants,
      judgesWritten,
      warnings: result.warnings,
    });
  } finally {
    if (existing) await releaseScrapeClaim(existing.id);
  }
}

/**
 * B9: every judge's panels from the round results, for a pre-scraped
 * tournament. Replaces the tournament's `round_results` rows for the rounds
 * that loaded — the pre-scrape owns all of them (design, point 2), but a
 * round page that failed keeps its stored panels until a retry loads it
 * (partial scrapes, 2026-10-30) — and fills each
 * judge's aggregates the way the URL owner's fallback does (fillNullsOnly,
 * so a landing-derived value is never overwritten).
 *
 * Names are matched exactly (normalised), not fuzzily: the owner's writer
 * may fuzzy-match because it knows whose rounds it wants; here a fuzzy match
 * would credit one judge with a similarly named judge's panels.
 */
export async function recordEveryJudgeFromRoundResults(
  rounds: FetchedTabs['rounds'],
  tournamentId: bigint,
  lookupPersonId: PersonContext['lookupPersonId'],
): Promise<number> {
  const byPerson = new Map<bigint, ReturnType<typeof judgeHitsFromRounds>>();
  const names = new Set<string>();
  for (const round of rounds) for (const j of round.judgeAssignments) names.add(j.personName);
  for (const name of names) {
    const personId = lookupPersonId(name);
    if (personId == null) continue;
    const norm = normalizePersonName(name);
    const hits = judgeHitsFromRounds(rounds, (n) => normalizePersonName(n) === norm);
    byPerson.set(personId, dedupeJudgeHits([...(byPerson.get(personId) ?? []), ...hits]));
  }
  const data = [...byPerson.entries()].flatMap(([personId, hits]) =>
    hits.map((h) => ({
      tournamentId,
      personId,
      stage: h.stage,
      panelRole: h.role,
      roundNumber: h.roundNumber,
      source: 'round_results',
    })),
  );
  const owned = judgeRowsOwnedByRounds(rounds);
  await prisma.$transaction([
    ...(owned
      ? [
          prisma.judgeAssignment.deleteMany({
            where: { tournamentId, source: 'round_results', ...owned },
          }),
        ]
      : []),
    prisma.judgeAssignment.createMany({ data, skipDuplicates: true }),
  ]);
  for (const [personId, hits] of byPerson) {
    await writeJudgeParticipantRole(
      prisma,
      tournamentId,
      personId,
      computeJudgeAggregates(
        hits.map((h): JudgeRound => ({ stage: h.stage, role: h.role, roundNumber: h.roundNumber })),
      ),
      'fillNullsOnly',
    );
  }
  return data.length;
}

/**
 * The tab and write phases. `userId` is the URL owner; null for the
 * pre-scrape (prescrapeTournament), which writes the tournament with no
 * owner — nothing is linked or claimed and no DiscoveredUrl is touched.
 */
export async function runFullScrape(
  loaded: LoadedState,
  userId: string | null,
  options: { force?: boolean; only?: PieceRef[] },
  afterWrite?: (ctx: {
    fetched: FetchedTabs;
    persons: PersonContext;
    tournamentId: bigint;
  }) => Promise<void>,
): Promise<IngestResult> {
  const fetchStarted = Date.now();
  const fetched = await fetchTabsKeepingOutcomes(loaded, options.only);
  const fetchMs = Date.now() - fetchStarted;
  await recordPipelineParserRun(loaded, fetched);

  // Keep what loaded (owner decision 2026-10-30, partial scrapes). This used
  // to abort on any failed tab, on the theory that a partial ingest hid the
  // failure; but one flaky round then cost the whole tournament, retried
  // whole. Now each failed page is a ScrapePiece with its own retry, so the
  // failure stays visible without throwing away the pages that did load. Only
  // a scrape where nothing loaded aborts: there is nothing to keep, and the
  // queue's whole-job retry is the right answer. A tournament whose nav links
  // no pages at all tried none, failed none, and goes on as before.
  const outcomes = fetched.pieceOutcomes;
  if (outcomes.length > 0 && !outcomes.some((o) => o.ok)) {
    // A partial re-scrape whose every page failed still counts as an attempt
    // for each piece: without the record, attempts never grow and the retry
    // back-off never advances, so the retry cron would ask again every tick.
    if (options.only && loaded.existing) {
      await recordPieceOutcomes(loaded.existing.id, [...outcomes, ...fetched.unpublishedPieces]);
    }
    throw new NothingLoadedError(
      `Aborting ingest: no page loaded — ` +
        fetched.fetchLevelFailures.map((w) => w.slice(0, 120)).join('; '),
      outcomes,
    );
  }

  const guarded = await checkRegressionGuard(loaded, fetched, userId, options);
  if (guarded.kind === 'regression-blocked') return guarded.result;
  const partial = partialWarning(outcomes);
  if (partial) loaded.fetchWarnings.push(partial);

  // Last point at which stopping is free: nothing for this tournament has
  // been written yet. A write phase cut off by the platform would leave a
  // half-committed tournament and a job stuck `running`, so do not begin it
  // without enough time to finish.
  const reserveMs = writeReserveMs(fetched.totalParticipants, fetched.totalTeams);
  const remainingAtWrite = loaded.fetchSession.remainingMs();
  try {
    loaded.fetchSession.assertTimeLeft(reserveMs, 'write its results');
  } catch (err) {
    throw cutOff(err, outcomes);
  }

  // Logged so the reserve's per-row rate can be re-checked against real runs.
  const writeStarted = Date.now();
  const persons = await preCommitPeopleAndBuildIndex(loaded, fetched);
  const txResult = await writeIngestTransaction(
    loaded,
    fetched,
    persons,
    options,
    userId === null ? PRESCRAPE_TX_TIMEOUT_MS : LIVE_TX_TIMEOUT_MS,
  );
  const result = await finalizePostTransaction(loaded, fetched, txResult, userId);
  // Only after the write: a piece is "ok" because its rows are stored.
  await recordPieceOutcomes(txResult.tournamentId, [...outcomes, ...fetched.unpublishedPieces]);
  if (afterWrite) await afterWrite({ fetched, persons, tournamentId: txResult.tournamentId });
  console.info('[ingest] write phase', {
    url: loaded.normalized,
    // Both halves of the budget: the tab phase, then the write. Together
    // with the deadline they show how close a tournament came to deferring.
    fetchMs,
    writeMs: Date.now() - writeStarted,
    reserveMs,
    remainingAtWriteMs: Number.isFinite(remainingAtWrite) ? Math.round(remainingAtWrite) : null,
    participants: fetched.totalParticipants ?? null,
    teams: fetched.totalTeams ?? null,
  });
  // After the write-phase log, so its writeMs times the write only, and after
  // afterWrite, so a partial re-scrape's judge panels are counted.
  await auditIfTimeLeft(loaded.fetchSession, txResult.tournamentId);
  return result;
}

/**
 * Re-scores the tournament's data accuracy against what was just written.
 * Best-effort: auditAfterScrape catches its own errors, so it never fails the
 * ingest. Skipped when the deadline is close: the job still has to be marked
 * done before the platform's kill, and the cron's sweep audits the tournament
 * later as missing or stale.
 */
async function auditIfTimeLeft(session: FetchSession, tournamentId: bigint): Promise<void> {
  if (session.remainingMs() < AUDIT_MIN_REMAINING_MS) return;
  await auditAfterScrape(tournamentId);
}

// ─── Concurrent-scrape claim ──────────────────────────────────────────────
//
// A claim is a single conditional UPDATE on the Tournament row — atomic in
// Postgres, safe under the pgbouncer-pooled connection (unlike session
// advisory locks, which can't be trusted to release on the same pooled
// connection; the WRITE-phase lock is fine because pg_advisory_xact_lock
// is transaction-scoped). TTL covers crashed holders: a claim older than
// the TTL is treated as abandoned and stealable.

/**
 * Time the write phase (people pre-commit, the main transaction, the bulk
 * score writes) must have in hand before it starts, for a tournament of this
 * size. INGEST_WRITE_RESERVE_MS, when set, overrides it with a fixed value.
 *
 * Fitted to production (Vercel fra1 → Neon, the 2026-10-25 Re-ingest all,
 * `[ingest] write phase`): writes ran 1.8 s for 60/25 participants/teams,
 * 8.5 s for 274/94 (the slowest per row), 11.0 s for 436/192 (SIDO 2026) and
 * 18.1 s for 1,062/379 (WUDC 2022) — sublinear, about 17 ms per row small
 * and 12.6 ms at WUDC scale. 4 s + 14 ms per participant + team covers every
 * one of those (9.2 s, 12.8 s, 24.2 s) while still admitting WUDC 2022,
 * whose ~23 s fetch phase leaves ~32 s: a reserve fitted to the small end
 * (25 ms/row) would have deferred it on every attempt, breaking an ingest
 * that works. Under-reserving is the cheaper error — a write the platform
 * kills rolls back, and the job is recovered — so the fit errs toward
 * admitting.
 */
export function writeReserveMs(
  participants: number | null | undefined,
  teams: number | null | undefined,
  override: string | undefined = process.env.INGEST_WRITE_RESERVE_MS,
): number {
  const fixed = Number(override);
  if (override !== undefined && override !== '' && Number.isFinite(fixed) && fixed >= 0)
    return fixed;
  return WRITE_RESERVE_BASE_MS + WRITE_RESERVE_PER_ROW_MS * ((participants ?? 0) + (teams ?? 0));
}
const WRITE_RESERVE_BASE_MS = 4_000;
/** Time an ingest must have left to run its after-scrape audit. */
const AUDIT_MIN_REMAINING_MS = 5_000;
const WRITE_RESERVE_PER_ROW_MS = 14;

const SCRAPE_CLAIM_TTL_MS = 2 * 60 * 1000;
const SCRAPE_AWAIT_POLL_MS = 3_000;
const SCRAPE_AWAIT_MAX_MS = 15_000;

/**
 * Another scrape holds this tournament's claim. A caller that must not wait
 * (the pre-scrape, a partial re-scrape) throws this; the API maps it to 409.
 */
export class ScrapeBusyError extends Error {
  constructor(base: string) {
    super(`another scrape of ${base} is in progress`);
    this.name = 'ScrapeBusyError';
  }
}

/**
 * The deadline cut the tab fetch short. Still an IngestDeadlineError (the
 * queue's "run me again" signal); `outcomes` are the pages that answered
 * before it, none of them written.
 */
export class FetchCutOffError extends IngestDeadlineError {
  constructor(
    message: string,
    readonly outcomes: PieceOutcome[],
  ) {
    super(message);
  }
}

/** A deadline error as a FetchCutOffError carrying `outcomes`; any other error as is. */
function cutOff(err: unknown, outcomes: PieceOutcome[]): unknown {
  return isIngestDeadlineError(err) ? new FetchCutOffError(err.message, outcomes) : err;
}

/**
 * fetchAndParseTabs, keeping the pages that answered before a deadline cut
 * it short (FetchCutOffError) for a partial re-scrape to record
 * (partialScrape.ts); without them a slow tournament's retry would end each
 * tick having counted nothing.
 */
async function fetchTabsKeepingOutcomes(
  loaded: LoadedState,
  only: PieceRef[] | undefined,
): Promise<FetchedTabs> {
  const collected: PieceOutcome[] = [];
  try {
    return await fetchAndParseTabs(loaded, only, collected);
  } catch (err) {
    throw cutOff(err, collected);
  }
}

/** No page of the scrape loaded; `outcomes` says what each one answered. */
export class NothingLoadedError extends Error {
  constructor(
    message: string,
    readonly outcomes: PieceOutcome[],
  ) {
    super(message);
    this.name = 'NothingLoadedError';
  }
}

export async function acquireScrapeClaim(
  tournamentId: bigint | null,
): Promise<'acquired' | 'busy' | 'none'> {
  if (tournamentId == null) return 'none';
  const stealCutoff = new Date(Date.now() - SCRAPE_CLAIM_TTL_MS);
  const res = await prisma.tournament.updateMany({
    where: {
      id: tournamentId,
      OR: [{ scrapeClaimedAt: null }, { scrapeClaimedAt: { lt: stealCutoff } }],
    },
    data: { scrapeClaimedAt: new Date() },
  });
  return res.count > 0 ? 'acquired' : 'busy';
}

export async function releaseScrapeClaim(tournamentId: bigint): Promise<void> {
  try {
    await prisma.tournament.updateMany({
      where: { id: tournamentId },
      data: { scrapeClaimedAt: null },
    });
  } catch {
    // Best-effort — an unreleased claim self-expires via the TTL.
  }
}

/**
 * Another ingest holds the scrape claim for this tournament. Poll briefly:
 * if their scrape commits (scrapedAt advances), re-run the cache check
 * against the refreshed row and serve their result; if their claim
 * disappears without a commit (they failed), or the wait times out, return
 * null and let the caller scrape — duplicated fetches in that case, but
 * never a wrong result.
 */
async function awaitConcurrentScrape(
  loaded: LoadedState,
  userId: string,
  options: { force?: boolean },
): Promise<IngestResult | null> {
  const previous = loaded.existing;
  if (!previous) return null;
  // Never wait past this ingest's own deadline (FetchSession.deadline).
  const deadline = Date.now() + Math.min(SCRAPE_AWAIT_MAX_MS, loaded.fetchSession.remainingMs());
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SCRAPE_AWAIT_POLL_MS));
    const current = await prisma.tournament.findUnique({ where: { id: previous.id } });
    if (!current) return null;
    if (current.scrapedAt.getTime() > previous.scrapedAt.getTime()) {
      loaded.existing = current;
      const recheck = await checkCacheFreshness(loaded, userId, options);
      return recheck.kind === 'cache-hit' ? recheck.result : null;
    }
    if (current.scrapeClaimedAt == null) return null;
  }
  return null;
}

// ─── Phase functions for ingestPrivateUrl ─────────────────────────────────
// See spec at docs/superpowers/specs/2026-05-23-ingest-pipeline-decomposition-design.md.
// Each phase function is private (not exported) and takes typed input from
// the orchestrator. The orchestrator threads typed state through these
// phases; data flow is explicit rather than via a shared mutable context.

/**
 * A finished tournament we have stored, linked without fetching the private
 * URL (storedFirst.ts), as an IngestResult; null to go the live way.
 */
async function storedFirstResult(url: string, userId: string): Promise<IngestResult | null> {
  const stored = await linkFromStoredTournament(url, userId);
  if (!stored) return null;
  return {
    tournamentId: stored.tournamentId,
    fingerprint: stored.fingerprint,
    cached: true,
    // Matched from the user's claimed names, so already theirs.
    claimedPersonId: stored.personId,
    claimedPersonName: stored.personName,
    parserVersion: PARSER_VERSION,
    totalTeams: stored.totalTeams,
    totalParticipants: stored.totalParticipants,
    warnings: [],
  };
}

export async function loadLandingAndFingerprint(
  url: string,
  userId: string,
  deadline?: number,
): Promise<LoadedState> {
  const normalized = normalizePrivateUrl(url);
  // Re-validate here, not just at the API boundary. Jobs reach this
  // function from three places — /api/ingest/url, the queue drain, and the
  // admin re-ingest — and a URL persisted before the gate was tightened
  // would otherwise still be fetched when the cron picks it up.
  if (!isPrivateUrl(normalized)) {
    throw new Error(`refusing to fetch non-private URL: ${normalized.slice(0, 120)}`);
  }
  const urlVariants = privateUrlVariants(url);
  const parsedUrl = new URL(normalized);
  const tournamentSlug = parsedUrl.pathname.split('/').filter(Boolean)[0] ?? null;
  const discovered = await prisma.discoveredUrl.findFirst({
    where: { userId, url: { in: urlVariants } },
    orderBy: { messageDate: 'asc' },
    select: { messageDate: true },
  });
  const privateUrlSentAt = discovered?.messageDate ?? null;

  // Per-ingest fetch session — bundles cookie jar + per-host throttle so
  // Cloudflare clearance cookies set on the landing page replay on the
  // subsequent tab fetches, without leaking state to other concurrent users.
  const fetchSession = new FetchSession({ deadline });

  // Landing page fetch — with provenance so every parse has a stable source.
  const landingResult = await fetchHtmlWithProvenance(normalized, {
    session: fetchSession,
    timeoutMs: LANDING_FETCH_TIMEOUT_MS,
  });
  if (!landingResult.ok) {
    // The status reaches the user's dashboard; the response BODY does not.
    // bodyPreview is genuinely useful when upstream serves a Cloudflare
    // error page, but echoing a fetched body back to whoever submitted the
    // URL turns any fetch-target confusion into a read primitive. Operators
    // get it in the server log and in the ParserRun row instead.
    console.warn('[ingest] landing fetch failed', {
      url: normalized,
      status: landingResult.status,
      bodyPreview: landingResult.bodyPreview.replace(/\s+/g, ' ').slice(0, 300),
    });
    throw new Error(`fetch landing ${normalized} → HTTP ${landingResult.status}`);
  }
  const landingDoc = landingResult;
  const landingHtml = landingDoc.html;
  // Collected across the whole ingest and attached to the landing ParserRun.
  const fetchWarnings: string[] = [];

  const parseStart = Date.now();
  const snapshot = parsePrivateUrlPage(landingHtml, normalized);
  const landingWarnings = collectRegistrationWarnings(snapshot, { privateUrlSentAt });

  const explicitYear = extractYearFromName(snapshot.tournamentName);
  const year = inferTournamentYear(snapshot.tournamentName, privateUrlSentAt);
  const inferredFingerprint = computeFingerprint({
    host: parsedUrl.host,
    tournamentSlug,
    tournamentName: snapshot.tournamentName,
    year,
  });
  // When the year was INFERRED from the email date (not explicit in the
  // name), the same event may already be stored under a neighbouring year
  // (two users' emails straddling a year boundary) or under year=null
  // (legacy rows). Try every candidate before concluding the tournament
  // is new, and adopt the existing row's stored fingerprint so all
  // writers converge on one row. See candidateFingerprints.
  let existing: Awaited<ReturnType<typeof prisma.tournament.findUnique>> = null;
  for (const candidate of candidateFingerprints({
    host: parsedUrl.host,
    tournamentSlug,
    tournamentName: snapshot.tournamentName,
    explicitYear,
    inferredYear: year,
  })) {
    existing = await prisma.tournament.findUnique({ where: { fingerprint: candidate } });
    if (existing) break;
  }
  // C1 (B9): no fingerprint matched — try the tournament's site address
  // before concluding it is new. A rename, or a title read differently on the
  // public page a pre-scrape stored it from, would otherwise make a second row.
  if (!existing) existing = await findTournamentByHostSlug(parsedUrl.host, tournamentSlug);
  const tournamentFingerprint = existing?.fingerprint ?? inferredFingerprint;

  return {
    normalized,
    urlVariants,
    parsedUrl,
    tournamentSlug,
    fetchSession,
    landingDoc,
    landingHtml,
    snapshot,
    fetchWarnings,
    landingWarnings,
    privateUrlSentAt,
    tournamentFingerprint,
    existing,
    parseStart,
    year,
  };
}

async function checkCacheFreshness(
  loaded: LoadedState,
  userId: string,
  options: { force?: boolean },
): Promise<CacheCheckResult> {
  const {
    landingDoc,
    landingHtml,
    snapshot,
    existing,
    urlVariants,
    tournamentFingerprint,
    parseStart,
    landingWarnings,
  } = loaded;
  if (!existing || options.force) return { kind: 'miss' };

  // Age does not matter: any stored row is fresh unless Re-ingest all marked
  // it with an epoch scrapedAt (lib/calicotab/prescrape.ts). Incomplete data
  // is caught by the parser-version, round-count and released-tab checks below.
  const fresh = storedTournamentFresh(existing);
  // Reparse invalidation: was the stored data produced by the current
  // PARSER_VERSION? Tournament-scoped via Tournament.parserVersion — the
  // old per-landing-document check (isLatestParserRun) meant a SECOND
  // user's first touch of a cached tournament always cache-missed,
  // because their private URL is a different SourceDocument with no runs
  // yet, and the tournament got fully re-scraped for nothing. The
  // per-doc check remains only as a fallback for rows written before the
  // column existed.
  const parserUpToDate = existing.parserVersion
    ? existing.parserVersion === PARSER_VERSION
    : await isLatestParserRun(landingDoc.sourceDocumentId);
  // Smart cache bust: if the landing nav advertises more rounds than we
  // have stored TeamResult rows for, the tournament has progressed since
  // the last ingest — fall through to a full refresh instead of serving
  // a cached result that's missing rounds.
  let cacheStale = false;
  const navRoundCount = snapshot.navigation.resultsRounds.length;
  if (navRoundCount > 0) {
    const storedRounds = await prisma.teamResult.findMany({
      where: { tournamentId: existing.id, roundNumber: { gt: 0 } },
      select: { roundNumber: true },
      distinct: ['roundNumber'],
    });
    cacheStale = navRoundCount > storedRounds.length;
  }
  // The same for the tabs: once the landing page links the team or speaker
  // tab, the tournament has released it, and a stored copy without it is
  // incomplete. Nothing is released after the last round and both tabs.
  if (!cacheStale) {
    const discovered = snapshot.navigation.meta.discovered;
    const wantTeam = discovered.includes('teamTab');
    const wantSpeaker = discovered.includes('speakerTab');
    if (wantTeam || wantSpeaker) {
      const [teamRow, speakerRow] = await Promise.all([
        wantTeam
          ? prisma.teamResult.findFirst({
              where: { tournamentId: existing.id, roundNumber: 0 },
              select: { id: true },
            })
          : Promise.resolve(null),
        wantSpeaker
          ? prisma.tournamentParticipant.findFirst({
              where: { tournamentId: existing.id, speakerScoreTotal: { not: null } },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);
      cacheStale = releasedTabMissing(discovered, {
        hasTeamTab: teamRow !== null,
        hasSpeakerTab: speakerRow !== null,
      });
    }
  }
  // Motions released later (owner rule I49, e.g. outround motions) re-scrape,
  // but only when the page lists MORE than is stored: a linked page can be
  // empty, blocked or unparseable, and "linked, none stored" re-scraped the
  // whole tournament on every load. One request for the motions page alone,
  // through the per-host throttle, and at most once per window per tournament.
  const motionsUrl = snapshot.navigation.motionsTab;
  if (
    !cacheStale &&
    fresh &&
    parserUpToDate &&
    motionsUrl &&
    snapshot.navigation.meta.discovered.includes('motionsTab') &&
    motionsCheckDue(existing.id)
  ) {
    // This check is optional: a deadline reached during it serves the cache
    // hit rather than failing a load whose stored data is fine.
    const page = await fetchHtmlWithProvenance(motionsUrl, {
      referer: loaded.normalized,
      session: loaded.fetchSession,
    }).catch((err: unknown) => {
      if (isIngestDeadlineError(err)) return null;
      throw err;
    });
    if (page?.ok) {
      const storedMotions = await prisma.motion.count({ where: { tournamentId: existing.id } });
      cacheStale = motionsGained(storedMotions, parseMotionsTab(page.html));
    }
  }
  if (!fresh || !parserUpToDate || cacheStale) return { kind: 'miss' };

  await recordParserRun({
    sourceDocumentId: landingDoc.sourceDocumentId,
    parserName: 'parseNav',
    success: true,
    warnings: landingWarnings,
    durationMs: Date.now() - parseStart,
  });
  const linked = await withDeadlockRetry(() =>
    linkRegistrationPerson(existing.id, snapshot.registration.personName, userId, urlVariants),
  );
  if (linked) {
    // Per-round data is attached to the registration Person regardless of
    // claim status so it's ready when that person eventually claims.
    // Speaker registrations don't surface the empty-Debates-card
    // diagnostic — see the post-tx call site below for full rationale.
    const isLikelySpeaker = !!snapshot.registration.teamName;
    const r = await recordJudgeRoundsFromLanding(
      landingHtml,
      existing.id,
      linked.personId,
      snapshot.registration.personName,
    );
    if (r.diagnostic && !isLikelySpeaker) landingWarnings.push(r.diagnostic);
    await recordSpeakerRoundsFromLanding(
      landingHtml,
      existing.id,
      linked.personId,
      snapshot.registration.teamName,
    );
  }
  await prisma.discoveredUrl.updateMany({
    where: { userId, url: { in: urlVariants } },
    data: { tournamentId: existing.id, ingestedAt: new Date() },
  });
  await fillTournamentYearFromEmails(existing.id);
  return {
    kind: 'cache-hit',
    result: {
      tournamentId: existing.id,
      fingerprint: tournamentFingerprint,
      cached: true,
      claimedPersonId: linked?.claimed ? linked.personId : null,
      claimedPersonName: linked?.claimed ? (snapshot.registration.personName ?? null) : null,
      parserVersion: PARSER_VERSION,
      totalTeams: existing.totalTeams,
      totalParticipants: existing.totalParticipants,
      warnings: landingWarnings,
    },
  };
}

/** One linked results round: already mapped from the API, or HTML still to parse. */
type RoundPage = { kind: 'api'; debate: RoundDebate } | { kind: 'html'; url: string; html: string };
/** One linked break tab, likewise. */
type BreakPage = { kind: 'api'; rows: BreakRow[] } | { kind: 'html'; url: string; html: string };

const API_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function fetchAndParseTabs(
  loaded: LoadedState,
  only?: PieceRef[],
  pieceOutcomes: PieceOutcome[] = [],
): Promise<FetchedTabs> {
  const { normalized, fetchSession, snapshot, landingHtml, fetchWarnings } = loaded;
  // Fetch and parse tabs in parallel (bounded: these are same host, so fetch throttles).
  //
  // `only` (a partial re-scrape) narrows the nav to the requested pieces, and
  // everything below reads `nav`, so a page nobody asked for is never fetched
  // and its fields come back empty. The full nav is kept for the prelim-count
  // fallback, which describes the tournament rather than this fetch.
  const fullNav = snapshot.navigation;
  const nav = navForPieces(fullNav, only);
  // Every page tried leaves an outcome beside its warning, so a failed piece
  // can be retried alone. A guessed page the tournament withholds leaves
  // none (it may not exist); a linked one leaves a withheld outcome, which
  // is never retried. `pieceOutcomes` is the caller's, so the outcomes
  // collected before a deadline cuts the fetch short are not lost with it.
  const noteOutcome = (
    kind: PieceKind,
    url: string,
    result: { status: number | null; error?: string; withheld?: boolean } = { status: null },
  ) =>
    pieceOutcomes.push(pieceOutcome(kind, url, { ...result, roundLabels: nav.resultsRoundLabels }));

  // Build a shared fetch helper for this ingest that records failures into
  // the fetchWarnings buffer so the landing ParserRun tells the operator
  // exactly which tabs upstream refused to serve.
  //
  // Participants is enrichment, a page the CV can do without (it adds
  // institutions and everyone's role, while the owner's own registration card
  // comes from the landing page). When the tournament itself withholds such a
  // page — Tabbycat's own "Permission Denied (403)" or a 404 — that is a fact
  // about the tournament, not a fault, so it is noted as `optional:` and the
  // ingest goes on. A CDN block, a timeout or a 5xx still fails the ingest and
  // is retried like any other tab.
  const fetchTab = async (
    targetUrl: string,
    label: string,
    kind: PieceKind,
  ): Promise<string | null> => {
    const enrichment = kind === 'participants';
    const r = await fetchHtmlWithProvenance(targetUrl, {
      referer: normalized,
      session: fetchSession,
    });
    if (r.ok) {
      noteOutcome(kind, targetUrl, { status: r.status });
      return r.html;
    }
    // Never when we already hold participants for this tournament: a forced
    // re-ingest skips the regression guard and would rewrite them from the
    // landing page alone, losing the institutions and roles stored earlier.
    // That case keeps failing, as it did before this was optional.
    const hasStoredParticipants = (loaded.existing?.totalParticipants ?? 0) > 0;
    if (enrichment && !hasStoredParticipants && isWithheldByTournament(r)) {
      fetchWarnings.push(`optional: ${label} HTTP ${r.status} (not public for this tournament)`);
      return null;
    }
    // Only a CDN block is helped by the scraper proxy; the tournament's own
    // "Permission Denied" is not, and the old hint sent people after the wrong fix.
    const hint =
      r.status === 403 && r.cdnBlocked !== false && !process.env.SCRAPER_API_KEY
        ? ' (set SCRAPER_API_KEY to bypass Cloudflare blocking)'
        : '';
    // Status + hint only — see the landing-fetch note above for why the
    // response body stays server-side.
    if (r.bodyPreview) {
      console.warn('[ingest] tab fetch failed', {
        label,
        status: r.status,
        bodyPreview: r.bodyPreview.replace(/\s+/g, ' ').slice(0, 300),
      });
    }
    fetchWarnings.push(`fetch: ${label} HTTP ${r.status}${hint}`);
    // With participants stored, a withheld list still fails the scrape's
    // refresh (above), but no retry will make it public: it is recorded as
    // withheld, so it is not retried and does not mark the CV.
    noteOutcome(kind, targetUrl, {
      status: r.status,
      error: `HTTP ${r.status}${hint}`,
      withheld: enrichment && isWithheldByTournament(r),
    });
    return null;
  };
  const fetchRound = async (targetUrl: string): Promise<{ url: string; html: string } | null> => {
    const r = await fetchRoundWithProvenance(targetUrl, {
      referer: normalized,
      session: fetchSession,
    });
    // Keyed on the nav URL, not r.url (often its by-debate view), so the
    // piece is the same one the nav and a later re-scrape name.
    if (r.ok) {
      noteOutcome('round', targetUrl, { status: r.status });
      return { url: r.url, html: r.html };
    }
    fetchWarnings.push(`fetch: round ${targetUrl} HTTP ${r.status}`);
    noteOutcome('round', targetUrl, { status: r.status, error: `HTTP ${r.status}` });
    return null;
  };

  // Motions tab is optional enrichment: plenty of tournaments never release
  // motions, and the nav link can exist while the page 404s. Failures here
  // must NOT go through fetchTab — its `fetch:` warning prefix feeds
  // fetchLevelFailures, which aborts the entire ingest, and losing a whole
  // tournament because motions were withheld is the wrong trade.
  //
  // `guessed` marks a URL the nav parser built rather than found on the
  // landing page. If the tournament says that page is not there or not public,
  // that is the expected answer for a guess, and it stays silent: a warning
  // would also stop a re-ingest of an existing tournament from refreshing.
  const fetchOptionalTab = async (
    targetUrl: string,
    label: string,
    guessed = false,
  ): Promise<string | null> => {
    const r = await fetchHtmlWithProvenance(targetUrl, {
      referer: normalized,
      session: fetchSession,
    });
    if (r.ok) {
      noteOutcome('motions', targetUrl, { status: r.status });
      return r.html;
    }
    if (guessed && isWithheldByTournament(r)) return null;
    fetchWarnings.push(`optional: ${label} HTTP ${r.status}`);
    // A linked page the tournament refuses is withheld, not failed: retrying
    // it would only fill the logs and keep the CV's "Partly loaded" mark.
    noteOutcome('motions', targetUrl, {
      status: r.status,
      error: `HTTP ${r.status}`,
      withheld: isWithheldByTournament(r),
    });
    return null;
  };

  // Team and speaker tabs from Tabbycat's REST API (on by default;
  // TABBYCAT_API_TABS=0 turns it off — see lib/calicotab/tabbycatApi.ts and
  // the 2026-10-20 handoff for the parity evidence). The API shares this ingest's
  // per-host slot so it is throttled like the HTML fetches.
  //
  // Each tab ends up with one of three sources. `api` skips the HTML page.
  // `html` falls back to it silently: a tournament without the API is the
  // normal case, not a warning, and a non-empty fetchWarnings would also
  // suppress the tournament-wide refresh. `private` (the tournament's own
  // preferences say the tab is not released) reads neither — the same as a
  // landing page with no tab link, which already yields zero rows and no
  // warning.
  const apiFetcher = withApiSnapshots(async (apiUrl) => {
    const host = new URL(apiUrl).host;
    await fetchSession.acquireSlot(host, FETCH_MIN_INTERVAL_MS);
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': process.env.TABBYCAT_USER_AGENT || API_USER_AGENT,
        Accept: 'application/json',
      },
      // Never past the ingest's deadline (FetchSession.deadline).
      signal: AbortSignal.timeout(
        Math.max(0, Math.min(API_TIMEOUT_MS, fetchSession.remainingMs())),
      ),
    });
    // Push-back on the API is push-back on the host: slow the HTML
    // fallback that follows through the same learned interval fetch.ts uses.
    if (isCdnRateLimit(res.status, res.headers))
      fetchSession.noteRateLimited(host, FETCH_MIN_INTERVAL_MS);
    return res;
  });
  // A partial re-scrape asks the API only when it wants the team or speaker
  // tab, and keeps only the tab it asked for (apiTabsForPieces).
  const wantsApiTab = !only || only.some((p) => p.kind === 'team' || p.kind === 'speaker');
  const apiTabs: ApiTabsResult = apiTabsForPieces(
    !tabbycatApiTabsEnabled()
      ? htmlOnly('TABBYCAT_API_TABS=0')
      : wantsApiTab
        ? await fetchTabsFromApi(normalized, apiFetcher)
        : htmlOnly('not requested'),
    only,
  );
  // An API answer stands in for its tab's page; its outcome names the API
  // endpoint the rows came from.
  const apiBase = apiBaseFromTournamentUrl(normalized) ?? normalized;
  if (apiTabs.teams.source === 'api') noteOutcome('team', `${apiBase}/teams/standings`);
  if (apiTabs.speakers.source === 'api') noteOutcome('speaker', `${apiBase}/speakers/standings`);
  console.info('[ingest] tabbycat api', {
    url: normalized,
    teams:
      apiTabs.teams.source === 'api' ? 'api' : `${apiTabs.teams.source}: ${apiTabs.teams.reason}`,
    speakers:
      apiTabs.speakers.source === 'api'
        ? 'api'
        : `${apiTabs.speakers.source}: ${apiTabs.speakers.reason}`,
  });
  const htmlTabs = htmlTabsToFetch(apiTabs, nav);
  fetchWarnings.push(...unreleasedTabWarnings(apiTabs));

  // Round results, break tabs and the participants list from the API (B8),
  // opt-in with TABBYCAT_API_ROUNDS=1 until the owner turns it on. Same
  // contract as the tabs: a page the API answered skips its HTML fetch; any
  // other page is scraped exactly as before. See lib/calicotab/tabbycatApiRounds.ts.
  const wantsApiRest =
    !only || nav.resultsRounds.length > 0 || nav.breakTabs.length > 0 || !!nav.participants;
  const apiRest =
    tabbycatApiRoundsEnabled() && wantsApiRest
      ? await fetchRestFromApi(normalized, nav, apiFetcher)
      : null;
  if (apiRest) {
    const count = (xs: Iterable<{ source: string }>) =>
      [...xs].filter((x) => x.source === 'api').length;
    console.info('[ingest] tabbycat api rounds', {
      url: normalized,
      rounds: `${count(apiRest.rounds.values())}/${nav.resultsRounds.length}`,
      breaks: `${count(apiRest.breaks.values())}/${nav.breakTabs.length}`,
      participants: apiRest.participants?.source ?? 'none',
    });
  }
  const apiParticipants =
    apiRest?.participants?.source === 'api' ? apiRest.participants.value : null;
  if (apiParticipants && nav.participants) noteOutcome('participants', nav.participants);

  const [teamHtml, speakerHtml, participantsHtml, motionsHtml] = await Promise.all([
    htmlTabs.teamTab ? fetchTab(htmlTabs.teamTab, 'teamTab', 'team') : Promise.resolve(null),
    htmlTabs.speakerTab
      ? fetchTab(htmlTabs.speakerTab, 'speakerTab', 'speaker')
      : Promise.resolve(null),
    nav.participants && !apiParticipants
      ? fetchTab(nav.participants, 'participants', 'participants')
      : Promise.resolve(null),
    nav.motionsTab
      ? fetchOptionalTab(nav.motionsTab, 'motionsTab', nav.meta?.constructed.includes('motionsTab'))
      : Promise.resolve(null),
  ]);
  // Round results: prefer the by-debate view so each row is one debate and
  // adjudicators are scoped to their own debate (sidesteps double-counting
  // that the by-team pivot can introduce). Nav order is kept either way.
  const roundPages = await Promise.all(
    nav.resultsRounds.map(async (u): Promise<RoundPage | null> => {
      const fromApi = apiRest?.rounds.get(u);
      if (fromApi?.source === 'api') {
        noteOutcome('round', u);
        return { kind: 'api', debate: fromApi.value };
      }
      const page = await fetchRound(u);
      return page ? { kind: 'html', ...page } : null;
    }),
  );
  const breakPages = await Promise.all(
    nav.breakTabs.map(async (u): Promise<BreakPage | null> => {
      const fromApi = apiRest?.breaks.get(u);
      if (fromApi?.source === 'api') {
        noteOutcome('break', u);
        return { kind: 'api', rows: fromApi.value };
      }
      const html = await fetchTab(u, 'break', 'break');
      return html ? { kind: 'html', url: u, html } : null;
    }),
  );

  const teamRows =
    apiTabs.teams.source === 'api' ? apiTabs.teams.rows : teamHtml ? parseTeamTab(teamHtml) : [];
  if (teamRows.length === 0 && teamHtml) {
    fetchWarnings.push(`parse: teamTab → 0 rows — ${diagnoseVueData(teamHtml, ['team'])}`);
  }

  const speakerRows =
    apiTabs.speakers.source === 'api'
      ? apiTabs.speakers.rows
      : speakerHtml
        ? parseSpeakerTab(speakerHtml)
        : [];
  if (speakerRows.length === 0 && speakerHtml) {
    fetchWarnings.push(
      `parse: speakerTab → 0 rows — ${diagnoseVueData(speakerHtml, ['name', 'speaker'])}`,
    );
  }

  const participantRows =
    apiParticipants ?? (participantsHtml ? parseParticipantsList(participantsHtml) : []);
  if (participantRows.length === 0 && participantsHtml) {
    fetchWarnings.push(
      `parse: participants → 0 rows — ${diagnoseVueData(participantsHtml, ['name'])}`,
    );
  }

  // Private URL landing pages can include a registration card whose role label
  // (e.g. "Independent adjudicator") is the only reliable signal for some
  // tournaments. Merge those rows in so role classification doesn't depend
  // solely on /participants table availability/shape.
  // Not on a partial re-scrape that left participants out: those fields come
  // back empty, and the stored list is not this fetch's to touch.
  const landingParticipantRows = wantsPiece(only, { kind: 'participants', key: '' })
    ? parseParticipantsList(landingHtml)
    : [];
  const participantByName = new Map<string, (typeof participantRows)[number]>();
  for (const r of participantRows) participantByName.set(normalizePersonName(r.name), r);
  for (const r of landingParticipantRows) {
    const key = normalizePersonName(r.name);
    const existing = participantByName.get(key);
    if (!existing) {
      participantByName.set(key, r);
      continue;
    }
    // Prefer adjudicator classification from landing cards over weaker
    // speaker defaults from table heuristics.
    if (existing.role !== 'adjudicator' && r.role === 'adjudicator') {
      existing.role = 'adjudicator';
      existing.judgeTag = r.judgeTag;
    }
    if (!existing.institution && r.institution) existing.institution = r.institution;
  }
  const mergedParticipantRows = [...participantByName.values()];

  const unpublishedPieces: PieceOutcome[] = [];
  const rounds = roundPages
    .filter((x): x is RoundPage => !!x)
    .map((page) => {
      if (page.kind === 'api') return page.debate;
      const { url: u, html } = page;
      // Pass the landing-page nav's link text for this URL — it's the
      // authoritative round label ("Quarterfinals" not "SIDO 2026") and
      // protects classifyRoundLabel / outroundRankStrict from a generic
      // page heading.
      const navLabel = nav.resultsRoundLabels?.[u];
      const r = parseRoundResults(html, u, navLabel);
      // Columns but no rows: the round was never published. Its page did
      // load, so its outcome moves from the loaded list to the unpublished one.
      if (r.teamResults.length === 0 && roundPublishedEmpty(html)) {
        const key = pieceRefForUrl('round', u).key;
        const at = pieceOutcomes.findIndex((o) => o.kind === 'round' && o.key === key && o.ok);
        if (at >= 0) {
          const [done] = pieceOutcomes.splice(at, 1);
          unpublishedPieces.push(emptyRoundOutcome(done));
        }
      } else if (r.teamResults.length === 0) {
        fetchWarnings.push(`parse: round ${u} → 0 results — ${diagnoseVueData(html, ['team'])}`);
      }
      return r;
    });
  const breakRows = breakPages
    .filter((x): x is BreakPage => !!x)
    .flatMap((page) => (page.kind === 'api' ? page.rows : parseBreakPage(page.html, page.url)));
  // Zero motions from a fetched page is normal (tab released before
  // motions are public) — no diagnose warning, unlike the core tabs.
  const motions = motionsHtml ? parseMotionsTab(motionsHtml) : [];
  const tournamentName = snapshot.tournamentName ?? loaded.tournamentSlug ?? 'Unknown tournament';
  const totalParticipants = mergedParticipantRows.length || speakerRows.length || null;
  const participantsFromList = participantRows.length > 0;
  const totalTeams = teamRows.length || null;

  // Authoritative prelim round count: how many of the parsed rounds turned
  // out to be in-rounds (not outround). Stored on Tournament so the CV
  // builder can use it as the speaker-average divisor when the speaker tab
  // gives us only totals (common on AP installs that strip per-round
  // columns from the public speaker tab).
  //
  // Two-tier source:
  //   1. Parsed rounds — the count of rounds we actually fetched + parsed
  //      and classified as non-outround. Most accurate signal because the
  //      classification used the page heading + URL pattern, not the URL
  //      list alone.
  //   2. Nav-list fallback — when parsing failed or fetched zero rounds
  //      (e.g., Tabbycat 403'd every per-round results URL), fall back to
  //      the count of round-results URLs the landing page linked to.
  //      This over-counts by the number of outrounds (typically 1–3) on
  //      tournaments where both prelims and outrounds appear in the nav
  //      but no fetch succeeded. The over-count slightly under-states
  //      avg, which is better than producing no avg at all (the
  //      previously-shipped behaviour for NLSD 2025 / SRDF 2024).
  // A "Debate-off" is neither a prelim nor an outround; counted, it put a
  // ninth round on an eight-round tournament (see isPrelimRoundLabel).
  const parsedPrelimCount = rounds.filter(
    (r) => !r.isOutround && r.roundNumber != null && isPrelimRoundLabel(r.roundLabel),
  ).length;
  // A partial re-scrape parses only some rounds, and so does a scrape where a
  // round page failed: counting them would shrink the tournament (and the
  // speaker-average divisor with it). Both count the nav's prelim links.
  const roundFailed = pieceOutcomes.some((o) => o.kind === 'round' && !o.ok);
  const prelimRoundCount =
    only || roundFailed
      ? prelimRoundsFromNav(fullNav.resultsRoundLabels).length ||
        fullNav.resultsRounds.length ||
        null
      : parsedPrelimCount > 0
        ? parsedPrelimCount
        : nav.resultsRounds.length || null;
  const format = inferTournamentFormat({
    tournamentName,
    teamRows,
    speakerRows,
    participantRows: mergedParticipantRows,
    registrationSpeakers: snapshot.registration.speakers,
    rounds,
  });
  // Multi-category breaks (BP-style: Open + ESL + EFL): one team can appear
  // in more than one break tab. Pick by category priority (Open > ESL >
  // EFL > other) so a team that broke Open keeps the Open rank — see
  // lib/calicotab/breakCategoryResolve.ts for the priority table + tests.
  const { rankByTeam: teamBreakRankByTeam } = resolveTeamBreaks(breakRows);

  // Tabs the menu never linked (judged on the full nav, before `only` cut it).
  unpublishedPieces.push(...unpublishedTabOutcomes(fullNav, pieceOutcomes, only));
  const fetchLevelFailures = fetchWarnings.filter((w) => w.startsWith('fetch:'));

  return {
    teamRows,
    speakerRows,
    mergedParticipantRows,
    rounds,
    breakRows,
    motions,
    tournamentName,
    totalParticipants,
    participantsFromList,
    totalTeams,
    prelimRoundCount,
    format,
    teamBreakRankByTeam,
    redactedByTeam: participantRows.length > 0 ? redactedSpeakersByTeam(participantRows) : null,
    fetchLevelFailures,
    pieceOutcomes,
    fetchedPieces: pieceOutcomes.filter((o) => o.ok).map(({ kind, key }) => ({ kind, key })),
    unpublishedPieces,
  };
}

async function recordPipelineParserRun(loaded: LoadedState, fetched: FetchedTabs): Promise<void> {
  // Record the full ParserRun once all tab fetches + parses are done so
  // both landing warnings and per-tab fetch failures (fetchWarnings) land
  // in the same row. Lets /cv/verify surface "tab fetch returned 403" next
  // to the tournament card rather than showing silent empty tables.
  await recordParserRun({
    sourceDocumentId: loaded.landingDoc.sourceDocumentId,
    parserName: 'parseNav',
    success:
      (!!loaded.snapshot.tournamentName || loaded.snapshot.navigation.resultsRounds.length > 0) &&
      fetched.fetchLevelFailures.length === 0,
    warnings: [...loaded.landingWarnings, ...loaded.fetchWarnings],
    durationMs: Date.now() - loaded.parseStart,
  });
}

async function checkRegressionGuard(
  loaded: LoadedState,
  fetched: FetchedTabs,
  userId: string | null,
  options: { force?: boolean; only?: PieceRef[] },
): Promise<RegressionGuardResult> {
  // Regression guard: if a re-ingest would drop the totals by >50% (and the
  // old tournament had non-trivial counts), assume the source page is
  // temporarily degraded (rate-limited, partial render) and serve the cached
  // record instead of overwriting good data with garbage. options.force
  // bypasses for explicit manual re-ingests.
  //
  // The guard ALSO covers per-field signals — speaker rank coverage in
  // particular. A speaker tab that 403s or returns rows but has no rank
  // column at all would silently null the speakerRankOpen of every existing
  // participant after `prepareTournamentWideRefresh` runs (the upsert below
  // writes whatever sp.rank was, including null). Catching the drop here
  // serves cached data instead, matching the behaviour for catastrophic
  // team/participant drops.
  const { existing, snapshot, tournamentFingerprint, urlVariants, fetchWarnings } = loaded;
  // A partial re-scrape (`only`) writes just the pieces it asked for, so its
  // totals describe a slice, not the tournament: nothing to compare.
  if (!existing || options.force || options.only) return { kind: 'proceed' };

  // A tab that failed to load yields no rows, which is not the same as a tab
  // that shrank. Its stored rows are kept (no tournament-wide refresh runs
  // when a piece failed), so only compare what this scrape actually read.
  const teamLoaded = pieceLoaded(fetched.fetchedPieces, 'team');
  const speakerLoaded = pieceLoaded(fetched.fetchedPieces, 'speaker');
  const oldTeams = existing.totalTeams ?? 0;
  const oldParticipants = existing.totalParticipants ?? 0;
  const newTeams = fetched.totalTeams ?? 0;
  const newParticipants = fetched.totalParticipants ?? 0;
  const teamsDropped = teamLoaded && oldTeams > 5 && newTeams < oldTeams * 0.5;
  // totalParticipants has two sources: the participants list (speakers AND
  // adjudicators) when it loads, else the speaker rows (or a lone landing
  // card). The stored figure does not say which source it came from, so a
  // re-scrape whose participants page is withheld would compare a speaker
  // count against a stored speakers-plus-judges count and could block a
  // healthy re-ingest. Only compare when this parse counted from the list:
  // the stored figure is then either a list count (like for like) or a
  // speaker count, which a healthy list never falls below. When the list is
  // missing, a degraded speaker tab is still caught by the rank check below.
  const participantsDropped =
    fetched.participantsFromList && oldParticipants > 5 && newParticipants < oldParticipants * 0.5;

  // Speaker-rank regression: count old participants with a known rank vs
  // how many people this parse would write a rank for. That is one per
  // distinct name, not one per row (an iron-man has a row per team but one
  // participant), and never an unclaimed stand-in such as "Speaker 1",
  // whose rows are not written (preCommitPeopleAndBuildIndex) and so would
  // otherwise prop up the new count against a real drop.
  const oldRankCount = speakerLoaded
    ? await prisma.tournamentParticipant.count({
        where: { tournamentId: existing.id, speakerRankOpen: { not: null } },
      })
    : 0;
  const claimedStandIns = await claimedPlaceholderNorms(
    fetched.speakerRows.map((r) => r.speakerName),
  );
  const rankedNames = new Set<string>();
  for (const r of fetched.speakerRows) {
    if (r.rank == null) continue;
    const norm = normalizePersonName(r.speakerName);
    if (isPlaceholderPersonName(r.speakerName) && !claimedStandIns.has(norm)) continue;
    rankedNames.add(norm);
  }
  const newRankCount = rankedNames.size;
  const ranksDropped = oldRankCount > 5 && newRankCount < oldRankCount * 0.5;

  if (!teamsDropped && !participantsDropped && !ranksDropped) {
    return { kind: 'proceed' };
  }

  const msg =
    `Regression guard: re-ingest would drop data — ` +
    `teams ${oldTeams}→${newTeams}, participants ${oldParticipants}→${newParticipants}, ` +
    `ranks ${oldRankCount}→${newRankCount}`;
  Sentry.captureMessage(msg, { level: 'warning', tags: { fingerprint: tournamentFingerprint } });
  const linked = userId
    ? await withDeadlockRetry(() =>
        linkRegistrationPerson(existing.id, snapshot.registration.personName, userId, urlVariants),
      )
    : null;
  if (userId) {
    await prisma.discoveredUrl.updateMany({
      where: { userId, url: { in: urlVariants } },
      data: { tournamentId: existing.id, ingestedAt: new Date() },
    });
    await fillTournamentYearFromEmails(existing.id);
  }
  return {
    kind: 'regression-blocked',
    result: {
      tournamentId: existing.id,
      fingerprint: tournamentFingerprint,
      cached: true,
      claimedPersonId: linked?.claimed ? linked.personId : null,
      claimedPersonName: linked?.claimed ? (snapshot.registration.personName ?? null) : null,
      parserVersion: PARSER_VERSION,
      totalTeams: existing.totalTeams,
      totalParticipants: existing.totalParticipants,
      warnings: [...fetchWarnings, 'regression-guard: overwrite blocked'],
    },
  };
}

async function preCommitPeopleAndBuildIndex(
  loaded: LoadedState,
  fetched: FetchedTabs,
): Promise<PersonContext> {
  // Pre-commit every Person referenced anywhere in this ingest before opening
  // the main transaction. Doing the upserts inside the long transaction held
  // FK ShareLocks across concurrent ingests and triggered 40P01 deadlocks.
  const allPersonNames = new Set<string>();
  for (const sp of fetched.speakerRows) allPersonNames.add(sp.speakerName);
  for (const p of fetched.mergedParticipantRows) {
    if (p.role === 'adjudicator') allPersonNames.add(p.name);
  }
  for (const round of fetched.rounds) {
    for (const j of round.judgeAssignments) allPersonNames.add(j.personName);
  }
  // "Speaker 1" and the like are stand-ins, not people. A Person row for one
  // is shared by every tournament that used the same stand-in; their rows
  // are simply not attributed to anyone — with one exception. A stand-in
  // somebody has already CLAIMED is kept, or the forced re-parse would
  // silently strip those tournaments from that user's CV; the claim is
  // theirs to undo.
  const claimedStandIns = await claimedPlaceholderNorms(allPersonNames);
  const isUnclaimedStandIn = (name: string) =>
    isPlaceholderPersonName(name) && !claimedStandIns.has(normalizePersonName(name));
  for (const name of allPersonNames) {
    if (isUnclaimedStandIn(name)) allPersonNames.delete(name);
  }
  // Pre-commit the URL owner's registration name even when no other table
  // surfaces it. Tabbycat lets the URL owner redact their own name from the
  // public speaker tab — their row stays in the table with a coded /
  // anonymous label, so the speaker upsert below can't match them by name.
  // Adding the registration name here means the team-anchored fallback
  // further down has an actual Person row to attribute the redacted row to.
  const registrationName = loaded.snapshot.registration.personName;
  if (registrationName && !isUnclaimedStandIn(registrationName)) {
    allPersonNames.add(registrationName);
  }
  const personIdByNormalized = await preCommitPersons(allPersonNames);
  // Pre-build the fuzzy-match index once so the speaker / participant /
  // round-results loops below can fall back from exact-name lookup to
  // substring + token-subset matching without per-row rebuilding.
  const personMatchIndex = buildPersonIndex(personIdByNormalized);
  // The stand-in guard sits here too, not only above: the fuzzy fallback
  // would otherwise resolve "Speaker 1" to any known name containing it.
  const lookupPersonId = (name: string): bigint | null =>
    isUnclaimedStandIn(name) ? null : findPersonId(name, personIdByNormalized, personMatchIndex);

  return { personIdByNormalized, lookupPersonId };
}

/** Normalised stand-in names among these that already belong to somebody. */
async function claimedPlaceholderNorms(names: Iterable<string>): Promise<Set<string>> {
  const norms = [...new Set([...names].filter(isPlaceholderPersonName).map(normalizePersonName))];
  if (norms.length === 0) return new Set();
  const rows = await prisma.person.findMany({
    where: { normalizedName: { in: norms }, claimedByUserId: { not: null } },
    select: { normalizedName: true },
  });
  return new Set(rows.map((r) => r.normalizedName));
}

// Live ingests run inside a 60s Vercel function, so their write transaction
// stays at 45s. The pre-scrape runs on GitHub Actions with no function limit
// and ~50ms to the database, where large tournaments need longer than 45s.
const LIVE_TX_TIMEOUT_MS = 45_000;
const PRESCRAPE_TX_TIMEOUT_MS = 15 * 60_000;

async function writeIngestTransaction(
  loaded: LoadedState,
  fetched: FetchedTabs,
  persons: PersonContext,
  options: { force?: boolean; only?: PieceRef[] },
  txTimeoutMs: number,
): Promise<TxResult> {
  const { normalized, tournamentFingerprint, snapshot, existing, fetchWarnings, year } = loaded;
  const {
    teamRows,
    speakerRows,
    mergedParticipantRows,
    rounds,
    breakRows,
    motions,
    tournamentName,
    totalParticipants,
    totalTeams,
    prelimRoundCount,
    format,
    teamBreakRankByTeam,
  } = fetched;
  const { lookupPersonId } = persons;
  // A count is only as good as the page it came from. When the page failed,
  // the stored count stays (Prisma leaves an undefined field untouched).
  const loadedKind = (kind: PieceKind) => pieceLoaded(fetched.fetchedPieces, kind);
  const storedTeams = loadedKind('team') ? totalTeams : undefined;
  // The participant count has two sources, the participants list (speakers
  // and adjudicators) and, without one, the speaker tab. A speaker-only count
  // must not overwrite a stored list count, so it is written only when the
  // tournament has no list to read: the list was neither tried here (it
  // failed, or the tournament withholds it) nor left out of a partial run.
  const listCountMayBeStored =
    fetched.pieceOutcomes.some((o) => o.kind === 'participants') ||
    !wantsPiece(options.only, { kind: 'participants', key: '' });
  const storedParticipants = fetched.participantsFromList
    ? totalParticipants
    : !listCountMayBeStored && loadedKind('speaker')
      ? totalParticipants
      : undefined;
  // The refresh deletes every leaf row before the rewrite, so it must see
  // the whole tournament: never on a partial re-scrape (`only`) and never
  // when a page failed, not even when forced, or the failed page's stored
  // rows would go with nothing to replace them.
  const anyPieceFailed = fetched.pieceOutcomes.some((o) => !o.ok);
  const anyBreakFailed = fetched.pieceOutcomes.some((o) => o.kind === 'break' && !o.ok);
  const refreshWholeTournament =
    !options.only &&
    !anyPieceFailed &&
    (options.force || (existing != null && fetchWarnings.length === 0));

  return prisma.$transaction(
    async (tx) => {
      // Acquire a transaction-scoped Postgres advisory lock keyed on the
      // tournament fingerprint. Two concurrent ingests of the same
      // tournament would otherwise interleave through
      // `prepareTournamentWideRefresh` (deletes leaf tables) and the
      // bulk writes that follow, with each tx clobbering the other's
      // partial state. With this lock the second ingest blocks here
      // until the first commits — then runs against fresh state.
      // Auto-released on commit/rollback, so a process crash mid-tx
      // never leaves a stale lock. Audit issue #4.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${fingerprintLockKey(tournamentFingerprint)})`;

      // Only the tournament's public address is stored, never the private URL
      // this ingest came from: the row is shared by everyone who has the
      // tournament on their record, and a private URL is one participant's
      // credential (lib/cv/publicTournamentUrl.ts). The user's own private URL
      // lives on their DiscoveredUrl, which is all a re-ingest needs.
      const storedSourceUrl = publicTournamentUrl(normalized);
      const t = await tx.tournament.upsert({
        where: { fingerprint: tournamentFingerprint },
        update: {
          name: tournamentName,
          // A re-scrape that can't infer a format (rounds page hidden this
          // time, tabs released and withdrawn) must not erase the one an
          // earlier scrape found. Prisma leaves a field untouched when it is
          // undefined, so a null inference keeps the stored value. A partial
          // re-scrape sees a slice of the tournament, too little to infer
          // its format from, so it never writes one.
          format: options.only ? undefined : (format ?? undefined),
          // Likewise a year: a pre-scrape re-run reads no email date, and must
          // not erase the year a user's link gave the tournament
          // (fillTournamentYearFromEmails).
          year: year ?? undefined,
          totalParticipants: storedParticipants,
          totalTeams: storedTeams,
          prelimRoundCount,
          sourceUrlRaw: storedSourceUrl,
          // Stamp the version that produced this data (tournament-scoped
          // cache invalidation) and release the scrape claim — committing
          // the write IS the success signal concurrent waiters poll for.
          // A partial re-scrape rewrote one piece, not the tournament: it
          // must not mark old-parser data current or the rest fresh, or the
          // pre-scrape and parser-bump re-scrapes would skip it.
          scrapedAt: options.only ? undefined : new Date(),
          parserVersion: options.only ? undefined : PARSER_VERSION,
          scrapeClaimedAt: null,
        },
        create: {
          name: tournamentName,
          format,
          year,
          totalParticipants,
          totalTeams,
          prelimRoundCount,
          sourceUrlRaw: storedSourceUrl,
          fingerprint: tournamentFingerprint,
          parserVersion: PARSER_VERSION,
        },
      });

      if (refreshWholeTournament) {
        await prepareTournamentWideRefresh(tx, t.id);
      }
      // A partial re-scrape replaces only the pieces that loaded: their rows
      // go here, in the same transaction as the rewrite, so a reader never
      // sees a piece emptied but not yet rewritten (scrapePieces.clearPieces).
      if (options.only) {
        await clearPieces(
          tx,
          t.id,
          piecesToClear(fetched.pieceOutcomes, {
            rounds,
            teamRowCount: teamRows.length,
            breakStages: new Set(breakRows.map((r) => r.stage ?? 'break')),
          }),
        );
      }

      // Team results
      for (const row of teamRows) {
        await tx.teamResult.upsert({
          where: {
            tournamentId_teamName_roundNumber: {
              tournamentId: t.id,
              teamName: row.teamName,
              roundNumber: 0,
            },
          },
          update: {
            rank: row.rank,
            wins: row.wins,
            points: row.totalPoints,
            firsts: row.firsts,
            seconds: row.seconds,
          },
          create: {
            tournamentId: t.id,
            teamName: row.teamName,
            roundNumber: 0,
            rank: row.rank,
            wins: row.wins,
            points: row.totalPoints,
            firsts: row.firsts,
            seconds: row.seconds,
          },
        });
      }

      // Per-round team results (prelims only — outrounds are persisted as
      // EliminationResult rows below since they carry win/lose semantics
      // rather than points-per-round and don't have a numeric round number).
      for (const round of rounds) {
        if (round.roundNumber == null) continue;
        for (const r of round.teamResults) {
          await tx.teamResult.upsert({
            where: {
              tournamentId_teamName_roundNumber: {
                tournamentId: t.id,
                teamName: r.teamName,
                roundNumber: round.roundNumber,
              },
            },
            update: {
              points: r.points,
              wins: r.won === true ? 1 : r.won === false ? 0 : null,
              position: r.position,
            },
            create: {
              tournamentId: t.id,
              teamName: r.teamName,
              roundNumber: round.roundNumber,
              points: r.points,
              wins: r.won === true ? 1 : r.won === false ? 0 : null,
              position: r.position,
            },
          });
        }
      }
      // Redacted speakers per team, so the audit does not read them as missing.
      await recordRedactedSpeakers(tx, t.id, fetched.redactedByTeam);

      // Motions: per-row upsert keyed on (tournamentId, roundLabel, seq)
      // rather than delete-then-recreate, and only when this parse actually
      // produced motions. Upserting preserves Motion row ids across
      // re-ingests, which matters because TagProposal rows cascade-delete
      // with their motion — a recreate would wipe the approval audit trail
      // (and the approved motionType/topic values, which the update branch
      // deliberately leaves untouched). The trailing deleteMany clears only
      // rows absent from the new parse. Motion counts are small (≤ ~15 per
      // tournament) so per-row upserts inside the tx are cheap.
      if (motions.length > 0) {
        // Key each motion by its round's URL sequence, as team results are,
        // not by the number in its label — see lib/calicotab/roundNumbers.ts.
        const motionRounds = assignMotionRounds(
          motions,
          prelimRoundsFromNav(snapshot.navigation.resultsRoundLabels),
        );
        for (let i = 0; i < motions.length; i++) {
          const m = { ...motions[i]!, roundNumber: motionRounds[i] ?? null };
          await tx.motion.upsert({
            where: {
              tournamentId_roundLabel_seq: {
                tournamentId: t.id,
                roundLabel: m.roundLabel,
                seq: m.seq,
              },
            },
            update: { roundNumber: m.roundNumber, text: m.text, infoSlide: m.infoSlide },
            create: {
              tournamentId: t.id,
              roundNumber: m.roundNumber,
              roundLabel: m.roundLabel,
              seq: m.seq,
              text: m.text,
              infoSlide: m.infoSlide,
            },
          });
        }
        await tx.motion.deleteMany({
          where: {
            tournamentId: t.id,
            NOT: { OR: motions.map((m) => ({ roundLabel: m.roundLabel, seq: m.seq })) },
          },
        });
      }

      // Outround team win/loss → EliminationResult. We mark each team that
      // appeared in an outround as 'won' or 'lost' based on the per-debate
      // results table. Lets the CV builder compute "won the tournament" by
      // checking whether the user's team won the deepest outround stage.
      // Stage matches the round label from the landing-page nav (e.g. "Grand
      // Final"), reusing the same string the speaker-rounds extractor wrote
      // to TournamentParticipant.eliminationReached.
      for (const round of rounds) {
        if (!round.isOutround || !round.roundLabel) continue;
        for (const r of round.teamResults) {
          if (r.won == null) continue;
          const result = r.won ? 'won' : 'lost';
          await tx.eliminationResult.upsert({
            where: {
              tournamentId_stage_entityType_entityName: {
                tournamentId: t.id,
                stage: round.roundLabel,
                entityType: 'team',
                entityName: r.teamName,
              },
            },
            update: { result },
            create: {
              tournamentId: t.id,
              stage: round.roundLabel,
              entityType: 'team',
              entityName: r.teamName,
              result,
            },
          });
        }
      }

      // People + participants (speakers).
      //
      // Speaker round scores are NOT written here — for tournaments at WUDC
      // scale (~800 speakers × 9 rounds = 7200 rows), per-row upserts inside
      // the interactive transaction blew through the 30s tx timeout. We
      // instead collect rows into `speakerRoundScoreCreates` and bulk-write
      // them after the tx commits with `createMany`, which is one round-trip
      // for the entire payload. The `prepareTournamentWideRefresh` call
      // above already deleted any prior rows when refresh applies; on the
      // no-refresh path we rely on the (participantId, roundNumber,
      // positionLabel) unique constraint + skipDuplicates to be idempotent.
      const speakerRoundScoreCreates: Prisma.SpeakerRoundScoreCreateManyInput[] = [];
      const speakerParticipantIds: bigint[] = [];

      // Team-anchored fallback for redacted speaker names. See
      // findRedactedOwnerRow for the policy. Pure helper so the matching
      // rules are unit-testable without standing up a full ingest.
      const ownerName = snapshot.registration.personName;
      const ownerPersonId = ownerName ? lookupPersonId(ownerName) : null;
      const teamAnchoredOwnerRow = findRedactedOwnerRow(
        speakerRows,
        ownerName,
        snapshot.registration.teamName,
        lookupPersonId,
      );
      const resolveSpeakerPersonId = (sp: (typeof speakerRows)[number]): bigint | null => {
        const id = lookupPersonId(sp.speakerName);
        if (id) return id;
        if (sp === teamAnchoredOwnerRow && ownerPersonId) return ownerPersonId;
        return null;
      };

      // Pre-compute each speaker's PRIMARY team across the parse — the team
      // where they have the most scored prelim rounds. Iron-manning speakers
      // appear in multiple rows with different teamNames; the upsert below
      // would otherwise clobber teamName on every iteration. See
      // lib/calicotab/primaryTeam.ts for the rationale (audit issue #14:
      // resort-stability).
      const primaryTeamRows: Array<{ row: (typeof speakerRows)[number]; lookupId: bigint }> = [];
      for (const sp of speakerRows) {
        const id = resolveSpeakerPersonId(sp);
        if (id) primaryTeamRows.push({ row: sp, lookupId: id });
      }
      const primaryTeamByPerson = buildPrimaryTeamMap(primaryTeamRows);

      // Which round each score column is — by the nav round its label names,
      // else by position, never by the bare digit in "R1A". Every row of a
      // speaker tab carries the same columns in the same order, so the first
      // row with score columns stands for all. See lib/calicotab/roundNumbers.ts.
      const scoreColumns = (
        speakerRows.find((sp) => sp.roundScores.some((rs) => rs.positionLabel !== 'average'))
          ?.roundScores ?? []
      )
        .filter((rs) => rs.positionLabel !== 'average')
        .map((rs) => rs.roundLabel);
      const roundByColumn = speakerColumnRounds(
        scoreColumns,
        prelimRoundsFromNav(snapshot.navigation.resultsRoundLabels),
      );

      for (const sp of speakerRows) {
        // Fuzzy lookup: exact-match first, then substring + token-subset
        // fallbacks. Strict exact-match used to silently drop a user's
        // upsert when the speaker tab spelled their name slightly
        // differently from their claim ("Abhishek A." vs "Abhishek
        // Acharya"), leaving rank/avg/total fields as nulls written by
        // the prior `prepareTournamentWideRefresh`. The audit's biggest
        // user-visible gap. The team-anchored fallback above resolves
        // a separate edge case: redacted-name rows on the URL owner's
        // own team.
        const personId = resolveSpeakerPersonId(sp);
        if (!personId) continue;
        const teamNameToWrite = primaryTeamByPerson.get(personId) ?? sp.teamName;
        const breakRankForTeam = teamNameToWrite
          ? (teamBreakRankByTeam.get(teamNameToWrite) ?? null)
          : null;
        // The break rank belongs to the break pieces. A partial re-scrape
        // that read none has no ranks, and must keep the stored ones rather
        // than null them (Prisma leaves an undefined field untouched). Nor
        // may a failed break page null them: a team missing from the ranks
        // read may have broke on the page that failed, and the break retry
        // reads no speaker tab to put the rank back through this loop.
        const breakRankUpdate =
          options.only && !loadedKind('break')
            ? undefined
            : anyBreakFailed
              ? (breakRankForTeam ?? undefined)
              : breakRankForTeam;
        const participant = await tx.tournamentParticipant.upsert({
          where: { tournamentId_personId: { tournamentId: t.id, personId } },
          update: {
            teamName: teamNameToWrite,
            speakerScoreTotal: sp.totalScore as unknown as undefined,
            speakerRankOpen: sp.rank,
            speakerRankEsl: sp.rankEsl,
            speakerRankEfl: sp.rankEfl,
            speakerCategories: sp.categories,
            teamBreakRank: breakRankUpdate,
          },
          create: {
            tournamentId: t.id,
            personId,
            teamName: teamNameToWrite,
            speakerScoreTotal: sp.totalScore as unknown as undefined,
            speakerRankOpen: sp.rank,
            speakerRankEsl: sp.rankEsl,
            speakerRankEfl: sp.rankEfl,
            speakerCategories: sp.categories,
            // The primary team's break rank, as on update: teamBreakRank is read
            // beside teamName (lib/cv/teamPlacement.ts, /cv/verify), so the two
            // must name the same team. An iron-man's first row used to create
            // with that row's own team; a later row's update then overwrote it
            // in the same transaction, so stored rows already agree.
            teamBreakRank: breakRankUpdate,
          },
        });
        await tx.participantRole.upsert({
          where: {
            tournamentParticipantId_role: {
              tournamentParticipantId: participant.id,
              role: 'speaker',
            },
          },
          update: {},
          create: { tournamentParticipantId: participant.id, role: 'speaker' },
        });
        speakerParticipantIds.push(participant.id);
        let column = 0;
        for (const rs of sp.roundScores) {
          const isAverageScore = rs.positionLabel === 'average';
          const rn = isAverageScore ? 0 : roundByColumn[column++];
          if (rn == null) continue;
          speakerRoundScoreCreates.push({
            tournamentParticipantId: participant.id,
            roundNumber: rn,
            // A blank cell (the speaker sat the round out, or the tab hides
            // that score) is still written, as score null with label ''. It is
            // intended: it records that the column exists for this speaker, and
            // every score consumer (buildCvData, speakerStats, milestones,
            // statsFacts, exportFields) filters score != null, so it never
            // counts as a speech. Only /cv/verify's per-round list shows it,
            // as "—".
            positionLabel: rs.positionLabel ?? '',
            score: rs.score as unknown as undefined,
          });
        }
      }
      // Break ranks normally ride on the speaker rows above. A run that read
      // a break page but no speaker tab (a break retry, or a full scrape whose
      // speaker tab failed) has no speaker rows to carry them, so they are
      // written onto the stored participants of each team by name; without
      // this, a break page that failed once could never put its ranks back.
      // Only rows with no rank are filled: a tournament can have several break
      // categories (Open, ESL), and a run that read just one of them (the cron
      // retrying only the ESL break) must not overwrite a rank stored from
      // another by matching on team name alone.
      if (loadedKind('break') && !loadedKind('speaker')) {
        for (const [teamName, rank] of teamBreakRankByTeam) {
          await tx.tournamentParticipant.updateMany({
            where: { tournamentId: t.id, teamName, teamBreakRank: null },
            data: { teamBreakRank: rank },
          });
        }
      }

      // Persist the derived speaker rank (ROW_NUMBER over speakerScoreTotal DESC)
      // for this tournament. Replaces the per-CV-view derivation that used to
      // live in buildCvData.ts:262-291 — see sub-project 7. Tournament-scoped
      // WHERE is critical: dropping it would recompute ranks across the entire
      // table inside this transaction. Runs after every speaker upsert in this
      // ingest is complete so the ROW_NUMBER input set is consistent. Idempotent
      // across reingest: the same input rows produce the same output ranks.
      await tx.$executeRaw`
      UPDATE "TournamentParticipant" tp
      SET "speakerRankOpenDerived" = sub.r
      FROM (
        SELECT
          tp2.id,
          ROW_NUMBER() OVER (
            PARTITION BY tp2."tournamentId"
            ORDER BY tp2."speakerScoreTotal" DESC, tp2.id ASC
          ) AS r
        FROM "TournamentParticipant" tp2
        WHERE tp2."tournamentId" = ${t.id}
          AND tp2."speakerScoreTotal" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "ParticipantRole" pr
            WHERE pr."tournamentParticipantId" = tp2.id AND pr.role = 'speaker'
          )
      ) sub
      WHERE tp.id = sub.id
    `;

      // Adjudicator ROSTER (who's in the tournament) comes from the participants
      // list: write a TournamentParticipant row + 'judge' role per adjudicator
      // so the search-based claim flow on /cv can find them. Adjudicator JUDGING
      // HISTORY (rounds judged, chaired vs paneled, deepest outround) is still
      // sourced exclusively from the URL owner's private-URL Debates table by
      // recordJudgeRoundsFromLanding() — never from round-results panels.
      for (const p of mergedParticipantRows) {
        if (p.role !== 'adjudicator') continue;
        const personId = lookupPersonId(p.name);
        if (!personId) continue;
        const participant = await tx.tournamentParticipant.upsert({
          where: { tournamentId_personId: { tournamentId: t.id, personId } },
          update: {
            judgeTypeTag: p.judgeTag,
            // Only overwrite teamName when the participants list explicitly
            // gave one — adjs typically have null and we don't want to clobber
            // a speaker's team affiliation for swing participants.
            ...(p.teamName ? { teamName: p.teamName } : {}),
          },
          create: {
            tournamentId: t.id,
            personId,
            teamName: p.teamName,
            judgeTypeTag: p.judgeTag,
          },
        });
        await tx.participantRole.upsert({
          where: {
            tournamentParticipantId_role: {
              tournamentParticipantId: participant.id,
              role: 'judge',
            },
          },
          update: {},
          create: { tournamentParticipantId: participant.id, role: 'judge' },
        });
      }

      // The participants are stored: a staff-block name linked to someone before
      // this write may no longer be unique (a namesake joined), or may now have
      // its exact match. Re-check the links here, in the same transaction, so the
      // CV never reads a role off a link that no longer holds. No fetch.
      await rematchStaffNames(tx, t.id);

      // Break rows -> elimination_results. The row's existence (stage +
      // entityName) is the signal readers use — adjudicator-break detection
      // and EUDC stage collection in buildCvData both ignore `result`.
      // Historically this wrote `rank:N` into result; nothing ever read it
      // back (the rank lives on TournamentParticipant.teamBreakRank), so the
      // write stopped and the legacy rows were nulled by migration. `update`
      // is deliberately empty: a break row must never clobber a won/lost
      // value that the outround-results loop wrote for the same key.
      for (const row of breakRows) {
        await tx.eliminationResult.upsert({
          where: {
            tournamentId_stage_entityType_entityName: {
              tournamentId: t.id,
              stage: row.stage ?? 'break',
              entityType: row.entityType,
              entityName: row.entityName,
            },
          },
          update: {},
          create: {
            tournamentId: t.id,
            stage: row.stage ?? 'break',
            entityType: row.entityType,
            entityName: row.entityName,
          },
        });
      }

      return { tournamentId: t.id, speakerRoundScoreCreates, speakerParticipantIds };
    },
    { maxWait: 10000, timeout: txTimeoutMs },
  );
  // Tx timeout is 45s — leaves 15s headroom under the 60s Vercel Hobby
  // function budget for the post-tx bulk SpeakerRoundScore writes plus the
  // landing-derived per-round writes (recordJudgeRounds*, recordSpeakerRounds*).
}

async function finalizePostTransaction(
  loaded: LoadedState,
  fetched: FetchedTabs,
  txResult: TxResult,
  userId: string | null,
): Promise<IngestResult> {
  const { snapshot, urlVariants, landingHtml, fetchWarnings, tournamentFingerprint } = loaded;
  const { rounds } = fetched;
  const { tournamentId, speakerRoundScoreCreates, speakerParticipantIds } = txResult;

  // Bulk write speaker round scores OUTSIDE the main tx — keeps the main tx
  // small enough to fit WUDC-scale tournaments under the 60s function
  // budget. Scope the deleteMany to the participant IDs we're writing for
  // so we don't touch unrelated rows; createMany with skipDuplicates is
  // idempotent on the (participantId, roundNumber, positionLabel) unique
  // constraint.
  //
  // Wrap delete + create in their own short transaction so they succeed
  // together or roll back together. The previous two-statement form left
  // a window where the delete committed but the createMany failed (e.g.
  // a transient connection drop mid-bulk-insert), which silently destroyed
  // the user's per-round scores until the next successful re-ingest.
  if (speakerParticipantIds.length > 0 || speakerRoundScoreCreates.length > 0) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (speakerParticipantIds.length > 0) {
      ops.push(
        prisma.speakerRoundScore.deleteMany({
          where: { tournamentParticipantId: { in: speakerParticipantIds } },
        }),
      );
    }
    if (speakerRoundScoreCreates.length > 0) {
      ops.push(
        prisma.speakerRoundScore.createMany({
          data: speakerRoundScoreCreates,
          skipDuplicates: true,
        }),
      );
    }
    await prisma.$transaction(ops);
  }

  // No owner (the pre-scrape): nothing to link. The registration person,
  // their landing rounds and the DiscoveredUrl are a URL owner's alone.
  const linked = userId
    ? await withDeadlockRetry(() =>
        linkRegistrationPerson(tournamentId, snapshot.registration.personName, userId, urlVariants),
      )
    : null;
  if (linked) {
    // Is the URL owner registered as a speaker on this tournament? The
    // landing page's registration card sets `teamName` for speakers and
    // leaves it null for adjudicator-only registrations. When they're a
    // speaker, the Debates card legitimately has no adjudicator rounds
    // and the round-results panel search legitimately matches no judges
    // — both helpers emit diagnostics that surface as red warnings on
    // the dashboard, which read as failures even though the system is
    // working correctly. Suppress those diagnostics for speaker
    // registrations; still call recordJudgeRoundsFromLanding (which
    // PR #90 made idempotent — it preserves prior data) so a user who
    // was a JUDGE in a past ingest and is now a speaker doesn't lose
    // their old data via a different code path.
    const isLikelySpeaker = !!snapshot.registration.teamName;
    const r = await recordJudgeRoundsFromLanding(
      landingHtml,
      tournamentId,
      linked.personId,
      snapshot.registration.personName,
    );
    if (r.diagnostic && !isLikelySpeaker) fetchWarnings.push(r.diagnostic);
    await recordSpeakerRoundsFromLanding(
      landingHtml,
      tournamentId,
      linked.personId,
      snapshot.registration.teamName,
    );
    // Round-results panel search: skip entirely for speakers — they're
    // never on a panel by definition. For judges this is the fallback
    // when the Debates card is empty (tournament finished, Tabbycat
    // replaced the per-round table with a current-round-only widget).
    if (!isLikelySpeaker) {
      const fromResults = await recordJudgeRoundsFromRoundResults(
        rounds,
        tournamentId,
        linked.personId,
        snapshot.registration.personName,
      );
      if (fromResults.diagnostic) fetchWarnings.push(fromResults.diagnostic);
    }
  }

  // Mark the DiscoveredUrl as ingested + link to tournament (registrationPersonId set inside linkRegistrationPerson).
  if (userId) {
    await prisma.discoveredUrl.updateMany({
      where: { userId, url: { in: urlVariants } },
      data: { tournamentId, ingestedAt: new Date() },
    });
    // A user whose link has no email date writes year null above; another
    // user's dated link to the same tournament still gives it a year.
    await fillTournamentYearFromEmails(tournamentId);
  }

  return {
    tournamentId,
    fingerprint: tournamentFingerprint,
    cached: false,
    claimedPersonId: linked?.claimed ? linked.personId : null,
    claimedPersonName: linked?.claimed ? (snapshot.registration.personName ?? null) : null,
    parserVersion: PARSER_VERSION,
    totalTeams: fetched.totalTeams ?? null,
    totalParticipants: fetched.totalParticipants ?? null,
    warnings: fetchWarnings,
  };
}

// ─── Deadlock resilience ──────────────────────────────────────────────────

/**
 * Convert a tournament fingerprint (32-char hex string) to a signed bigint
 * usable as a Postgres advisory-lock key. We take the top 15 hex chars
 * (60 bits) so the result always fits in a positive int64, avoiding any
 * sign-bit weirdness with pg_advisory_xact_lock(int8).
 *
 * Different fingerprints have ~zero practical collision risk at 60 bits —
 * even at 100k tournaments, expected collisions are < 1 in 10 trillion.
 * If two truly distinct tournaments did happen to collide, they'd serialize
 * unnecessarily once (no correctness impact, just a tiny perf cost).
 */
function fingerprintLockKey(fingerprint: string): bigint {
  const hex = fingerprint.slice(0, 15) || '0';
  return BigInt(`0x${hex}`);
}

// Re-exported below for callers that need to distinguish deadlock-class
// failures (which warrant a queue reschedule, not a hard markJobFailed).
function isDeadlockError(e: unknown): boolean {
  // PostgreSQL error code 40P01 = deadlock_detected. Also matches the
  // post-exhaustion `withDeadlockRetry: exhausted` throw + Prisma's
  // P2034 "transaction failed due to a write conflict or a deadlock".
  const str = String(e);
  if (str.includes('40P01') || str.toLowerCase().includes('deadlock')) return true;
  const code = (e as { code?: string })?.code;
  if (code === 'P2034' || code === '40P01' || code === '40001') return true;
  return false;
}

export { isDeadlockError };

/**
 * Retry a DB operation up to `maxAttempts` times when PostgreSQL aborts it
 * with a deadlock (40P01). PostgreSQL automatically rolls back one of the
 * conflicting transactions so a simple retry is always safe here.
 */
async function withDeadlockRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i < maxAttempts - 1 && isDeadlockError(e)) {
        // Exponential backoff with full jitter: 100ms · 2^i + random(0..base).
        // Linear backoff (the previous 150*i pattern) caused two concurrent
        // ingests to retry in lockstep — both waiting the same delay, then
        // both trying again, deadlocking again. Random jitter de-syncs them.
        const base = 100 * Math.pow(2, i);
        const wait = base + Math.floor(Math.random() * base);
        await new Promise<void>((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  // unreachable — TypeScript needs the explicit throw
  throw new Error('withDeadlockRetry: exhausted');
}

/**
 * Returns true when the latest ParserRun for this SourceDocument is on the
 * current PARSER_VERSION. If the parser has been upgraded since the last
 * successful run, we want the ingest orchestrator to skip the freshness
 * cache and re-parse.
 */
async function isLatestParserRun(sourceDocumentId: string): Promise<boolean> {
  const latest = await prisma.parserRun.findFirst({
    where: { sourceDocumentId, success: true },
    orderBy: { createdAt: 'desc' },
    select: { parserVersion: true },
  });
  return latest?.parserVersion === PARSER_VERSION;
}

/**
 * Atomically upsert every unique Person up-front, *before* the main ingest
 * transaction opens. Each row is written in its own auto-committed statement
 * via `INSERT … ON CONFLICT DO UPDATE`, so there is no read-then-write window
 * for two concurrent sessions to race on. Names are deduped by normalizedName
 * and processed in sorted order, so concurrent ingests acquire the unique-
 * index locks in the same sequence.
 *
 * This replaces the per-row `tx.person.upsert(...)` that used to live inside
 * the main transaction. That pattern produced 40P01 deadlocks because each
 * subsequent `TournamentParticipant` insert took an FK ShareLock on the other
 * concurrent transaction (which had just touched the same Person row), and
 * two such ingests sharing any cross-tournament debater formed a circular
 * wait. Pre-committing the Person rows means FK validation never has to wait
 * on another in-progress transaction.
 *
 * Returns a Map<normalizedName, personId> the main transaction can look up
 * without doing any further Person writes.
 */
async function preCommitPersons(names: Iterable<string>): Promise<Map<string, bigint>> {
  // Dedupe by normalizedName; remember the first displayName seen.
  const unique = new Map<string, string>();
  for (const name of names) {
    const norm = normalizePersonName(name);
    if (!norm) continue;
    if (!unique.has(norm)) unique.set(norm, name);
  }
  const sorted = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const result = new Map<string, bigint>();
  for (const [normalizedName, displayName] of sorted) {
    const rows = await withDeadlockRetry(
      () =>
        prisma.$queryRaw<{ id: bigint }[]>`
        INSERT INTO "Person" ("displayName", "normalizedName")
        VALUES (${displayName}, ${normalizedName})
        ON CONFLICT ("normalizedName")
        -- Never refresh the name of someone who has asked to be withdrawn:
        -- the next re-ingest of any tournament they appear at would
        -- otherwise silently undo their erasure.
        DO UPDATE SET "displayName" = EXCLUDED."displayName"
        WHERE "Person"."suppressedAt" IS NULL
        RETURNING id
      `,
    );
    if (rows[0]) result.set(normalizedName, rows[0].id);
  }
  return result;
}

async function prepareTournamentWideRefresh(
  tx: Prisma.TransactionClient,
  tournamentId: bigint,
): Promise<void> {
  const participants = await tx.tournamentParticipant.findMany({
    where: { tournamentId },
    select: { id: true, personId: true },
  });
  const participantIds = participants.map((p) => p.id);
  const personIdsWithPrivateHistory = await tx.judgeAssignment.findMany({
    where: { tournamentId },
    select: { personId: true },
    distinct: ['personId'],
  });
  const protectedPersonIds = personIdsWithPrivateHistory.map((p) => p.personId);

  // Refresh tournament-wide data without erasing private-URL history that may
  // have been supplied by another user's URL for this same tournament. Leaf
  // tables (eliminationResult, teamResult, speakerRoundScore, participantRole)
  // are deleted outright since the upcoming parse will rewrite them in full;
  // tournamentParticipant rows themselves are kept (the speaker / adjudicator
  // upsert loops below either UPDATE them with fresh values or leave them
  // alone).
  //
  // We deliberately DO NOT null per-participant fields like speakerRankOpen /
  // speakerScoreTotal / teamName here. The upsert in the speaker loop runs
  // once per (tournamentId, personId) pair found in `speakerRows`, so when it
  // fires it overwrites those fields with fresh values from the new parse.
  // If the upsert does NOT fire — typically because the parser couldn't find
  // the speaker tab at all, or because a slightly different name spelling
  // didn't normalize-match the user's claim — pre-nulling would leave the
  // participant with all-null fields and the user would see their CV row
  // suddenly "lose" rank, average, etc. for that tournament. Trusting the
  // upsert to overwrite when it has data, and preserving last-good values
  // when it doesn't, is the right policy: re-ingest only ADDS data, never
  // wipes it. The regression guard upstream of this function blocks the
  // catastrophic-drop case.
  await tx.eliminationResult.deleteMany({ where: { tournamentId } });
  await tx.teamResult.deleteMany({ where: { tournamentId } });
  // Round-results JudgeAssignment rows are NOT cleared tournament-wide here.
  // Each writer replaces exactly the rows it owns: the URL owner's ingest
  // replaces the owner's (recordJudgeRoundsFromRoundResults, scoped delete +
  // create), and the pre-scrape replaces every judge's
  // (recordEveryJudgeFromRoundResults). A tournament-wide delete here would
  // let one user's re-ingest wipe the pre-scraped panels of every other judge
  // — and a judge served from the cache path has no rounds to rebuild them
  // from. Before the pre-scrape only URL owners ever had such rows, so the
  // narrower delete changes nothing for existing data. Landing-derived rows
  // (source='landing') were never cleared here either.
  if (participantIds.length > 0) {
    await tx.speakerRoundScore.deleteMany({
      where: { tournamentParticipantId: { in: participantIds } },
    });
    await tx.participantRole.deleteMany({
      where: { tournamentParticipantId: { in: participantIds } },
    });
  }
  await tx.tournamentParticipant.deleteMany({
    where: {
      tournamentId,
      person: { claimedByUserId: null },
      ...(protectedPersonIds.length > 0 ? { personId: { notIn: protectedPersonIds } } : {}),
    },
  });
}

/**
 * Upsert the Person from the private-URL landing page, link a
 * TournamentParticipant + DiscoveredUrl record, and — only when safe —
 * auto-claim the Person for the user.
 *
 * Auto-claim gate: we only set `claimedByUserId` when the user has already
 * confirmed (via /onboarding) that this normalized name is theirs. URL
 * possession alone is NOT proof of identity, because users routinely have
 * teammates' private URLs in their Gmail (forwarded invites, shared team
 * inboxes). Auto-claiming on URL possession produced wrong-identity rows on
 * the user's CV — the Person record for a teammate ended up `claimedByUserId
 * = thisUser`, so the teammate's tournament data appeared on the user's CV
 * under the user's name, AND the teammate vanished from teammate columns
 * (because the CV builder filters out claimed-as-self Persons from teammates).
 * New aliases must be added explicitly via /onboarding.
 *
 * COALESCE preserves any pre-existing claim (e.g. another user previously
 * shared the same URL) so we never silently steal an established claim. The
 * single atomic INSERT … ON CONFLICT DO UPDATE collapses what was once a
 * two-step upsert→update that produced 40P01 deadlocks under concurrent
 * ingests.
 *
 * Returns the personId always (so per-round writers can attach data to the
 * correct Person regardless of claim status) plus a `claimed` flag the
 * caller uses to decide whether to surface the "Linked to your CV" toast.
 */
async function linkRegistrationPerson(
  tournamentId: bigint,
  personName: string | null,
  userId: string,
  urlVariants: string[],
): Promise<{ personId: bigint; claimed: boolean } | null> {
  if (!personName) return null;
  // A registration named "Speaker 1" is a stand-in's private URL. Linking it
  // would point the URL at the shared stand-in Person and write the landing
  // page's judging history onto it.
  if (isPlaceholderPersonName(personName)) return null;
  const normalizedName = normalizePersonName(personName);
  if (!normalizedName) return null;

  // Has the user previously confirmed this name via onboarding? If so it's
  // safe to (re-)assert the claim here so the URL is immediately linked. If
  // not, leave the Person unclaimed and let the user opt in on /onboarding.
  const existingClaim = await prisma.person.findFirst({
    where: { claimedByUserId: userId, normalizedName },
    select: { id: true },
  });
  const claimUserId = existingClaim ? userId : null;

  const rows = await prisma.$queryRaw<{ id: bigint; claimedByUserId: string | null }[]>`
    INSERT INTO "Person" ("displayName", "normalizedName", "claimedByUserId")
    VALUES (${personName}, ${normalizedName}, ${claimUserId})
    ON CONFLICT ("normalizedName")
    DO UPDATE SET
      -- Suppressed rows keep their masked state and stay unclaimable.
      "displayName" = CASE
        WHEN "Person"."suppressedAt" IS NOT NULL THEN "Person"."displayName"
        ELSE EXCLUDED."displayName"
      END,
      "claimedByUserId" = CASE
        WHEN "Person"."suppressedAt" IS NOT NULL THEN "Person"."claimedByUserId"
        ELSE COALESCE("Person"."claimedByUserId", EXCLUDED."claimedByUserId")
      END
    RETURNING id, "claimedByUserId"
  `;
  const row = rows[0];
  if (!row) return null;

  await prisma.tournamentParticipant.upsert({
    where: { tournamentId_personId: { tournamentId, personId: row.id } },
    update: {},
    create: { tournamentId, personId: row.id },
  });

  await prisma.discoveredUrl.updateMany({
    where: { userId, url: { in: urlVariants } },
    data: { registrationPersonId: row.id, registrationName: personName },
  });

  return { personId: row.id, claimed: row.claimedByUserId === userId };
}

/**
 * Write the URL owner's per-round judging history straight from the "Debates"
 * card on the landing page. Called for every successful ingest where the
 * landing page identified a registration person. Idempotent — re-running on
 * the same URL is safe.
 *
 * Why this lives outside the main transaction: the registration person is
 * upserted by `linkRegistrationPerson` after the main tx commits, so the
 * personId isn't known until then. Splitting the writes also keeps the
 * landing-derived judging data on its own commit, separate from the tab data.
 */
async function recordJudgeRoundsFromLanding(
  landingHtml: string,
  tournamentId: bigint,
  personId: bigint,
  knownPersonName: string | null,
): Promise<{ written: number; chairedPrelims: number; diagnostic: string | null }> {
  const adjRounds = extractAdjudicatorRounds(landingHtml, knownPersonName);
  if (adjRounds.length === 0) {
    // Old behaviour deleted the user's JudgeAssignment rows + nulled
    // chairedPrelimRounds/lastOutroundChaired/lastOutroundPaneled here,
    // on the assumption that "0 adjudicator rounds parsed" means "URL
    // owner isn't on any panel". But the same signal also fires when
    // the tournament finishes and Tabbycat replaces the Debates card
    // with a static "you are not adjudicating this round" message — in
    // which case the parse legitimately can't see the table and we
    // would be silently destroying judge history that's correct on
    // disk. Same data-loss class as the PR #90 fix to
    // prepareTournamentWideRefresh: prefer preserving last-good values
    // over assuming an empty parse means "cleared". A user who
    // genuinely stops judging between ingests is vanishingly rare;
    // post-tournament Debates-card disappearance is common.
    return {
      written: 0,
      chairedPrelims: 0,
      diagnostic:
        'parse: 0 adjudicator rounds in private-URL Debates table — ' +
        "URL owner isn't on any panel, or the table heading + structure don't match the parser; " +
        'leaving any prior judge assignments in place rather than wiping them.',
    };
  }

  // Compute aggregates (chairedPrelims + deepest chair/panel outrounds) via
  // the shared helper. See lib/calicotab/judgeAggregates.ts for the rules
  // — same semantics this writer used inline before sub-project 9 dedup.
  const aggregates = computeJudgeAggregates(
    adjRounds.map((r): JudgeRound => ({
      stage: r.stage,
      role: r.role,
      roundNumber: r.roundNumber,
    })),
  );

  const uniqueRounds = new Map<string, (typeof adjRounds)[number]>();
  for (const r of adjRounds) {
    uniqueRounds.set(`${r.stage}|${r.role}|${r.roundNumber ?? ''}`, r);
  }

  await prisma.$transaction(async (tx) => {
    await tx.judgeAssignment.deleteMany({ where: { tournamentId, personId } });
    for (const r of uniqueRounds.values()) {
      await tx.judgeAssignment.create({
        data: {
          tournamentId,
          personId,
          stage: r.stage,
          panelRole: r.role,
          roundNumber: r.roundNumber,
          source: 'landing',
        },
      });
    }
    // Landing path is authoritative when present — overwrite mode.
    await writeJudgeParticipantRole(tx, tournamentId, personId, aggregates, 'overwrite');
  });
  return {
    written: uniqueRounds.size,
    chairedPrelims: aggregates.chairedPrelims,
    diagnostic: null,
  };
}

/**
 * Companion to `recordJudgeRoundsFromLanding`. Same Debates table, but for
 * the URL owner's TEAM: any row whose team-name cell is bolded (or matches
 * the registered team name) means the speaker spoke in that debate. Used
 * exclusively to populate `eliminationReached` — the deepest outround the
 * team reached — which the CV uses for the "Broken" indicator and the
 * "Last outround spoken" column.
 *
 * Idempotent: re-running on the same URL only updates the participant row,
 * never inserts duplicates.
 */
async function recordSpeakerRoundsFromLanding(
  landingHtml: string,
  tournamentId: bigint,
  personId: bigint,
  knownTeamName: string | null | undefined,
): Promise<{ outroundsSeen: number; deepest: string | null; diagnostic: string | null }> {
  const speakerRounds = extractSpeakerRounds(landingHtml, knownTeamName);
  if (speakerRounds.length === 0) {
    await prisma.tournamentParticipant.update({
      where: { tournamentId_personId: { tournamentId, personId } },
      data: { eliminationReached: null },
    });
    return { outroundsSeen: 0, deepest: null, diagnostic: null };
  }

  const outrounds = speakerRounds.filter((r) => r.roundNumber == null);
  const ranked = outrounds
    .map((r) => ({ r, rank: outroundRankStrict(r.stage) }))
    .filter((x): x is { r: typeof x.r; rank: number } => x.rank != null)
    .sort((a, b) =>
      compareOutroundDepth({ label: b.r.stage, rank: b.rank }, { label: a.r.stage, rank: a.rank }),
    );
  const deepest = ranked[0]?.r.stage ?? null;

  // Always write the current landing-page answer, including null when the team
  // did not appear in outrounds, so force re-ingest can clear stale breaks.
  const tp = await prisma.tournamentParticipant.upsert({
    where: { tournamentId_personId: { tournamentId, personId } },
    update: { eliminationReached: deepest },
    create: { tournamentId, personId, eliminationReached: deepest },
  });
  await prisma.participantRole.upsert({
    where: {
      tournamentParticipantId_role: {
        tournamentParticipantId: tp.id,
        role: 'speaker',
      },
    },
    update: {},
    create: { tournamentParticipantId: tp.id, role: 'speaker' },
  });

  // Persist outround win/loss for the user's team using the win indicator
  // detected on the Debates card itself (green up-arrow / text-success /
  // trophy icon next to the team name). Authoritative for THIS user's
  // outrounds — overrides anything `parseRoundResults` deduced from the
  // public per-round-results pages, where the win column is sometimes
  // absent or rendered only as an icon. source='landing' so
  // prepareTournamentWideRefresh leaves it alone on subsequent re-ingests.
  if (knownTeamName) {
    for (const r of outrounds) {
      if (r.won == null) continue;
      await prisma.eliminationResult.upsert({
        where: {
          tournamentId_stage_entityType_entityName: {
            tournamentId,
            stage: r.stage,
            entityType: 'team',
            entityName: knownTeamName,
          },
        },
        update: { result: r.won ? 'won' : 'lost' },
        create: {
          tournamentId,
          stage: r.stage,
          entityType: 'team',
          entityName: knownTeamName,
          result: r.won ? 'won' : 'lost',
        },
      });
    }
  }

  return { outroundsSeen: outrounds.length, deepest, diagnostic: null };
}

/**
 * Fallback judge-history source for tournaments where the private-URL
 * "Debates" card no longer carries the data — most commonly because the
 * tournament has finished, so Tabbycat shows only "In This Round: You are
 * not adjudicating this round." instead of the full per-round table that
 * `extractAdjudicatorRounds` parses.
 *
 * Round-results pages (/results/round/N/) keep the panel composition for
 * every round, indefinitely. Cross-reference each panel against the URL
 * owner's registration name, write a JudgeAssignment row per match, and
 * populate `chairedPrelimRounds` / `lastOutroundChaired` /
 * `lastOutroundPaneled` — but only when the Debates-card path didn't
 * already populate them, so the higher-confidence source wins on
 * tournaments where both exist.
 *
 * Idempotent: re-running on the same data is safe (find-then-create per
 * row plus conditional field updates).
 */
async function recordJudgeRoundsFromRoundResults(
  rounds: ReturnType<typeof parseRoundResults>[],
  tournamentId: bigint,
  personId: bigint,
  knownPersonName: string | null,
): Promise<{ written: number; matched: number; diagnostic: string | null }> {
  if (!knownPersonName) {
    return { written: 0, matched: 0, diagnostic: null };
  }

  const totalJudgeEntries = rounds.reduce((n, r) => n + (r?.judgeAssignments.length ?? 0), 0);
  const hits = judgeHitsFromRounds(rounds, (name) => personNameMatches(name, knownPersonName));

  if (hits.length === 0) {
    // Distinguish "round-results parser found no judges to match against"
    // (totalJudgeEntries === 0 — upstream parser problem) from "judges
    // were parsed but the URL owner's name didn't match any of them"
    // (totalJudgeEntries > 0 — name-matching problem). Each calls for a
    // different fix.
    return {
      written: 0,
      matched: 0,
      diagnostic: `parse: 0 round-results panels matched "${knownPersonName}" — searched ${rounds.length} rounds, ${totalJudgeEntries} total judge entries parsed`,
    };
  }

  // Atomic per-person replace, mirroring the landing path's delete+create.
  // The previous findFirst+create-per-hit pattern had two holes: the
  // (tournamentId, personId, stage, panelRole, roundNumber) unique can't
  // dedup rows whose roundNumber is NULL (outround hits — Postgres treats
  // NULLs as distinct in unique indexes), and two concurrent ingests
  // sharing a judge could both pass the findFirst check before either
  // created (TOCTOU). Deduping in memory and replacing inside one
  // transaction closes both for the common case; the audit migration
  // cleaned up duplicates the old window let through.
  //
  // Scoped to the rounds that loaded: a round page that failed this time
  // keeps the owner's stored panels for it (partial scrapes, 2026-10-30).
  // hits is non-empty here, so at least one round loaded and owned is set.
  const dedupedHits = dedupeJudgeHits(hits);
  const owned = judgeRowsOwnedByRounds(rounds) ?? { OR: [] };
  await prisma.$transaction([
    prisma.judgeAssignment.deleteMany({
      where: { tournamentId, personId, source: 'round_results', ...owned },
    }),
    prisma.judgeAssignment.createMany({
      data: dedupedHits.map((h) => ({
        tournamentId,
        personId,
        stage: h.stage,
        panelRole: h.role,
        roundNumber: h.roundNumber,
        source: 'round_results',
      })),
      skipDuplicates: true,
    }),
  ]);
  const written = dedupedHits.length;

  // Compute aggregates (same semantics as the landing-path writer; both
  // sites share lib/calicotab/judgeAggregates.ts). Round-results hits use
  // role: 'chair' | 'panellist' | 'trainee', read off the adjudicator
  // cell's symbol.
  const aggregates = computeJudgeAggregates(
    hits.map((h): JudgeRound => ({ stage: h.stage, role: h.role, roundNumber: h.roundNumber })),
  );

  // Merge with whatever the Debates card path already wrote: only fill in
  // null fields, never overwrite. Debates card data is more authoritative
  // (URL owner is explicitly bolded there) so when it ran successfully its
  // values stand.
  await writeJudgeParticipantRole(prisma, tournamentId, personId, aggregates, 'fillNullsOnly');

  return { written, matched: hits.length, diagnostic: null };
}
