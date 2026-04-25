import { prisma } from '@/lib/db';
import { fetchHtmlWithProvenance, fetchRoundWithProvenance } from './fetch';
import { parsePrivateUrlPage } from './parseNav';
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
import { aggregateJudgeStats } from './judgeStats';

const FRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type IngestResult = {
  tournamentId: bigint;
  fingerprint: string;
  cached: boolean;
  claimedPersonId: bigint | null;
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
      const claimedPersonId = await linkRegistrationPerson(
        existing.id,
        snapshot.registration.personName,
        userId,
        normalized,
      );
      await prisma.discoveredUrl.updateMany({
        where: { userId, url: normalized },
        data: { tournamentId: existing.id, ingestedAt: new Date() },
      });
      return {
        tournamentId: existing.id,
        fingerprint,
        cached: true,
        claimedPersonId,
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
    fetchWarnings.push(
      `fetch: ${label} HTTP ${r.status}${r.bodyPreview ? ` — ${r.bodyPreview.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`,
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
      const person = await upsertPerson(tx, sp.speakerName);
      const participant = await tx.tournamentParticipant.upsert({
        where: { tournamentId_personId: { tournamentId: t.id, personId: person.id } },
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
          personId: person.id,
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

    // Adjudicators from the participants list.
    // Write only the adjudicator-specific columns on update so we don't
    // clobber speaker fields for swings (who show up in both lists).
    for (const p of participantRows) {
      if (p.role !== 'adjudicator') continue;
      const person = await upsertPerson(tx, p.name);
      const participant = await tx.tournamentParticipant.upsert({
        where: { tournamentId_personId: { tournamentId: t.id, personId: person.id } },
        update: {
          judgeTypeTag: p.judgeTag,
          // Only overwrite teamName when the participants list actually tells
          // us one — adjudicator rows typically have a null team and we don't
          // want to erase a speaker's team affiliation.
          ...(p.teamName ? { teamName: p.teamName } : {}),
        },
        create: {
          tournamentId: t.id,
          personId: person.id,
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

    // Raw judge_assignments table: one row per (tournament, person, stage, role, round).
    // First resolve names to personIds once so the pure aggregator can key by id.
    const personIdByName = new Map<string, bigint>();
    for (const round of rounds) {
      for (const j of round.judgeAssignments) {
        if (personIdByName.has(j.personName)) continue;
        const person = await upsertPerson(tx, j.personName);
        personIdByName.set(j.personName, person.id);
      }
    }
    for (const round of rounds) {
      for (const j of round.judgeAssignments) {
        const personId = personIdByName.get(j.personName)!;
        // The @@unique on JudgeAssignment covers three nullable columns
        // (stage, panelRole, roundNumber), which Prisma's compound-unique
        // filter type doesn't accept as null. Use findFirst + create for
        // a nullable-safe idempotent insert.
        const existing = await tx.judgeAssignment.findFirst({
          where: {
            tournamentId: t.id,
            personId,
            stage: round.roundLabel,
            panelRole: j.panelRole,
            roundNumber: round.roundNumber,
          },
          select: { id: true },
        });
        if (!existing) {
          await tx.judgeAssignment.create({
            data: {
              tournamentId: t.id,
              personId,
              stage: round.roundLabel,
              panelRole: j.panelRole,
              roundNumber: round.roundNumber,
            },
          });
        }
      }
    }

    // Aggregate per-judge stats via the pure helper (unit-tested).
    const aggregatorInput = rounds.map((round) => ({
      roundNumber: round.roundNumber,
      roundLabel: round.roundLabel,
      isOutround: round.isOutround,
      judgeAssignments: round.judgeAssignments.map((j) => ({
        personKey: (personIdByName.get(j.personName) ?? 0n).toString(),
        panelRole: j.panelRole,
      })),
    }));
    const judgeStats = aggregateJudgeStats(aggregatorInput);

    for (const [personIdText, stat] of judgeStats.entries()) {
      if (personIdText === '0') continue; // defensive: unknown name
      const personId = BigInt(personIdText);
      const participant = await tx.tournamentParticipant.upsert({
        where: { tournamentId_personId: { tournamentId: t.id, personId } },
        update: {
          chairedPrelimRounds: stat.chairedPrelimRounds || null,
          lastOutroundChaired: stat.lastOutroundChaired,
          lastOutroundPaneled: stat.lastOutroundPaneled,
        },
        create: {
          tournamentId: t.id,
          personId,
          chairedPrelimRounds: stat.chairedPrelimRounds || null,
          lastOutroundChaired: stat.lastOutroundChaired,
          lastOutroundPaneled: stat.lastOutroundPaneled,
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

    return t.id;
  }, { maxWait: 10000, timeout: 30000 });

  const claimedPersonId = await linkRegistrationPerson(
    tournamentId,
    snapshot.registration.personName,
    userId,
    normalized,
  );

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

  // Structural signal — ignore teams with missing / wrong speaker counts and
  // use the median-ish max, not the outlier max.
  const speakerCounts = teamRows
    .map((r) => r.speakers.length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (speakerCounts.length >= 3) {
    const mid = speakerCounts[Math.floor(speakerCounts.length / 2)]!;
    if (mid === 2) return 'British Parliamentary';
    if (mid >= 3) return 'Asian Parliamentary';
  }

  return null;
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

async function upsertPerson(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  displayName: string,
) {
  const normalizedName = normalizePersonName(displayName);
  return tx.person.upsert({
    where: { normalizedName },
    update: { displayName },
    create: { displayName, normalizedName },
  });
}

/**
 * Upsert the Person mentioned on the private-URL landing page, ensure a
 * TournamentParticipant row exists for the join, and record the link on
 * the DiscoveredUrl. We deliberately do NOT auto-claim the Person — the
 * dashboard's identity-review panel asks the user to confirm.
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

  const person = await prisma.person.upsert({
    where: { normalizedName },
    update: { displayName: personName },
    create: { displayName: personName, normalizedName },
  });

  await prisma.tournamentParticipant.upsert({
    where: { tournamentId_personId: { tournamentId, personId: person.id } },
    update: {},
    create: { tournamentId, personId: person.id },
  });

  await prisma.discoveredUrl.updateMany({
    where: { userId, url },
    data: { registrationPersonId: person.id },
  });

  return person.id;
}
