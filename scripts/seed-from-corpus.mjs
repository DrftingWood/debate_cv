#!/usr/bin/env node
/**
 * Seed a local database from a real corpus export.
 *
 * scripts/seed-dev-data.mjs invents a record designed to hit every awkward
 * display branch. This one does the opposite: it loads one real person's
 * actual career, so the CV can be reviewed at a scale and messiness no
 * hand-written fixture reaches — 73 tournaments, eleven thousand other
 * speakers to be placed against, tab rows with tied ranks, split rounds,
 * institution names that change spelling three times, and tournament titles
 * carrying raw HTML entities and CJK.
 *
 * It exists because the ingest pipeline cannot be used for this. Real ingest
 * is gated on Tabbycat *private* URLs (lib/gmail/extract.ts `isPrivateUrl`),
 * one per person per tournament, which is a deliberate consent control: the
 * product only builds your CV from links emailed to you. A third party's
 * public tab pages can be read, but they cannot be pushed through
 * `ingestPrivateUrl`, and that gate is not something to loosen for a demo.
 * So this writes the same tables ingest would, from the offline corpus.
 *
 * Input is the bundle produced by scripts/corpus-export.sql, plus the
 * stand-in name list from tests/__tagplaceholders.live.test.ts (the
 * placeholder rule is load-bearing and lives in TypeScript; this script does
 * not re-implement it).
 *
 * Usage:
 *   node scripts/seed-from-corpus.mjs <bundle.json> <placeholders.json> <derived.json>
 *
 * derived.json comes from tests/__derive.live.test.ts, which runs ingest's own
 * TypeScript helpers over the bundle — format, deepest outround reached,
 * prelims chaired and deepest outrounds judged. This script only writes those
 * answers; it does not carry a second, drifting copy of the rules.
 *
 * PUBLIC_CV=1 turns the public view on, PUBLIC_CV=0 turns it off, and leaving
 * it unset keeps whatever the previous seed of this user had — so re-seeding
 * never quietly reverses a decision someone made on purpose.
 *
 * Refuses to run unless the database URL points at localhost — it drops rows.
 */

import 'dotenv/config'; // Prisma 7 no longer loads .env itself
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DB_URL = process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(DB_URL)) {
  console.error(
    'Refusing to seed: POSTGRES_PRISMA_URL does not point at localhost.\n' +
      'This script deletes rows. Point it at a throwaway database.',
  );
  process.exit(1);
}

const [bundlePath, placeholderPath, derivedPath] = process.argv.slice(2);
if (!bundlePath || !placeholderPath || !derivedPath) {
  console.error(
    'Usage: node scripts/seed-from-corpus.mjs <bundle.json> <placeholders.json> <derived.json>',
  );
  process.exit(1);
}

const bundle = JSON.parse(readFileSync(bundlePath, 'utf-8'));
const placeholders = new Set(JSON.parse(readFileSync(placeholderPath, 'utf-8')));
const derived = JSON.parse(readFileSync(derivedPath, 'utf-8'));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });

// ── Helpers ───────────────────────────────────────────────────────────────

/** Mirrors lib/calicotab/fingerprint.ts `normalizePersonName`. */
const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[-_./\\]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Tab pages carry raw entities through to the tournament title
 * ("K&#x27;la Open 2023", "DRCPD&#x27;1"). The parsers decode cells; the
 * tournament name is read off the page title, which is not a cell.
 */
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** A tournament's year, from its title first, then its URL. Null if neither says. */
function inferYear(name, root) {
  for (const source of [name, root]) {
    if (!source) continue;
    const years = [...String(source).matchAll(/(19|20)\d{2}/g)].map((m) => Number(m[0]));
    const plausible = years.filter((y) => y >= 1990 && y <= 2030);
    if (plausible.length) return plausible[plausible.length - 1];
  }
  return null;
}

/** Round number from a results URL (".../results/round/7/" → 7). */
function roundNumberFromUrl(url) {
  const m = /\/results\/round\/(\d+)\//.exec(url ?? '');
  return m ? Number(m[1]) : null;
}

/** Round number from a speaker-tab column label ("R1" → 1, "R1A" → 1). */
function roundNumberFromLabel(label) {
  const m = /(\d+)/.exec(label ?? '');
  return m ? Number(m[1]) : null;
}

const num = (v) => (v == null ? null : Number(v));

async function wipe() {
  // Tournament and Person cascade to participations, scores, roles, results.
  await prisma.$transaction([
    prisma.tournament.deleteMany({}),
    prisma.person.deleteMany({}),
    prisma.session.deleteMany({}),
    prisma.account.deleteMany({}),
    prisma.user.deleteMany({}),
  ]);
}

// ── Seed ──────────────────────────────────────────────────────────────────

async function main() {
  const subject = bundle.subject;
  const subjectKey = normalize(subject);
  console.log(`Seeding the record of ${subject}…`);

  const slug = subjectKey.replace(/\s+/g, '-');
  const previous = await prisma.user.findUnique({
    where: { publicCvSlug: slug },
    select: { publicCvEnabled: true },
  });
  const publicCvEnabled =
    process.env.PUBLIC_CV === '1'
      ? true
      : process.env.PUBLIC_CV === '0'
        ? false
        : (previous?.publicCvEnabled ?? false);

  console.log('Wiping…');
  await wipe();

  const user = await prisma.user.create({
    data: {
      name: subject,
      email: `${slug}@corpus.invalid`,
      publicCvSlug: slug,
      // Off for a new record. This is a real person who has not asked for a
      // public CV, so turning it on is a decision someone makes on purpose
      // (PUBLIC_CV=1), and a re-seed keeps that decision rather than
      // resetting it. Even on, it only serves /u/<slug> on this local
      // database — the record reaches the internet when someone deploys it.
      publicCvEnabled,
      publicAvatarEnabled: false,
    },
  });

  const sessionToken = randomUUID();
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });

  const subjectPerson = await prisma.person.create({
    data: { displayName: subject, normalizedName: subjectKey, claimedByUserId: user.id },
  });

  // ── Tournaments ─────────────────────────────────────────────────────────
  const prelimsByCorpusId = new Map(
    bundle.prelims.map((p) => [p.tournament_id, Number(p.prelims)]),
  );

  const fieldByTournament = new Map();
  for (const row of bundle.field) {
    const list = fieldByTournament.get(row.tournament_id) ?? [];
    list.push(row);
    fieldByTournament.set(row.tournament_id, list);
  }

  const tournamentIdByCorpusId = new Map();
  for (const t of bundle.tournaments) {
    const name = decodeEntities(t.name) || t.slug || t.host;
    const field = fieldByTournament.get(t.id) ?? [];
    const created = await prisma.tournament.create({
      data: {
        name,
        year: inferYear(name, t.root),
        format: derived[t.id]?.format ?? null,
        sourceUrlRaw: t.root,
        fingerprint: `corpus-${t.host}-${t.slug ?? 'root'}`,
        prelimRoundCount: prelimsByCorpusId.get(t.id) ?? null,
        totalParticipants: field.length || null,
        totalTeams: new Set(field.map((f) => f.team_name).filter(Boolean)).size || null,
        parserVersion: 'corpus-seed',
      },
    });
    tournamentIdByCorpusId.set(t.id, created.id);

    // The CV is not "every tournament you appear at" — buildCvData starts
    // from the DiscoveredUrl rows, i.e. the tournaments this user supplied a
    // private URL for. That is the consent model, so a seeded record has to
    // assert the same thing: without a DiscoveredUrl the participation rows
    // exist but the CV renders "No tournaments ingested yet".
    const year = inferYear(name, t.root);
    await prisma.discoveredUrl.create({
      data: {
        userId: user.id,
        url: t.root,
        host: t.host,
        tournamentSlug: t.slug ?? null,
        tournamentId: created.id,
        registrationName: subject,
        registrationPersonId: subjectPerson.id,
        ingestedAt: new Date(),
        messageDate: year ? new Date(Date.UTC(year, 5, 1)) : null,
      },
    });
  }
  console.log(`  tournaments        ${tournamentIdByCorpusId.size}`);

  // ── People ──────────────────────────────────────────────────────────────
  // Everyone on a speaker tab becomes a Person, because placement ("18th of
  // 412") is a claim about the rest of the field. Stand-ins are skipped, the
  // same rule ingest applies — they are one shared name across many people.
  const personIdByKey = new Map([[subjectKey, subjectPerson.id]]);
  const newPeople = new Map();
  for (const row of bundle.field) {
    if (!row.speaker_name) continue;
    const key = normalize(row.speaker_name);
    if (!key || key === subjectKey || placeholders.has(key) || newPeople.has(key)) continue;
    newPeople.set(key, decodeEntities(row.speaker_name));
  }
  await prisma.person.createMany({
    data: [...newPeople].map(([key, displayName]) => ({ displayName, normalizedName: key })),
    skipDuplicates: true,
  });
  for (const p of await prisma.person.findMany({ select: { id: true, normalizedName: true } })) {
    personIdByKey.set(p.normalizedName, p.id);
  }
  console.log(`  people             ${personIdByKey.size}`);

  // ── Participations ──────────────────────────────────────────────────────
  // The subject's own row per tournament is created first and kept, so the
  // speaker rows, judging rows and round scores all hang off one participant.
  const subjectSpeakerByTournament = new Map(bundle.speaker.map((s) => [s.tournament_id, s]));
  const subjectPartByTournament = new Map();

  const judgingByTournament = new Map();
  for (const j of bundle.judging) {
    const list = judgingByTournament.get(j.tournament_id) ?? [];
    list.push(j);
    judgingByTournament.set(j.tournament_id, list);
  }

  // Best break rank per tournament. A team that breaks in two categories
  // (Open and ESL) has two ranks; mergeSpeakerCvSignals keeps the lowest, so
  // match that here rather than picking arbitrarily.
  const breakRankByTournament = new Map();
  for (const tb of bundle.team_breaks ?? []) {
    if (tb.rank == null) continue;
    const prev = breakRankByTournament.get(tb.tournament_id);
    if (prev == null || tb.rank < prev) breakRankByTournament.set(tb.tournament_id, tb.rank);
  }

  const categoriesByTournament = new Map();
  for (const c of bundle.categories) {
    const list = categoriesByTournament.get(c.tournament_id) ?? [];
    if (c.category) list.push(c.category);
    categoriesByTournament.set(c.tournament_id, list);
  }

  for (const p of bundle.participation) {
    const tournamentId = tournamentIdByCorpusId.get(p.tournament_id);
    if (!tournamentId) continue;
    const spk = subjectSpeakerByTournament.get(p.tournament_id);
    const judgeRows = judgingByTournament.get(p.tournament_id) ?? [];
    const d = derived[p.tournament_id] ?? {};

    const roles = [];
    if (p.role === 'speaker' || spk) roles.push('speaker');
    if (p.role === 'adjudicator' || judgeRows.length) roles.push('judge');

    const participant = await prisma.tournamentParticipant.create({
      data: {
        tournamentId,
        personId: subjectPerson.id,
        teamName: decodeEntities(spk?.team_name ?? p.team_name) || null,
        speakerScoreTotal: num(spk?.total_score),
        speakerRankOpen: spk?.rank ?? null,
        speakerRankEsl: spk?.rank_esl ?? null,
        speakerRankEfl: spk?.rank_efl ?? null,
        speakerCategories: categoriesByTournament.get(p.tournament_id) ?? [],
        // teamBreakRank says they broke and at what seed; eliminationReached
        // says how far they went, from the outround results pages.
        teamBreakRank: breakRankByTournament.get(p.tournament_id) ?? null,
        eliminationReached: d.eliminationReached ?? null,
        judgeTypeTag: p.judge_tag ?? null,
        // Same null-for-zero convention as judgeAggregates.writeJudgeParticipantRole.
        chairedPrelimRounds: roles.includes('judge') ? d.chairedPrelims || null : null,
        lastOutroundChaired: d.deepestChaired ?? null,
        lastOutroundPaneled: d.deepestPaneled ?? null,
        roles: { create: [...new Set(roles)].map((role) => ({ role })) },
      },
    });
    subjectPartByTournament.set(p.tournament_id, participant.id);
  }
  console.log(`  own participations ${subjectPartByTournament.size}`);

  // ── The field ───────────────────────────────────────────────────────────
  const fieldRows = [];
  for (const row of bundle.field) {
    const tournamentId = tournamentIdByCorpusId.get(row.tournament_id);
    if (!tournamentId || !row.speaker_name) continue;
    const key = normalize(row.speaker_name);
    if (!key || key === subjectKey || placeholders.has(key)) continue;
    const personId = personIdByKey.get(key);
    if (!personId) continue;
    fieldRows.push({
      tournamentId,
      personId,
      teamName: decodeEntities(row.team_name) || null,
      speakerScoreTotal: num(row.total_score),
      speakerRankOpen: row.rank ?? null,
    });
  }
  // One person can appear twice on a tab only through a data fault; dedupe on
  // (tournament, person) so createMany cannot double-count the field.
  const seen = new Set();
  const dedupedField = fieldRows.filter((r) => {
    const k = `${r.tournamentId}:${r.personId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (let i = 0; i < dedupedField.length; i += 2000) {
    await prisma.tournamentParticipant.createMany({ data: dedupedField.slice(i, i + 2000) });
  }

  // Field placement only counts rows carrying the 'speaker' role, so the
  // roles have to be written too — a participant with a total but no role is
  // invisible to buildCvData's field query.
  const fieldIds = await prisma.tournamentParticipant.findMany({
    where: { personId: { not: subjectPerson.id } },
    select: { id: true },
  });
  for (let i = 0; i < fieldIds.length; i += 5000) {
    await prisma.participantRole.createMany({
      data: fieldIds.slice(i, i + 5000).map((p) => ({
        tournamentParticipantId: p.id,
        role: 'speaker',
      })),
      skipDuplicates: true,
    });
  }
  console.log(`  field rows         ${dedupedField.length}`);

  // ── The subject's round scores ──────────────────────────────────────────
  const scoreRows = [];
  for (const s of bundle.scores) {
    const participantId = subjectPartByTournament.get(s.tournament_id);
    if (!participantId) continue;
    const isAverage = (s.position_label ?? '') === 'average';
    const roundNumber = isAverage ? 0 : roundNumberFromLabel(s.round_label);
    if (roundNumber == null) continue;
    scoreRows.push({
      tournamentParticipantId: participantId,
      roundNumber,
      positionLabel: isAverage ? 'average' : '',
      score: num(s.score),
    });
  }
  await prisma.speakerRoundScore.createMany({ data: scoreRows });
  console.log(`  round scores       ${scoreRows.length}`);

  // Teammates' speeches. Ingest stores every speaker's round scores; the seed
  // stores the subject's teammates', which is what pro-am labels and the
  // carry index read. Stand-ins have no participant row and are skipped.
  const teammateParticipants = await prisma.tournamentParticipant.findMany({
    where: { personId: { not: subjectPerson.id } },
    select: { id: true, tournamentId: true, personId: true },
  });
  const participantIdByTournamentPerson = new Map(
    teammateParticipants.map((tp) => [`${tp.tournamentId}:${tp.personId}`, tp.id]),
  );
  const mateScoreRows = [];
  for (const s of bundle.teammate_scores ?? []) {
    const tournamentId = tournamentIdByCorpusId.get(s.tournament_id);
    const personId = s.speaker_name ? personIdByKey.get(normalize(s.speaker_name)) : undefined;
    const participantId =
      tournamentId && personId
        ? participantIdByTournamentPerson.get(`${tournamentId}:${personId}`)
        : undefined;
    if (!participantId) continue;
    const isAverage = (s.position_label ?? '') === 'average';
    const roundNumber = isAverage ? 0 : roundNumberFromLabel(s.round_label);
    if (roundNumber == null) continue;
    mateScoreRows.push({
      tournamentParticipantId: participantId,
      roundNumber,
      positionLabel: isAverage ? 'average' : '',
      score: num(s.score),
    });
  }
  await prisma.speakerRoundScore.createMany({ data: mateScoreRows, skipDuplicates: true });
  console.log(`  teammate scores    ${mateScoreRows.length}`);

  // ── Judging ─────────────────────────────────────────────────────────────
  const judgeRows = [];
  for (const j of bundle.judging) {
    const tournamentId = tournamentIdByCorpusId.get(j.tournament_id);
    if (!tournamentId) continue;
    const roundNumber = j.round_number ?? roundNumberFromUrl(j.source_url);
    judgeRows.push({
      tournamentId,
      personId: subjectPerson.id,
      panelRole: j.panel_role ?? null,
      // Outrounds carry no round number and are named by stage, as ingest
      // stores them. `stage` is a round LABEL, not a category —
      // judgeStats.classifyRoundLabel reads "1" as an inround and
      // "Quarterfinals" as an outround; a word like "prelim" classifies as
      // unknown and empties the CV's "Judged" column.
      roundNumber: j.is_outround ? null : roundNumber,
      stage: j.is_outround
        ? decodeEntities(j.round_label)
        : roundNumber != null
          ? String(roundNumber)
          : null,
      source: 'corpus',
    });
  }
  await prisma.judgeAssignment.createMany({ data: judgeRows });
  console.log(`  judge assignments  ${judgeRows.length}`);

  // ── Motions ─────────────────────────────────────────────────────────────
  const motionRows = [];
  for (const m of bundle.motions) {
    const tournamentId = tournamentIdByCorpusId.get(m.tournament_id);
    if (!tournamentId || !m.text) continue;
    motionRows.push({
      tournamentId,
      roundNumber: m.round_number ?? null,
      roundLabel: decodeEntities(m.round_label) ?? '',
      seq: m.seq ?? 1,
      text: decodeEntities(m.text),
      infoSlide: decodeEntities(m.info_slide) || null,
    });
  }
  for (let i = 0; i < motionRows.length; i += 2000) {
    await prisma.motion.createMany({ data: motionRows.slice(i, i + 2000) });
  }
  console.log(`  motions            ${motionRows.length}`);

  // ── Breaks ──────────────────────────────────────────────────────────────
  // EliminationResult is unique on (tournament, stage, type, name), and the
  // corpus legitimately holds the same row more than once: up to three break
  // tabs are fetched per tournament and a team on the Open break often also
  // sits on the ESL one under the same stage label.
  const breakRows = [];
  const breakSeen = new Set();
  for (const b of bundle.breaks) {
    const tournamentId = tournamentIdByCorpusId.get(b.tournament_id);
    if (!tournamentId || !b.entity_name) continue;
    const row = {
      tournamentId,
      stage: b.stage ?? 'Break',
      entityType: b.entity_type ?? 'team',
      entityName: decodeEntities(b.entity_name),
    };
    const key = `${row.tournamentId}:${row.stage}:${row.entityType}:${row.entityName}`;
    if (breakSeen.has(key)) continue;
    breakSeen.add(key);
    breakRows.push(row);
  }
  for (let i = 0; i < breakRows.length; i += 2000) {
    await prisma.eliminationResult.createMany({
      data: breakRows.slice(i, i + 2000),
      skipDuplicates: true,
    });
  }
  console.log(`  break rows         ${breakRows.length}`);

  // ── Team results ────────────────────────────────────────────────────────
  // Mirrors ingest.ts. Per-round rows carry points, seat and `wins` (1 won,
  // 0 lost, null unknown) — every win rate, run and partner win rate on the
  // CV reads it. The team tab becomes round 0: rank, wins, total points,
  // firsts, seconds. Unique on (tournament, team, round).
  const teamRows = [];
  const teamSeen = new Set();
  const pushTeamRow = (row) => {
    const key = `${row.tournamentId}:${row.teamName}:${row.roundNumber}`;
    if (teamSeen.has(key)) return;
    teamSeen.add(key);
    teamRows.push(row);
  };
  for (const tr of bundle.team_results) {
    const tournamentId = tournamentIdByCorpusId.get(tr.tournament_id);
    const roundNumber = roundNumberFromUrl(tr.source_url);
    if (!tournamentId || !tr.team_name || roundNumber == null) continue;
    pushTeamRow({
      tournamentId,
      teamName: decodeEntities(tr.team_name),
      roundNumber,
      points: tr.points == null ? null : Number(tr.points),
      wins: tr.won === true ? 1 : tr.won === false ? 0 : null,
      position: tr.position ?? null,
    });
  }
  for (const tm of bundle.teams) {
    const tournamentId = tournamentIdByCorpusId.get(tm.tournament_id);
    if (!tournamentId || !tm.team_name) continue;
    pushTeamRow({
      tournamentId,
      teamName: decodeEntities(tm.team_name),
      roundNumber: 0,
      rank: tm.rank ?? null,
      wins: tm.wins ?? null,
      points: tm.total_points == null ? null : Number(tm.total_points),
      firsts: tm.firsts ?? null,
      seconds: tm.seconds ?? null,
    });
  }
  for (let i = 0; i < teamRows.length; i += 2000) {
    await prisma.teamResult.createMany({ data: teamRows.slice(i, i + 2000), skipDuplicates: true });
  }
  console.log(`  team results       ${teamRows.length}`);

  // ── Outround results ────────────────────────────────────────────────────
  // Also mirrors ingest.ts: every team in a named outround gets 'won' or
  // 'lost' under that stage. buildCvData reads these to decide whether the
  // user's team won the deepest round it reached — and so the tournament.
  const outroundRows = [];
  const outroundSeen = new Set();
  for (const tr of bundle.team_results) {
    const tournamentId = tournamentIdByCorpusId.get(tr.tournament_id);
    if (!tournamentId || !tr.is_outround || !tr.round_label || !tr.team_name || tr.won == null) {
      continue;
    }
    const row = {
      tournamentId,
      stage: decodeEntities(tr.round_label),
      entityType: 'team',
      entityName: decodeEntities(tr.team_name),
      result: tr.won ? 'won' : 'lost',
    };
    const key = `${row.tournamentId}:${row.stage}:${row.entityName}`;
    if (outroundSeen.has(key)) continue;
    outroundSeen.add(key);
    outroundRows.push(row);
  }
  for (let i = 0; i < outroundRows.length; i += 2000) {
    await prisma.eliminationResult.createMany({
      data: outroundRows.slice(i, i + 2000),
      skipDuplicates: true,
    });
  }
  console.log(`  outround results   ${outroundRows.length}`);

  console.log(`\nSigned in as ${subject}. Set this cookie on localhost:3000:`);
  console.log(`  authjs.session-token=${sessionToken}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
