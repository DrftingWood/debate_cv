import { prisma } from '@/lib/db';
import { fetchHtml, fetchHtmlWithProvenance } from './fetch';
import { parsePrivateUrlPage } from './parseNav';
import {
  parseTeamTab,
  parseSpeakerTab,
  parseRoundResults,
  parseBreakPage,
  parseParticipantsList,
} from './parseTabs';
import {
  computeFingerprint,
  extractYearFromName,
  normalizePersonName,
} from './fingerprint';
import { PARSER_VERSION } from './version';
import { collectRegistrationWarnings, recordParserRun } from './provenance';

const FRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type IngestResult = {
  tournamentId: bigint;
  fingerprint: string;
  cached: boolean;
  claimedPersonId: bigint | null;
  parserVersion: string;
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
  const landingDoc = await fetchHtmlWithProvenance(normalized);
  const landingHtml = landingDoc.html;

  const parseStart = Date.now();
  const snapshot = parsePrivateUrlPage(landingHtml, normalized);
  const landingWarnings = collectRegistrationWarnings(snapshot);
  await recordParserRun({
    sourceDocumentId: landingDoc.sourceDocumentId,
    parserName: 'parseNav',
    success: !!snapshot.tournamentName || snapshot.navigation.resultsRounds.length > 0,
    warnings: landingWarnings,
    durationMs: Date.now() - parseStart,
  });

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
      };
    }
  }

  // Fetch and parse tabs in parallel (bounded: these are same host, so fetchHtml throttles).
  const nav = snapshot.navigation;
  const [teamHtml, speakerHtml, participantsHtml] = await Promise.all([
    nav.teamTab ? safeFetch(nav.teamTab) : Promise.resolve(null),
    nav.speakerTab ? safeFetch(nav.speakerTab) : Promise.resolve(null),
    nav.participants ? safeFetch(nav.participants) : Promise.resolve(null),
  ]);
  const roundHtmls = await Promise.all(nav.resultsRounds.map((u) => safeFetchPair(u)));
  const breakHtmls = await Promise.all(nav.breakTabs.map((u) => safeFetchPair(u)));

  const teamRows = teamHtml ? parseTeamTab(teamHtml) : [];
  const speakerRows = speakerHtml ? parseSpeakerTab(speakerHtml) : [];
  const participantRows = participantsHtml ? parseParticipantsList(participantsHtml) : [];
  const rounds = roundHtmls
    .filter((x): x is { url: string; html: string } => !!x)
    .map(({ url: u, html }) => parseRoundResults(html, u));
  const breakRows = breakHtmls
    .filter((x): x is { url: string; html: string } => !!x)
    .flatMap(({ url: u, html }) => parseBreakPage(html, u));

  const tournamentName = snapshot.tournamentName ?? tournamentSlug ?? 'Unknown tournament';

  const tournamentId = await prisma.$transaction(async (tx) => {
    const t = await tx.tournament.upsert({
      where: { fingerprint },
      update: {
        name: tournamentName,
        year,
        sourceUrlRaw: normalized,
        sourceHost: parsedUrl.host,
        sourceTournamentSlug: tournamentSlug,
        scrapedAt: new Date(),
      },
      create: {
        name: tournamentName,
        year,
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
        },
        create: {
          tournamentId: t.id,
          personId: person.id,
          teamName: sp.teamName,
          speakerScoreTotal: sp.totalScore as unknown as undefined,
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

    // Adjudicators from participants list
    for (const p of participantRows) {
      if (p.role !== 'adjudicator') continue;
      const person = await upsertPerson(tx, p.name);
      const participant = await tx.tournamentParticipant.upsert({
        where: { tournamentId_personId: { tournamentId: t.id, personId: person.id } },
        update: { teamName: p.teamName },
        create: {
          tournamentId: t.id,
          personId: person.id,
          teamName: p.teamName,
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

  return { tournamentId, fingerprint, cached: false, claimedPersonId, parserVersion: PARSER_VERSION };
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

async function safeFetch(url: string): Promise<string | null> {
  try {
    return await fetchHtml(url);
  } catch {
    return null;
  }
}

async function safeFetchPair(url: string): Promise<{ url: string; html: string } | null> {
  try {
    const html = await fetchHtml(url);
    return { url, html };
  } catch {
    return null;
  }
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
