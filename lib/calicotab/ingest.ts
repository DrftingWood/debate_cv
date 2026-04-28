import * as Sentry from '@sentry/nextjs';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { fetchHtmlWithProvenance, fetchRoundWithProvenance } from './fetch';
import {
  parsePrivateUrlPage,
  extractAdjudicatorRounds,
  extractSpeakerRounds,
  normalizeStageLabel,
} from './parseNav';
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
import { normalizePrivateUrl, privateUrlVariants } from '@/lib/gmail/extract';

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
  const normalized = normalizePrivateUrl(url);
  const urlVariants = privateUrlVariants(url);
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
    if (fresh && parserUpToDate && !cacheStale) {
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
        const r = await recordJudgeRoundsFromLanding(
          landingHtml,
          existing.id,
          linked.personId,
          snapshot.registration.personName,
        );
        if (r.diagnostic) landingWarnings.push(r.diagnostic);
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
      return {
        tournamentId: existing.id,
        fingerprint,
        cached: true,
        claimedPersonId: linked?.claimed ? linked.personId : null,
        claimedPersonName: linked?.claimed ? (snapshot.registration.personName ?? null) : null,
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

  // Private URL landing pages can include a registration card whose role label
  // (e.g. "Independent adjudicator") is the only reliable signal for some
  // tournaments. Merge those rows in so role classification doesn't depend
  // solely on /participants table availability/shape.
  const landingParticipantRows = parseParticipantsList(landingHtml);
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

  const rounds = roundHtmls
    .filter((x): x is { url: string; html: string } => !!x)
    .map(({ url: u, html }) => {
      // Pass the landing-page nav's link text for this URL — it's the
      // authoritative round label ("Quarterfinals" not "SIDO 2026") and
      // protects classifyRoundLabel / outroundStageRank from a generic
      // page heading.
      const navLabel = nav.resultsRoundLabels?.[u];
      const r = parseRoundResults(html, u, navLabel);
      if (r.teamResults.length === 0) {
        fetchWarnings.push(`parse: round ${u} → 0 results — ${diagnoseVueData(html, ['team'])}`);
      }
      return r;
    });
  const breakRows = breakHtmls
    .filter((x): x is { url: string; html: string } => !!x)
    .flatMap(({ url: u, html }) => parseBreakPage(html, u));
  const tournamentName = snapshot.tournamentName ?? tournamentSlug ?? 'Unknown tournament';
  const totalParticipants = mergedParticipantRows.length || speakerRows.length || null;
  const totalTeams = teamRows.length || null;
  const format = inferTournamentFormat({
    tournamentName,
    teamRows,
    speakerRows,
    registrationSpeakers: snapshot.registration.speakers,
  });
  // Multi-category breaks (BP-style: Open + ESL + EFL): a team can appear in
  // more than one break tab. The earlier "first wins" pick was order-dependent
  // (alphabetical URL sort: EFL before Open) — wrong because Open is the
  // primary break for nearly every tournament. Pick by category priority
  // instead so a team that broke Open keeps the Open rank, falling back to
  // ESL → EFL → other only when Open is absent.
  const breakCategoryPriority = (stage: string | null): number => {
    if (!stage) return 0;
    if (stage === 'Open') return 100;
    if (stage === 'ESL') return 80;
    if (stage === 'EFL') return 60;
    return 40;
  };
  const teamBreakRankByTeam = new Map<string, number>();
  const teamBreakStageByTeam = new Map<string, string | null>();
  for (const row of breakRows) {
    if (row.entityType !== 'team' || row.rank == null) continue;
    const newPriority = breakCategoryPriority(row.stage ?? null);
    const existingPriority = breakCategoryPriority(teamBreakStageByTeam.get(row.entityName) ?? null);
    if (!teamBreakRankByTeam.has(row.entityName) || newPriority > existingPriority) {
      teamBreakRankByTeam.set(row.entityName, row.rank);
      teamBreakStageByTeam.set(row.entityName, row.stage ?? null);
    }
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

  // Partial ingest is worse than no ingest: if any tab fetch failed (HTTP
  // 403, timeout) we'd be about to commit a tournament with missing speaker
  // / team / round data, then mark its DiscoveredUrl as ingested — which
  // hides the failure forever. Abort instead so the queue retries the job
  // (drain/cron handlers reschedule on throw, up to MAX_ATTEMPTS=3). The
  // ParserRun above already recorded the failure for /cv/verify.
  const fetchLevelFailures = fetchWarnings.filter((w) => w.startsWith('fetch:'));
  if (fetchLevelFailures.length > 0) {
    throw new Error(
      `Aborting ingest: ${fetchLevelFailures.length} tab fetch(es) failed — ` +
        fetchLevelFailures.map((w) => w.slice(0, 120)).join('; '),
    );
  }

  // Regression guard: if a re-ingest would drop the totals by >50% (and the
  // old tournament had non-trivial counts), assume the source page is
  // temporarily degraded (rate-limited, partial render) and serve the cached
  // record instead of overwriting good data with garbage. options.force
  // bypasses for explicit manual re-ingests.
  if (existing && !options.force) {
    const oldTeams = existing.totalTeams ?? 0;
    const oldParticipants = existing.totalParticipants ?? 0;
    const newTeams = totalTeams ?? 0;
    const newParticipants = totalParticipants ?? 0;
    const teamsDropped = oldTeams > 5 && newTeams < oldTeams * 0.5;
    const participantsDropped = oldParticipants > 5 && newParticipants < oldParticipants * 0.5;
    if (teamsDropped || participantsDropped) {
      const msg =
        `Regression guard: re-ingest would drop data — ` +
        `teams ${oldTeams}→${newTeams}, participants ${oldParticipants}→${newParticipants}`;
      Sentry.captureMessage(msg, { level: 'warning', tags: { fingerprint } });
      const linked = await withDeadlockRetry(() =>
        linkRegistrationPerson(existing.id, snapshot.registration.personName, userId, urlVariants),
      );
      await prisma.discoveredUrl.updateMany({
        where: { userId, url: { in: urlVariants } },
        data: { tournamentId: existing.id, ingestedAt: new Date() },
      });
      return {
        tournamentId: existing.id,
        fingerprint,
        cached: true,
        claimedPersonId: linked?.claimed ? linked.personId : null,
        claimedPersonName: linked?.claimed ? (snapshot.registration.personName ?? null) : null,
        parserVersion: PARSER_VERSION,
        totalTeams: existing.totalTeams,
        totalParticipants: existing.totalParticipants,
        warnings: [...fetchWarnings, 'regression-guard: overwrite blocked'],
      };
    }
  }

  // Pre-commit every Person referenced anywhere in this ingest before opening
  // the main transaction. Doing the upserts inside the long transaction held
  // FK ShareLocks across concurrent ingests and triggered 40P01 deadlocks.
  const allPersonNames = new Set<string>();
  for (const sp of speakerRows) allPersonNames.add(sp.speakerName);
  for (const p of mergedParticipantRows) {
    if (p.role === 'adjudicator') allPersonNames.add(p.name);
  }
  for (const round of rounds) {
    for (const j of round.judgeAssignments) allPersonNames.add(j.personName);
  }
  const personIdByNormalized = await preCommitPersons(allPersonNames);

  const txResult = await prisma.$transaction(async (tx) => {
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

    if (options.force || (existing && fetchWarnings.length === 0)) {
      await prepareTournamentWideRefresh(tx, t.id);
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
        },
        create: {
          tournamentId: t.id,
          teamName: row.teamName,
          roundNumber: 0,
          rank: row.rank,
          wins: row.wins,
          points: row.totalPoints,
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
    for (const sp of speakerRows) {
      const personId = personIdByNormalized.get(normalizePersonName(sp.speakerName));
      if (!personId) continue;
      // Iron-manning: a speaker who substitutes into another team mid-tournament
      // appears in `speakerRows` more than once with different `teamName`s. The
      // unique constraint is `(tournamentId, personId)` so the second upsert
      // would clobber `teamName` and silently break the teammate query on /cv
      // for everyone else on the speaker's primary team. Preserve the first
      // observed team name; subsequent rows update only the score / rank fields.
      const existing = await tx.tournamentParticipant.findUnique({
        where: { tournamentId_personId: { tournamentId: t.id, personId } },
        select: { teamName: true },
      });
      const teamNameToWrite = existing?.teamName ?? sp.teamName;
      const breakRankForTeam = teamNameToWrite
        ? (teamBreakRankByTeam.get(teamNameToWrite) ?? null)
        : null;
      const participant = await tx.tournamentParticipant.upsert({
        where: { tournamentId_personId: { tournamentId: t.id, personId } },
        update: {
          teamName: teamNameToWrite,
          speakerScoreTotal: sp.totalScore as unknown as undefined,
          speakerRankOpen: sp.rank,
          speakerRankEsl: sp.rankEsl,
          speakerRankEfl: sp.rankEfl,
          teamBreakRank: breakRankForTeam,
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
      speakerParticipantIds.push(participant.id);
      for (const rs of sp.roundScores) {
        const m = rs.roundLabel.match(/\d+/);
        const isAverageScore = rs.positionLabel === 'average';
        if (!m && !isAverageScore) continue;
        const rn = isAverageScore ? 0 : Number(m![0]);
        speakerRoundScoreCreates.push({
          tournamentParticipantId: participant.id,
          roundNumber: rn,
          positionLabel: rs.positionLabel ?? '',
          score: rs.score as unknown as undefined,
        });
      }
    }

    // Adjudicator ROSTER (who's in the tournament) comes from the participants
    // list: write a TournamentParticipant row + 'judge' role per adjudicator
    // so the search-based claim flow on /cv can find them. Adjudicator JUDGING
    // HISTORY (rounds judged, chaired vs paneled, deepest outround) is still
    // sourced exclusively from the URL owner's private-URL Debates table by
    // recordJudgeRoundsFromLanding() — never from round-results panels.
    for (const p of mergedParticipantRows) {
      if (p.role !== 'adjudicator') continue;
      const personId = personIdByNormalized.get(normalizePersonName(p.name));
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

    return { tournamentId: t.id, speakerRoundScoreCreates, speakerParticipantIds };
  }, { maxWait: 10000, timeout: 45000 });
  // Tx timeout is 45s — leaves 15s headroom under the 60s Vercel Hobby
  // function budget for the post-tx bulk SpeakerRoundScore writes plus the
  // landing-derived per-round writes (recordJudgeRounds*, recordSpeakerRounds*).

  const tournamentId = txResult.tournamentId;

  // Bulk write speaker round scores OUTSIDE the main tx — keeps the tx
  // small enough to fit WUDC-scale tournaments under the 60s timeout. Scope
  // the deleteMany to the participant IDs we're writing for so we don't
  // touch unrelated rows; createMany with skipDuplicates is idempotent on
  // the (participantId, roundNumber, positionLabel) unique constraint.
  if (txResult.speakerParticipantIds.length > 0) {
    await prisma.speakerRoundScore.deleteMany({
      where: { tournamentParticipantId: { in: txResult.speakerParticipantIds } },
    });
  }
  if (txResult.speakerRoundScoreCreates.length > 0) {
    await prisma.speakerRoundScore.createMany({
      data: txResult.speakerRoundScoreCreates,
      skipDuplicates: true,
    });
  }

  const linked = await withDeadlockRetry(() =>
    linkRegistrationPerson(tournamentId, snapshot.registration.personName, userId, urlVariants),
  );
  if (linked) {
    const r = await recordJudgeRoundsFromLanding(
      landingHtml,
      tournamentId,
      linked.personId,
      snapshot.registration.personName,
    );
    if (r.diagnostic) fetchWarnings.push(r.diagnostic);
    await recordSpeakerRoundsFromLanding(
      landingHtml,
      tournamentId,
      linked.personId,
      snapshot.registration.teamName,
    );
    // Fallback: when the Debates card is empty (typically because the
    // tournament finished and Tabbycat replaced the per-round table with
    // a current-round-only widget), pull judge assignments from the
    // /results/round/N/ pages we already fetched. Only fills fields the
    // Debates card path didn't populate.
    const fromResults = await recordJudgeRoundsFromRoundResults(
      rounds,
      tournamentId,
      linked.personId,
      snapshot.registration.personName,
    );
    if (fromResults.diagnostic) fetchWarnings.push(fromResults.diagnostic);
  }

  // Optional: extract round-results judge assignments for EVERY judge that
  // appeared on a panel, not just the URL owner. Lets users who never had a
  // private URL for a tournament still get their judging history populated
  // when a teammate's URL is ingested. Off by default — enabling at scale
  // means many more JudgeAssignment rows per tournament; gate until verified
  // on real data.
  if (process.env.EXTRACT_ALL_JUDGES === 'true') {
    await recordAllJudgeAssignmentsFromRoundResults(
      rounds,
      tournamentId,
      personIdByNormalized,
    );
  }

  // Mark the DiscoveredUrl as ingested + link to tournament (registrationPersonId set inside linkRegistrationPerson).
  await prisma.discoveredUrl.updateMany({
    where: { userId, url: { in: urlVariants } },
    data: { tournamentId, ingestedAt: new Date() },
  });

  return {
    tournamentId,
    fingerprint,
    cached: false,
    claimedPersonId: linked?.claimed ? linked.personId : null,
    claimedPersonName: linked?.claimed ? (snapshot.registration.personName ?? null) : null,
    parserVersion: PARSER_VERSION,
    totalTeams: totalTeams ?? null,
    totalParticipants: totalParticipants ?? null,
    warnings: fetchWarnings,
  };
}

/**
 * Guess the tournament format. Signals considered, in priority order:
 *
 *   1. Explicit format names in the tournament title.
 *   2. Known BP-format event names (WUDC, EUDC, AUDC, NAUDC, …).
 *   3. The URL owner's own team size from the registration block — most
 *      reliable structural signal, available even when the team tab fails.
 *   4. Team-size from the team tab (median speaker count per team).
 *   5. Speaker-tab grouping fallback (group speakerRows by teamName, take
 *      the median count) — works on installs whose team tab is missing or
 *      didn't parse but whose speaker tab did.
 */
function inferTournamentFormat({
  tournamentName,
  teamRows,
  speakerRows,
  registrationSpeakers,
}: {
  tournamentName: string;
  teamRows: { speakers: string[] }[];
  speakerRows: { teamName: string | null; roundScores: unknown[] }[];
  registrationSpeakers: string[];
}): string | null {
  const name = tournamentName.toLowerCase();

  // (1) Explicit format keywords — user-authored tournament names rarely lie.
  if (/british parliamentary|\bbp\b/.test(name)) return 'British Parliamentary';
  if (/asian parliamentary/.test(name)) return 'Asian Parliamentary';
  if (/worlds schools|\bwsdc\b/.test(name)) return 'World Schools';
  if (/\bpolicy\b/.test(name) && !/public\s*policy/.test(name)) return 'Policy';
  if (/lincoln[-\s]?douglas|\bld\b/.test(name)) return 'Lincoln-Douglas';
  if (/public forum|\bpf\b/.test(name)) return 'Public Forum';

  // (2) Well-known BP-format events.
  if (/\bwudc\b|\beudc\b|\baudc\b|\bnaudc\b|\babp\b|\bbpp\b/.test(name)) {
    return 'British Parliamentary';
  }

  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };

  // (3) Registration block speakers — the user's own team. Most reliable
  // small-N signal because Tabbycat populates it from the registration
  // record itself, no parser fragility involved.
  if (registrationSpeakers.length > 0) {
    const detected = detectFormatFromTeamSize(registrationSpeakers.length);
    if (detected !== 'unknown') return detected;
  }

  // (4) Team-tab median speaker count.
  const teamTabCounts = teamRows.map((r) => r.speakers.length).filter((n) => n > 0);
  const teamTabMedian = median(teamTabCounts);
  if (teamTabMedian != null && teamTabCounts.length >= 3) {
    const detected = detectFormatFromTeamSize(teamTabMedian);
    if (detected !== 'unknown') return detected;
  }

  // (5) Speaker-tab grouping fallback. Group speakers by teamName, take the
  // median group size. Useful when the team tab fetched / parsed empty.
  const groupSizes = new Map<string, number>();
  for (const sp of speakerRows) {
    if (!sp.teamName) continue;
    groupSizes.set(sp.teamName, (groupSizes.get(sp.teamName) ?? 0) + 1);
  }
  const speakerTabCounts = [...groupSizes.values()].filter((n) => n > 0);
  const speakerTabMedian = median(speakerTabCounts);
  if (speakerTabMedian != null && speakerTabCounts.length >= 3) {
    const detected = detectFormatFromTeamSize(speakerTabMedian);
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
      ...(protectedPersonIds.length > 0
        ? { personId: { notIn: protectedPersonIds } }
        : {}),
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
      "displayName" = EXCLUDED."displayName",
      "claimedByUserId" = COALESCE("Person"."claimedByUserId", EXCLUDED."claimedByUserId")
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
  knownPersonName: string | null,
): Promise<{ written: number; chairedPrelims: number; diagnostic: string | null }> {
  const adjRounds = extractAdjudicatorRounds(landingHtml, knownPersonName);
  if (adjRounds.length === 0) {
    await prisma.$transaction([
      prisma.judgeAssignment.deleteMany({ where: { tournamentId, personId } }),
      prisma.tournamentParticipant.update({
        where: { tournamentId_personId: { tournamentId, personId } },
        data: {
          chairedPrelimRounds: null,
          lastOutroundChaired: null,
          lastOutroundPaneled: null,
        },
      }),
    ]);
    return {
      written: 0,
      chairedPrelims: 0,
      diagnostic:
        "parse: 0 adjudicator rounds in private-URL Debates table — " +
        "URL owner isn't on any panel, or the table heading + structure don't match the parser",
    };
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
        },
      });
    }
    const tp = await tx.tournamentParticipant.upsert({
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
    await tx.participantRole.upsert({
      where: {
        tournamentParticipantId_role: {
          tournamentParticipantId: tp.id,
          role: 'judge',
        },
      },
      update: {},
      create: { tournamentParticipantId: tp.id, role: 'judge' },
    });
  });
  return { written: uniqueRounds.size, chairedPrelims, diagnostic: null };
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
    .map((r) => ({ r, rank: outroundStageRank(r.stage) }))
    .filter((x): x is { r: typeof x.r; rank: number } => x.rank != null)
    .sort((a, b) => b.rank - a.rank);
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
  const wantedNorm = normalizePersonName(knownPersonName);
  if (!wantedNorm) return { written: 0, matched: 0, diagnostic: null };
  const wantedTokens = wantedNorm.split(/\s+/).filter(Boolean);
  const wantedTokenSet = new Set(wantedTokens);

  const matchesName = (candidate: string): boolean => {
    const candidateNorm = normalizePersonName(candidate);
    if (!candidateNorm) return false;
    if (candidateNorm === wantedNorm) return true;
    if (wantedTokens.length < 2) return false;
    if (candidateNorm.includes(wantedNorm) || wantedNorm.includes(candidateNorm)) {
      return true;
    }
    const candidateTokens = candidateNorm.split(/\s+/).filter(Boolean);
    if (candidateTokens.length < 2) return false;
    const candidateSet = new Set(candidateTokens);
    return (
      wantedTokens.every((t) => candidateSet.has(t)) ||
      candidateTokens.every((t) => wantedTokenSet.has(t))
    );
  };

  type Hit = { stage: string; role: 'chair' | 'panellist'; roundNumber: number | null };
  const hits: Hit[] = [];
  let totalJudgeEntries = 0;
  for (const round of rounds) {
    if (!round) continue;
    totalJudgeEntries += round.judgeAssignments.length;
    for (const j of round.judgeAssignments) {
      if (!matchesName(j.personName)) continue;
      const stage = normalizeStageLabel(
        round.roundLabel ||
          (round.isOutround
            ? round.roundNumber != null ? `Round ${round.roundNumber}` : 'Outround'
            : `Round ${round.roundNumber ?? '?'}`),
      );
      hits.push({
        stage,
        role: j.panelRole === 'chair' ? 'chair' : 'panellist',
        roundNumber: round.isOutround ? null : round.roundNumber,
      });
    }
  }

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

  let written = 0;
  for (const h of hits) {
    const existing = await prisma.judgeAssignment.findFirst({
      where: {
        tournamentId,
        personId,
        stage: h.stage,
        panelRole: h.role,
        roundNumber: h.roundNumber,
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.judgeAssignment.create({
        data: {
          tournamentId,
          personId,
          stage: h.stage,
          panelRole: h.role,
          roundNumber: h.roundNumber,
        },
      });
      written += 1;
    }
  }

  // Aggregate stats for the participant row. Same logic as the landing-page
  // path so /cv produces identical numbers regardless of which source the
  // data came from.
  const chairedPrelims = getInroundsChairedCount(
    hits.map((h) => ({ stage: h.stage, panelRole: h.role })),
  );
  const outrounds = hits.filter((h) => h.roundNumber == null);
  const ranked = outrounds
    .map((h) => ({ h, rank: outroundStageRank(h.stage) }))
    .filter((x): x is { h: typeof x.h; rank: number } => x.rank != null)
    .sort((a, b) => b.rank - a.rank);
  const deepestChaired = ranked.find((x) => x.h.role === 'chair')?.h.stage ?? null;
  const deepestPaneled = ranked.find((x) => x.h.role === 'panellist')?.h.stage ?? null;

  // Merge with whatever the Debates card path already wrote: only fill in
  // null fields, never overwrite. Debates card data is more authoritative
  // (URL owner is explicitly bolded there) so when it ran successfully its
  // values stand.
  const existing = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_personId: { tournamentId, personId } },
    select: {
      chairedPrelimRounds: true,
      lastOutroundChaired: true,
      lastOutroundPaneled: true,
    },
  });
  const update: {
    judgeTypeTag: 'Adjudicator';
    chairedPrelimRounds?: number;
    lastOutroundChaired?: string;
    lastOutroundPaneled?: string;
  } = { judgeTypeTag: 'Adjudicator' };
  if (chairedPrelims > 0 && (existing?.chairedPrelimRounds ?? null) == null) {
    update.chairedPrelimRounds = chairedPrelims;
  }
  if (deepestChaired && !existing?.lastOutroundChaired) {
    update.lastOutroundChaired = deepestChaired;
  }
  if (deepestPaneled && !existing?.lastOutroundPaneled) {
    update.lastOutroundPaneled = deepestPaneled;
  }

  const tp = await prisma.tournamentParticipant.upsert({
    where: { tournamentId_personId: { tournamentId, personId } },
    update,
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

  return { written, matched: hits.length, diagnostic: null };
}

/**
 * Like `recordJudgeRoundsFromRoundResults` but iterates every judge name in
 * the round-results panels, not just the URL owner's. For each known person
 * (already pre-committed in `personIdByNormalized`) we write JudgeAssignment
 * rows + populate per-person chair/panel stats. Unknown names — judges from
 * tournaments where preCommitPersons didn't pick them up — are skipped to
 * avoid creating Person rows from inside this writer.
 *
 * Idempotent: same find-then-create + non-overwriting field-update logic
 * as the URL-owner-specific path.
 */
async function recordAllJudgeAssignmentsFromRoundResults(
  rounds: ReturnType<typeof parseRoundResults>[],
  tournamentId: bigint,
  personIdByNormalized: Map<string, bigint>,
): Promise<void> {
  type Hit = { stage: string; role: 'chair' | 'panellist'; roundNumber: number | null };
  const hitsByNorm = new Map<string, Hit[]>();
  for (const round of rounds) {
    if (!round) continue;
    for (const j of round.judgeAssignments) {
      const norm = normalizePersonName(j.personName);
      if (!norm) continue;
      const stage = normalizeStageLabel(
        round.roundLabel ||
          (round.isOutround
            ? round.roundNumber != null
              ? `Round ${round.roundNumber}`
              : 'Outround'
            : `Round ${round.roundNumber ?? '?'}`),
      );
      const list = hitsByNorm.get(norm) ?? [];
      list.push({
        stage,
        role: j.panelRole === 'chair' ? 'chair' : 'panellist',
        roundNumber: round.isOutround ? null : round.roundNumber,
      });
      hitsByNorm.set(norm, list);
    }
  }

  for (const [norm, hits] of hitsByNorm.entries()) {
    const personId = personIdByNormalized.get(norm);
    if (!personId) continue;

    for (const h of hits) {
      const existing = await prisma.judgeAssignment.findFirst({
        where: {
          tournamentId,
          personId,
          stage: h.stage,
          panelRole: h.role,
          roundNumber: h.roundNumber,
        },
        select: { id: true },
      });
      if (!existing) {
        await prisma.judgeAssignment.create({
          data: {
            tournamentId,
            personId,
            stage: h.stage,
            panelRole: h.role,
            roundNumber: h.roundNumber,
          },
        });
      }
    }

    const chairedPrelims = getInroundsChairedCount(
      hits.map((h) => ({ stage: h.stage, panelRole: h.role })),
    );
    const outrounds = hits.filter((h) => h.roundNumber == null);
    const ranked = outrounds
      .map((h) => ({ h, rank: outroundStageRank(h.stage) }))
      .filter((x): x is { h: typeof x.h; rank: number } => x.rank != null)
      .sort((a, b) => b.rank - a.rank);
    const deepestChaired = ranked.find((x) => x.h.role === 'chair')?.h.stage ?? null;
    const deepestPaneled = ranked.find((x) => x.h.role === 'panellist')?.h.stage ?? null;

    const tpExisting = await prisma.tournamentParticipant.findUnique({
      where: { tournamentId_personId: { tournamentId, personId } },
      select: {
        chairedPrelimRounds: true,
        lastOutroundChaired: true,
        lastOutroundPaneled: true,
      },
    });
    const update: {
      judgeTypeTag: 'Adjudicator';
      chairedPrelimRounds?: number;
      lastOutroundChaired?: string;
      lastOutroundPaneled?: string;
    } = { judgeTypeTag: 'Adjudicator' };
    if (chairedPrelims > 0 && (tpExisting?.chairedPrelimRounds ?? null) == null) {
      update.chairedPrelimRounds = chairedPrelims;
    }
    if (deepestChaired && !tpExisting?.lastOutroundChaired) {
      update.lastOutroundChaired = deepestChaired;
    }
    if (deepestPaneled && !tpExisting?.lastOutroundPaneled) {
      update.lastOutroundPaneled = deepestPaneled;
    }

    const tp = await prisma.tournamentParticipant.upsert({
      where: { tournamentId_personId: { tournamentId, personId } },
      update,
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
  }
}
