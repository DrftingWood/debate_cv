import { prisma } from '@/lib/db';
import { fetchHtmlWithProvenance, fetchRoundWithProvenance } from './fetch';
import { parsePrivateUrlPage, extractAdjudicatorRounds } from './parseNav';
import {
  parseTeamTab,
  parseSpeakerTab,
  parseRoundResults,
  parseBreakPage,
  parseParticipantsList,
  diagnoseVueData,
} from './parseTabs';
import {
  computeFingerprint,
  extractYearFromName,
  normalizePersonName,
} from './fingerprint';
import { PARSER_VERSION } from './version';
import { collectRegistrationWarnings, recordParserRun } from './provenance';
import { detectFormatFromTeamSize } from './format';
import { getInroundsChairedCount } from './judgeStats';

const FRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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

export async function ingestPrivateUrl(
  url: string,
  userId: string,
  options: { force?: boolean } = {},
): Promise<IngestResult> {
  const normalized = url.replace(/\/+$/, '') + '/';
  const parsedUrl = new URL(normalized);
  const tournamentSlug = parsedUrl.pathname.split('/').filter(Boolean)[0] ?? null;

  // Landing page fetch — with provenance so every parse has a stable source.
  const landingResult = await fetchHtmlWithProvenance(normalized);
  if (!landingResult.ok) {
    // Surface the HTTP failure as the job's error so it shows up on the
    // dashboard and in ParserRun history. `bodyPreview` gives the operator
    // a hint when the upstream serves an HTML error page (e.g. Cloudflare).
    throw new Error(
      `fetch landing ${normalized} → HTTP ${landingResult.status}: ${landingResult.bodyPreview
        .replace(/\s+/g, ' ')
        .slice(0, 180)}`,
    );
  }
  const landingDoc = landingResult;
  const landingHtml = landingDoc.html;
  // Collected across the whole ingest and attached to the landing ParserRun.
  const fetchWarnings: string[] = [];

  const parseStart = Date.now();
  const snapshot = parsePrivateUrlPage(landingHtml, normalized);
  const landingWarnings = collectRegistrationWarnings(snapshot);

  const year = extractYearFromName(snapshot.tournamentName);
  const fingerprint = computeFingerprint({
    host: parsedUrl.host,
    tournamentSlug,
    tournamentName: snapshot.tournamentName,
    year,
  });

  const existing = await prisma.tournament.findUnique({ where: { fingerprint } });
  if (existing && !options.force) {
    const ageMs = Date.now() - existing.scrapedAt.getTime();
    const fresh = ageMs < FRESH_WINDOW_MS;
    // Reparse invalidation: if PARSER_VERSION bumped since the last successful
    // parser run for this tournament's landing page, skip the cache and re-ingest.
    const parserUpToDate = await isLatestParserRun(landingDoc.sourceDocumentId);
    if (fresh && parserUpToDate) {
      await recordParserRun({
        sourceDocumentId: landingDoc.sourceDocumentId,
        parserName: 'parseNav',
        success: true,
        warnings: landingWarnings,
        durationMs: Date.now() - parseStart,
      });
      const claimedPersonId = await withDeadlockRetry(() =>
        linkRegistrationPerson(existing.id, snapshot.registration.personName, userId, normalized),
      );
      if (claimedPersonId) {
        await recordJudgeRoundsFromLanding(landingHtml, existing.id, claimedPersonId);
      }
      await prisma.discoveredUrl.updateMany({
        where: { userId, url: normalized },
        data: { tournamentId: existing.id, ingestedAt: new Date() },
      });
      return {
        tournamentId: existing.id,
        fingerprint,
        cached: true,
        claimedPersonId,
        claimedPersonName: claimedPersonId ? (snapshot.registration.personName ?? null) : null,
        parserVersion: PARSER_VERSION,
        totalTeams: existing.totalTeams,
        totalParticipants: existing.totalParticipants,
        warnings: landingWarnings,
      };
    }
  }

  // Fetch and parse tabs in parallel (bounded: these are same host, so fetch throttles).
  const nav = snapshot.navigation;
  // Build a shared fetch helper for this ingest that records failures into
  // the fetchWarnings buffer so the landing ParserRun tells the operator
  // exactly which tabs upstream refused to serve.
  const fetchTab = async (targetUrl: string, label: string): Promise<string | null> => {
    const r = await fetchHtmlWithProvenance(targetUrl, { referer: normalized });
    if (r.ok) return r.html;
    const hint =
      r.status === 403 && !process.env.SCRAPER_API_KEY
        ? ' (set SCRAPER_API_KEY to bypass Cloudflare blocking)'
        : '';
    fetchWarnings.push(
      `fetch: ${label} HTTP ${r.status}${hint}${r.bodyPreview ? ` — ${r.bodyPreview.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`,
    );
    return null;
  };
  const fetchRound = async (
    targetUrl: string,
  ): Promise<{ url: string; html: string } | null> => {
    const r = await fetchRoundWithProvenance(targetUrl, { referer: normalized });
    if (r.ok) return { url: r.url, html: r.html };
    fetchWarnings.push(`fetch: round ${targetUrl} HTTP ${r.status}`);
    return null;
  };

  const [teamHtml, speakerHtml, participantsHtml] = await Promise.all([
    nav.teamTab ? fetchTab(nav.teamTab, 'teamTab') : Promise.resolve(null),
    nav.speakerTab ? fetchTab(nav.speakerTab, 'speakerTab') : Promise.resolve(null),
    nav.participants ? fetchTab(nav.participants, 'participants') : Promise.resolve(null),
  ]);
  // Round results: prefer the by-debate view so each row is one debate and
  // adjudicators are scoped to their own debate (sidesteps double-counting
  // that the by-team pivot can introduce).
  const roundHtmls = await Promise.all(nav.resultsRounds.map((u) => fetchRound(u)));
  const breakHtmls = await Promise.all(
    nav.breakTabs.map(async (u) => {
      const html = await fetchTab(u, 'break');
      return html ? { url: u, html } : null;
    }),
  );

  const teamRows = teamHtml ? parseTeamTab(teamHtml) : [];
  if (teamRows.length === 0 && teamHtml) {
    fetchWarnings.push(`parse: teamTab → 0 rows — ${diagnoseVueData(teamHtml, ['team'])}`);
  }

  const speakerRows = speakerHtml ? parseSpeakerTab(speakerHtml) : [];
  if (speakerRows.length === 0 && speakerHtml) {
    fetchWarnings.push(`parse: speakerTab → 0 rows — ${diagnoseVueData(speakerHtml, ['name', 'speaker'])}`);
  }

  const participantRows = participantsHtml ? parseParticipantsList(participantsHtml) : [];
  if (participantRows.length === 0 && participantsHtml) {
    fetchWarnings.push(`parse: participants → 0 rows — ${diagnoseVueData(participantsHtml, ['name'])}`);
  }

  const rounds = roundHtmls
    .filter((x): x is { url: string; html: string } => !!x)
    .map(({ url: u, html }) => {
      const r = parseRoundResults(html, u);
      if (r.teamResults.length === 0) {
        fetchWarnings.push(`parse: round ${u} → 0 results — ${diagnoseVueData(html, ['team'])}`);
      }
      return r;
    });
  const breakRows = breakHtmls
    .filter((x): x is { url: string; html: string } => !!x)
    .flatMap(({ url: u, html }) => parseBreakPage(html, u));
  const tournamentName = snapshot.tournamentName ?? tournamentSlug ?? 'Unknown tournament';
  const totalParticipants = participantRows.length || speakerRows.length || null;
  const totalTeams = teamRows.length || null;
  const format = inferTournamentFormat({
    tournamentName,
    teamRows,
    speakerRows,
  });
  const teamBreakRankByTeam = new Map<string, number>();
  for (const row of breakRows) {
    if (row.entityType !== 'team' || row.rank == null) continue;
    if (!teamBreakRankByTeam.has(row.entityName)) teamBreakRankByTeam.set(row.entityName, row.rank);
  }

  // Record the full ParserRun once all tab fetches + parses are done so
  // both landing warnings and per-tab fetch failures (fetchWarnings) land
  // in the same row. Lets /cv/verify surface "tab fetch returned 403" next
  // to the tournament card rather than showing silent empty tables.
  await recordParserRun({
    sourceDocumentId: landingDoc.sourceDocumentId,
    parserName: 'parseNav',
    success:
      (!!snapshot.tournamentName || snapshot.navigation.resultsRounds.length > 0) &&
      fetchWarnings.length === 0,
    warnings: [...landingWarnings, ...fetchWarnings],
    durationMs: Date.now() - parseStart,
  });

  // Pre-commit every Person referenced anywhere in this ingest before opening
  // the main transaction. Doing the upserts inside the long transaction held
  // FK ShareLocks across concurrent ingests and triggered 40P01 deadlocks.
  const allPersonNames = new Set<string>();
  for (const sp of speakerRows) allPersonNames.add(sp.speakerName);
  for (const p of participantRows) {
    if (p.role === 'adjudicator') allPersonNames.add(p.name);
  }
  for (const round of rounds) {
    for (const j of round.judgeAssignments) allPersonNames.add(j.personName);
  }
  const personIdByNormalized = await preCommitPersons(allPersonNames);

  const tournamentId = await prisma.$transaction(async (tx) => {
    const t = await tx.tournament.upsert({
      where: { fingerprint },
      update: {
        name: tournamentName,
        format,
        year,
        totalParticipants,
        totalTeams,
        sourceUrlRaw: normalized,
        sourceHost: parsedUrl.host,
        sourceTournamentSlug: tournamentSlug,
        scrapedAt: new Date(),
      },
      create: {
        name: tournamentName,
        format,
        year,
        totalParticipants,
        totalTeams,
        sourceUrlRaw: normalized,
        sourceHost: parsedUrl.host,
        sourceTournamentSlug: tournamentSlug,
        fingerprint,
      },
    });

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
          wins: row.wins,
          points: row.totalPoints,
        },
        create: {
          tournamentId: t.id,
          teamName: row.teamName,
          roundNumber: 0,
          wins: row.wins,
          points: row.totalPoints,
        },
      });
    }

    // Per-round team results
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
          },
          create: {
            tournamentId: t.id,
            teamName: r.teamName,
            roundNumber: round.roundNumber,
            points: r.points,
            wins: r.won === true ? 1 : r.won === false ? 0 : null,
          },
        });
      }
    }

    // People + participants (speakers)
    for (const sp of speakerRows) {
      const personId = personIdByNormalized.get(normalizePersonName(sp.speakerName));
      if (!personId) continue;
      const participant = await tx.tournamentParticipant.upsert({
        where: { tournamentId_personId: { tournamentId: t.id, personId } },
        update: {
          teamName: sp.teamName,
          speakerScoreTotal: sp.totalScore as unknown as undefined,
          speakerRankOpen: sp.rank,
          speakerRankEsl: sp.rankEsl,
          speakerRankEfl: sp.rankEfl,
          teamBreakRank: sp.teamName ? (teamBreakRankByTeam.get(sp.teamName) ?? null) : null,
        },
        create: {
          tournamentId: t.id,
          personId,
          teamName: sp.teamName,
          speakerScoreTotal: sp.totalScore as unknown as undefined,
          speakerRankOpen: sp.rank,
          speakerRankEsl: sp.rankEsl,
          speakerRankEfl: sp.rankEfl,
          teamBreakRank: sp.teamName ? (teamBreakRankByTeam.get(sp.teamName) ?? null) : null,
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
      for (const rs of sp.roundScores) {
        const m = rs.roundLabel.match(/\d+/);
        if (!m) continue;
        const rn = Number(m[0]);
        await tx.speakerRoundScore.upsert({
          where: {
            tournamentParticipantId_roundNumber_positionLabel: {
              tournamentParticipantId: participant.id,
              roundNumber: rn,
              positionLabel: rs.positionLabel ?? '',
            },
          },
          update: { score: rs.score as unknown as undefined },
          create: {
            tournamentParticipantId: participant.id,
            roundNumber: rn,
            positionLabel: rs.positionLabel ?? '',
            score: rs.score as unknown as undefined,
          },
        });
      }
    }

    // Adjudicator data is intentionally NOT written from the participants
    // list or from round-results judge panels. It now comes exclusively from
    // the URL owner's "Debates" table on the private-URL landing page —
    // see recordJudgeRoundsFromLanding() called below the main transaction.
    // Reasons: (a) the user explicitly limited adjudicator scope to the
    // private URL, and (b) round-results panels listed every adj on every
    // debate, which depended on tab-name fuzzy matching to attribute rounds
    // to the right person. Single-source from the private URL is exact.

    // Break rows -> elimination_results
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
        update: { result: row.rank != null ? `rank:${row.rank}` : null },
        create: {
          tournamentId: t.id,
          stage: row.stage ?? 'break',
          entityType: row.entityType,
          entityName: row.entityName,
          result: row.rank != null ? `rank:${row.rank}` : null,
        },
      });
    }

    return t.id;
  }, { maxWait: 10000, timeout: 30000 });

  const claimedPersonId = await withDeadlockRetry(() =>
    linkRegistrationPerson(tournamentId, snapshot.registration.personName, userId, normalized),
  );
  if (claimedPersonId) {
    await recordJudgeRoundsFromLanding(landingHtml, tournamentId, claimedPersonId);
  }

  // Mark the DiscoveredUrl as ingested + link to tournament (registrationPersonId set inside linkRegistrationPerson).
  await prisma.discoveredUrl.updateMany({
    where: { userId, url: normalized },
    data: { tournamentId, ingestedAt: new Date() },
  });

  return {
    tournamentId,
    fingerprint,
    cached: false,
    claimedPersonId,
    claimedPersonName: claimedPersonId ? (snapshot.registration.personName ?? null) : null,
    parserVersion: PARSER_VERSION,
    totalTeams: totalTeams ?? null,
    totalParticipants: totalParticipants ?? null,
    warnings: fetchWarnings,
  };
}

/**
 * Guess the tournament format. Signals considered, in priority order:
 *
 *   1. Explicit format names in the tournament title
 *      ("British Parliamentary", "BP", "AP", "WSDC", "Worlds Schools",
 *      "Policy", "Lincoln-Douglas", "Public Forum").
 *   2. Known BP-format event names ("WUDC", "EUDC", "AUDC", "NAUDC").
 *   3. Team-size from the team tab — BP = 2 speakers per team,
 *      AP / WSDC = 3+. The old fallback that guessed BP from a 2-round
 *      speaker-score pattern was noise (BP tournaments have 6-9 rounds too)
 *      and was producing false "Asian Parliamentary" tags on BP events.
 */
function inferTournamentFormat({
  tournamentName,
  teamRows,
}: {
  tournamentName: string;
  teamRows: { speakers: string[] }[];
  speakerRows: { roundScores: unknown[] }[];
}): string | null {
  const name = tournamentName.toLowerCase();

  // Explicit format keywords first — user-authored tournament names rarely
  // lie about the format.
  if (/british parliamentary|\bbp\b/.test(name)) return 'British Parliamentary';
  if (/asian parliamentary|\bap\b/.test(name)) return 'Asian Parliamentary';
  if (/worlds schools|\bwsdc\b/.test(name)) return 'World Schools';
  if (/\bpolicy\b/.test(name) && !/public\s*policy/.test(name)) return 'Policy';
  if (/lincoln[-\s]?douglas|\bld\b/.test(name)) return 'Lincoln-Douglas';
  if (/public forum|\bpf\b/.test(name)) return 'Public Forum';

  // Well-known BP-format events.
  if (/\bwudc\b|\beudc\b|\baudc\b|\bnaudc\b|\babp\b|\bbpp\b/.test(name)) {
    return 'British Parliamentary';
  }

  // Structural signal — pick the median speaker count across teams and feed
  // it through the modular detectFormatFromTeamSize() helper. Teams with
  // missing / zero speakers are excluded so a half-imported tab doesn't
  // skew the median to 0.
  const speakerCounts = teamRows
    .map((r) => r.speakers.length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (speakerCounts.length >= 3) {
    const mid = speakerCounts[Math.floor(speakerCounts.length / 2)]!;
    const detected = detectFormatFromTeamSize(mid);
    if (detected !== 'unknown') return detected;
  }

  return null;
}

// ─── Deadlock resilience ──────────────────────────────────────────────────

function isDeadlockError(e: unknown): boolean {
  // PostgreSQL error code 40P01 = deadlock_detected.
  return String(e).includes('40P01') || String(e).toLowerCase().includes('deadlock');
}

/**
 * Retry a DB operation up to `maxAttempts` times when PostgreSQL aborts it
 * with a deadlock (40P01). PostgreSQL automatically rolls back one of the
 * conflicting transactions so a simple retry is always safe here.
 */
async function withDeadlockRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i < maxAttempts - 1 && isDeadlockError(e)) {
        await new Promise<void>((r) => setTimeout(r, (i + 1) * 150));
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
async function preCommitPersons(
  names: Iterable<string>,
): Promise<Map<string, bigint>> {
  // Dedupe by normalizedName; remember the first displayName seen.
  const unique = new Map<string, string>();
  for (const name of names) {
    const norm = normalizePersonName(name);
    if (!norm) continue;
    if (!unique.has(norm)) unique.set(norm, name);
  }
  const sorted = [...unique.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const result = new Map<string, bigint>();
  for (const [normalizedName, displayName] of sorted) {
    const rows = await withDeadlockRetry(() =>
      prisma.$queryRaw<{ id: bigint }[]>`
        INSERT INTO "Person" ("displayName", "normalizedName")
        VALUES (${displayName}, ${normalizedName})
        ON CONFLICT ("normalizedName")
        DO UPDATE SET "displayName" = EXCLUDED."displayName"
        RETURNING id
      `,
    );
    if (rows[0]) result.set(normalizedName, rows[0].id);
  }
  return result;
}

/**
 * Upsert the Person from the private-URL landing page, link a
 * TournamentParticipant + DiscoveredUrl record, and auto-claim the Person
 * for the user.
 *
 * Private-URL ownership is sufficient proof of identity: Tabbycat sends one
 * URL per registered participant. Every URL the user uploads is auto-claimed
 * unconditionally. Manual review UI was removed in the dashboard cleanup.
 *
 * COALESCE preserves any pre-existing claim (e.g. another user previously
 * shared the same URL) so we never silently steal an established claim. The
 * single atomic INSERT … ON CONFLICT DO UPDATE collapses what was once a
 * two-step upsert→update that produced 40P01 deadlocks under concurrent
 * ingests.
 */
async function linkRegistrationPerson(
  tournamentId: bigint,
  personName: string | null,
  userId: string,
  url: string,
): Promise<bigint | null> {
  if (!personName) return null;
  const normalizedName = normalizePersonName(personName);
  if (!normalizedName) return null;

  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    INSERT INTO "Person" ("displayName", "normalizedName", "claimedByUserId")
    VALUES (${personName}, ${normalizedName}, ${userId})
    ON CONFLICT ("normalizedName")
    DO UPDATE SET
      "displayName" = EXCLUDED."displayName",
      "claimedByUserId" = COALESCE("Person"."claimedByUserId", EXCLUDED."claimedByUserId")
    RETURNING id
  `;
  const personId = rows[0]?.id;
  if (!personId) return null;

  await prisma.tournamentParticipant.upsert({
    where: { tournamentId_personId: { tournamentId, personId } },
    update: {},
    create: { tournamentId, personId },
  });

  await prisma.discoveredUrl.updateMany({
    where: { userId, url },
    data: { registrationPersonId: personId, registrationName: personName },
  });

  return personId;
}

/**
 * Score an outround stage so we can compute "deepest reached" by max rank.
 * Mirrors the helper on /cv — kept private here to avoid a cross-package
 * dependency on the page module.
 */
function outroundStageRank(stage: string | null | undefined): number | null {
  if (!stage) return null;
  const s = stage.toLowerCase();
  if (/grand\s*final|\bgf\b/.test(s)) return 110;
  if (/^finals?$|^the\s*final$/.test(s)) return 100;
  if (/semi[-\s]?final|\bsf\b/.test(s)) return 90;
  if (/quarter[-\s]?final|\bqf\b|quarters/.test(s)) return 80;
  if (/octo[-\s]?final|\boctos?\b/.test(s)) return 70;
  if (/double\s*octo|\bdoubles\b/.test(s)) return 60;
  if (/triple\s*octo|\btriples\b/.test(s)) return 50;
  return null;
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
): Promise<{ written: number; chairedPrelims: number }> {
  const adjRounds = extractAdjudicatorRounds(landingHtml);
  if (adjRounds.length === 0) return { written: 0, chairedPrelims: 0 };

  // Idempotent insert per row. The unique key includes nullable columns so
  // Prisma's compound-unique filter can't be used — same findFirst+create
  // pattern the codebase uses elsewhere for that case.
  for (const r of adjRounds) {
    const existing = await prisma.judgeAssignment.findFirst({
      where: {
        tournamentId,
        personId,
        stage: r.stage,
        panelRole: r.role,
        roundNumber: r.roundNumber,
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.judgeAssignment.create({
        data: {
          tournamentId,
          personId,
          stage: r.stage,
          panelRole: r.role,
          roundNumber: r.roundNumber,
        },
      });
    }
  }

  // Aggregate stats for the participant row. getInroundsChairedCount classifies
  // each round via classifyRoundLabel (numeric → inround, named → outround) so
  // that prelims tagged with non-numeric labels in some Tabbycat installs
  // still count, and never inflate the count from outround chairs.
  const chairedPrelims = getInroundsChairedCount(
    adjRounds.map((r) => ({ stage: r.stage, panelRole: r.role })),
  );
  const outrounds = adjRounds.filter((r) => r.roundNumber == null);
  const ranked = outrounds
    .map((r) => ({ r, rank: outroundStageRank(r.stage) }))
    .filter((x): x is { r: typeof x.r; rank: number } => x.rank != null)
    .sort((a, b) => b.rank - a.rank);
  const deepestChaired = ranked.find((x) => x.r.role === 'chair')?.r.stage ?? null;
  const deepestPaneled =
    ranked.find((x) => x.r.role === 'panellist' || x.r.role === 'trainee')?.r.stage ?? null;

  const tp = await prisma.tournamentParticipant.upsert({
    where: { tournamentId_personId: { tournamentId, personId } },
    update: {
      judgeTypeTag: 'Adjudicator',
      chairedPrelimRounds: chairedPrelims || null,
      lastOutroundChaired: deepestChaired,
      lastOutroundPaneled: deepestPaneled,
    },
    create: {
      tournamentId,
      personId,
      judgeTypeTag: 'Adjudicator',
      chairedPrelimRounds: chairedPrelims || null,
      lastOutroundChaired: deepestChaired,
      lastOutroundPaneled: deepestPaneled,
    },
  });
  await prisma.participantRole.upsert({
    where: {
      tournamentParticipantId_role: {
        tournamentParticipantId: tp.id,
        role: 'judge',
      },
    },
    update: {},
    create: { tournamentParticipantId: tp.id, role: 'judge' },
  });
  return { written: adjRounds.length, chairedPrelims };
}
