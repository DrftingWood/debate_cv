#!/usr/bin/env node
/**
 * Seed a local database with a realistic debate record.
 *
 * Why this exists: every surface in this app is a projection of scraped
 * tournament data, and until now the only way to look at /cv, /cv/stats or
 * /cv/motions was to sign in with a real Google account and ingest real
 * tournaments. That made the UI effectively unreviewable — three shipped
 * layout and correctness defects in the 2026-07 rebuild were only caught by
 * reading code, and two more were only caught once this script existed.
 *
 * The dataset is deliberately awkward. Anyone can seed a happy path; the
 * value here is the edge cases, each of which corresponds to a branch the
 * display layer has to handle:
 *
 *   - a tournament with no prelim-round count and no per-round team rows
 *   - a tournament the user only judged at, which still released motions
 *   - an undated tournament (exercises chronological ordering / streaks)
 *   - a tab that published an "Average" column over a different denominator
 *     than total ÷ prelims (exercises the field-comparison caveat)
 *   - rounds that released two motions
 *   - motions with no approved tags, and rounds with no motion at all
 *   - a speaker tab with no score totals (no field context available)
 *   - an EUDC-style dual break (Open + ESL outrounds in one tournament)
 *
 * Deterministic: a fixed-seed LCG, not Math.random, so screenshots and
 * numbers are reproducible across runs.
 *
 * Usage:
 *   npm run seed:dev          # wipes the seeded user and re-creates
 *
 * Refuses to run unless the database URL points at localhost — this drops
 * rows, and it must never be pointed at production.
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const DB_URL = process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(DB_URL)) {
  console.error(
    'Refusing to seed: POSTGRES_PRISMA_URL does not point at localhost.\n' +
      'This script deletes rows. Point it at a throwaway database.',
  );
  process.exit(1);
}

const prisma = new PrismaClient();

// ── Deterministic RNG ─────────────────────────────────────────────────────
let _seed = 0x2f6e2b1;
/** Numerical Recipes LCG. Deterministic across Node versions. */
function rand() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 0x100000000;
}
/** Box–Muller normal deviate; speech scores cluster, they don't spread flat. */
function normal(mean, sd) {
  const u = Math.max(rand(), 1e-9);
  const v = Math.max(rand(), 1e-9);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function pick(list) {
  return list[Math.floor(rand() * list.length)];
}
const round1 = (n) => Math.round(n * 2) / 2; // speech scores land on halves

// ── Name pool for the field ───────────────────────────────────────────────
const FIRST = ['Ada', 'Kofi', 'Mei', 'Rohan', 'Sofia', 'Tomas', 'Yuki', 'Ines', 'Omar', 'Lena', 'Nkechi', 'Bram', 'Priya', 'Diego', 'Hana', 'Ivan', 'Zara', 'Noor', 'Finn', 'Alba'];
const LAST = ['Achebe', 'Bauer', 'Costa', 'Duarte', 'Eriksen', 'Farrell', 'Gupta', 'Haddad', 'Ibrahim', 'Jansen', 'Kimura', 'Lindqvist', 'Moreau', 'Nowak', 'Okafor', 'Petrov', 'Quintero', 'Rossi', 'Silva', 'Tanaka'];
let nameCounter = 0;
function fieldName() {
  nameCounter += 1;
  return `${pick(FIRST)} ${pick(LAST)} ${nameCounter}`;
}
const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// ── Motion pool ───────────────────────────────────────────────────────────
const MOTIONS = [
  ['THW abolish selective state schooling.', 'THW', 'Education'],
  ['THBT the feminist movement should abandon the language of choice.', 'THBT', 'Social Movements'],
  ['THS the rise of regional trade blocs at the expense of global institutions.', 'THS', 'Economics & Business'],
  ['THW require all political advertising to be state-funded.', 'THW', 'Politics'],
  ['THR the narrative of the self-made founder.', 'THR', 'Economics & Business'],
  ['THBT developing states should nationalise their critical mineral reserves.', 'THBT', 'Development'],
  ['THW ban private security contractors from conflict zones.', 'THW', 'International Relations'],
  ['THP a world where religious institutions play no role in education.', 'THP', 'Religion'],
  ['THBT environmental movements should abandon civil disobedience.', 'THBT', 'Environment'],
  ['THW allow terminally ill patients unrestricted access to experimental treatment.', 'THW', 'Science & Medicine'],
  ['THBT the international criminal court has done more harm than good.', 'THBT', 'International Relations'],
  ['THW break up the major technology platforms.', 'THW', 'Technology'],
  ['THS the decline of the traditional political party.', 'THS', 'Politics'],
  ['THBT states should pay reparations for historical colonial extraction.', 'THBT', 'Development'],
  ['THW abolish tenure in universities.', 'THW', 'Education'],
  ['THBT sports bodies should exclude states with poor human rights records.', 'THBT', 'Sport'],
  ['THW require social media platforms to verify user identity.', 'THW', 'Technology'],
  ['THR the pursuit of economic growth as the primary goal of the state.', 'THR', 'Economics & Business'],
];
let motionCursor = 0;
function nextMotion() {
  const m = MOTIONS[motionCursor % MOTIONS.length];
  motionCursor += 1;
  return m;
}

const POSITIONS = ['OG', 'OO', 'CG', 'CO'];

/**
 * The tournaments. `me` describes how the seeded user performed; anything
 * omitted is generated. Each entry's comment names the branch it exists to
 * exercise.
 */
const TOURNAMENTS = [
  {
    name: 'World Universities Debating Championship 2024',
    year: 2024, format: 'British Parliamentary', region: 'International',
    totalTeams: 206, speakers: 412, prelims: 9, host: 'wudc2024',
    me: { skill: 0.9, teamName: 'Maya A', partner: 'Lena Fischer', broke: true,
          outround: 'Octofinals', eslRank: 14, dualBreak: true },
  },
  {
    name: 'Australs 2024',
    year: 2024, format: 'British Parliamentary', region: 'Oceania',
    totalTeams: 94, speakers: 188, prelims: 8, host: 'australs2024',
    me: { skill: 0.85, teamName: 'Maya B', partner: 'Anika Sharma', broke: true,
          outround: 'Quarterfinals' },
  },
  {
    name: 'Hart House IV 2023',
    year: 2023, format: 'British Parliamentary', region: 'North America',
    totalTeams: 48, speakers: 96, prelims: 6, host: 'harthouse2023',
    // Champion: won the Grand Final.
    me: { skill: 0.95, teamName: 'Maya C', partner: 'Lena Fischer', broke: true,
          outround: 'Grand Final', wonFinal: true },
  },
  {
    name: 'Cambridge IV 2023',
    year: 2023, format: 'British Parliamentary', region: 'Europe',
    totalTeams: 120, speakers: 240, prelims: 6, host: 'cambridge2023',
    // EDGE CASE: judged only. Motions were released; the user has no
    // speaker row. /cv/motions must decide what to do with these.
    judgeOnly: { chaired: 5, lastOutroundChaired: 'Semifinals', judgeTypeTag: 'chair' },
  },
  {
    name: 'University Novice Championship 2022',
    year: 2022, format: 'British Parliamentary', region: 'Europe',
    totalTeams: 37, speakers: 74, prelims: 5, host: 'novice2022',
    me: { skill: 0.8, teamName: 'Maya D', partner: 'Sam Okonjo', broke: true,
          outround: 'Grand Final', wonFinal: false },
  },
  {
    name: 'Oxford IV 2022',
    year: 2022, format: 'British Parliamentary', region: 'Europe',
    totalTeams: 60, speakers: 120, prelims: 6, host: 'oxford2022',
    me: { skill: 0.55, teamName: 'Maya E', partner: 'Sam Okonjo', broke: false },
  },
  {
    name: 'Delhi Open 2025',
    year: 2025, format: 'Asian Parliamentary', region: 'South Asia',
    totalTeams: 30, speakers: 90, prelims: 5, host: 'delhi2025',
    me: { skill: 0.88, teamName: 'Maya F', partner: 'Priya Raman', broke: true,
          outround: 'Semifinals' },
  },
  {
    name: 'Bangalore Invitational 2025',
    year: 2025, format: 'British Parliamentary', region: 'South Asia',
    totalTeams: 24, speakers: 48, prelims: 5, host: 'bangalore2025',
    me: { skill: 0.7, teamName: 'Maya G', partner: 'Priya Raman', broke: false },
  },
  {
    name: 'Riverside Autumn Open',
    // EDGE CASE: no year. Exercises chronological ordering and streaks.
    year: null, format: 'British Parliamentary', region: null,
    totalTeams: 20, speakers: 40, prelims: 5, host: 'riverside',
    me: { skill: 0.65, teamName: 'Maya H', partner: 'Sam Okonjo', broke: false },
  },
  {
    name: 'Metro Pro-Am 2021',
    year: 2021, format: 'British Parliamentary', region: 'North America',
    totalTeams: 18, speakers: 36, prelims: 4, host: 'metro2021',
    me: { skill: 0.5, teamName: 'Maya I', partner: 'Tomas Lindqvist', broke: false },
  },
  {
    name: 'Harbour Cup 2023',
    year: 2023, format: 'British Parliamentary', region: null,
    totalTeams: 32, speakers: 64, prelims: 6, host: 'harbour2023',
    // EDGE CASE: the tournament ran six prelims, but the tab never
    // published a round count and no per-round team rows survived — so
    // `Tournament.prelimRoundCount` is null and MAX(TeamResult.roundNumber)
    // has nothing to fall back to. Score-unit field figures cannot be
    // derived; only the rank-based placement should render.
    noRoundData: true,
    me: { skill: 0.75, teamName: 'Maya J', partner: 'Ada Achebe 1', broke: true,
          outround: 'Quarterfinals' },
  },
  {
    name: 'Continental Championship 2024',
    year: 2024, format: 'British Parliamentary', region: 'Africa',
    totalTeams: 44, speakers: 88, prelims: 7, host: 'continental2024',
    // EDGE CASE: the tab published an Average column computed over only the
    // rounds actually spoken (the user missed R4), so total ÷ prelims and
    // the published average disagree. The field summary uses the former.
    me: { skill: 0.82, teamName: 'Maya K', partner: 'Nkechi Okafor 2', broke: true,
          outround: 'Semifinals', missedRound: 4 },
  },
  {
    name: 'Lakeside Novice 2021',
    year: 2021, format: 'British Parliamentary', region: null,
    totalTeams: 16, speakers: 32, prelims: 4, host: 'lakeside2021',
    // EDGE CASE: speaker tab published ranks but no score totals, so this
    // tournament contributes nothing to field context.
    noScoreTotals: true,
    me: { skill: 0.6, teamName: 'Maya L', partner: 'Ada Achebe 1', broke: false },
  },
  {
    name: 'Northern Regionals 2022',
    year: 2022, format: 'British Parliamentary', region: 'Europe',
    totalTeams: 28, speakers: 56, prelims: 6, host: 'northern2022',
    // Judged, and on the adjudication core — a distinct credential.
    judgeOnly: { chaired: 6, lastOutroundChaired: 'Grand Final', judgeTypeTag: 'core' },
  },
];

const ME = { name: 'Maya Rao', aliases: ['Maya Rao', 'M. Rao'] };

async function wipe() {
  // Cascades handle the children; Tournament and Person are the roots.
  await prisma.$transaction([
    prisma.tagProposal.deleteMany({}),
    prisma.cvErrorReport.deleteMany({}),
    prisma.ingestJob.deleteMany({}),
    prisma.discoveredUrl.deleteMany({}),
    prisma.notification.deleteMany({}),
    prisma.tournament.deleteMany({}),
    prisma.person.deleteMany({}),
    prisma.session.deleteMany({}),
    prisma.account.deleteMany({}),
    prisma.user.deleteMany({}),
  ]);
}

async function main() {
  console.log('Wiping…');
  await wipe();

  const user = await prisma.user.create({
    data: {
      name: ME.name,
      email: 'maya@example.com',
      publicCvSlug: 'maya-rao',
      publicCvEnabled: true,
      publicAvatarEnabled: false,
    },
  });

  // A long-lived database session so a browser can be signed in without
  // round-tripping Google. Printed at the end for the harness to use.
  const sessionToken = randomUUID();
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });

  // The user's claimed identities. Two spellings, both claimed, so the
  // per-tournament registration-name logic has something to choose from.
  const myPersonIds = [];
  for (const alias of ME.aliases) {
    const p = await prisma.person.create({
      data: {
        displayName: alias,
        normalizedName: normalize(alias),
        claimedByUserId: user.id,
      },
    });
    myPersonIds.push(p.id);
  }
  const myPersonId = myPersonIds[0];

  // Named partners are shared across tournaments so the partner splits on
  // /cv/stats have repeat pairings to aggregate.
  const personCache = new Map();
  async function personFor(name) {
    const key = normalize(name);
    if (personCache.has(key)) return personCache.get(key);
    const existing = await prisma.person.findUnique({ where: { normalizedName: key } });
    const p = existing ?? (await prisma.person.create({
      data: { displayName: name, normalizedName: key },
    }));
    personCache.set(key, p.id);
    return p.id;
  }

  let totalSpeakers = 0;
  let totalMotions = 0;

  for (const t of TOURNAMENTS) {
    const prelims = t.prelims;
    const tournament = await prisma.tournament.create({
      data: {
        name: t.name,
        year: t.year,
        format: t.format,
        region: t.region,
        totalTeams: t.totalTeams,
        totalParticipants: t.speakers,
        prelimRoundCount: t.noRoundData ? null : prelims,
        sourceUrlRaw: `https://${t.host}.calicotab.com/t/private-${t.host}/`,
        fingerprint: `seed-${t.host}`,
      },
    });

    await prisma.discoveredUrl.create({
      data: {
        userId: user.id,
        url: tournament.sourceUrlRaw,
        host: `${t.host}.calicotab.com`,
        tournamentSlug: `private-${t.host}`,
        tournamentId: tournament.id,
        ingestedAt: new Date(`${t.year ?? 2023}-06-01T00:00:00Z`),
        messageDate: new Date(`${t.year ?? 2023}-05-20T00:00:00Z`),
        registrationName: t.judgeOnly ? ME.aliases[1] : ME.aliases[0],
      },
    });
    await prisma.ingestJob.create({
      data: {
        userId: user.id,
        url: tournament.sourceUrlRaw,
        status: 'done',
        scheduledAt: new Date(`${t.year ?? 2023}-06-01T00:00:00Z`),
      },
    });

    // ── Motions. Every tournament that ran prelims released them, including
    // the one the user only judged at.
    if (prelims) {
      let seq = 0;
      for (let r = 1; r <= prelims; r += 1) {
        // R3 everywhere runs two motions — the motion-per-room case the
        // display layer has to disambiguate (it can't, and must say so).
        const count = r === 3 ? 2 : 1;
        for (let i = 0; i < count; i += 1) {
          const [text, type, topic] = nextMotion();
          // Roughly a third of motions carry no approved tags yet.
          const tagged = (seq + r) % 3 !== 0;
          await prisma.motion.create({
            data: {
              tournamentId: tournament.id,
              roundNumber: r,
              roundLabel: `Round ${r}`,
              seq,
              text,
              infoSlide: r === 5 ? 'The Overton window describes the range of policies politically acceptable to the mainstream population at a given time.' : null,
              motionType: tagged ? type : null,
              topic: tagged ? topic : null,
            },
          });
          seq += 1;
          totalMotions += 1;
        }
      }
      // An outround motion — roundNumber null, so it appears on the motion
      // archive but never joins to a prelim round.
      const [text, type, topic] = nextMotion();
      await prisma.motion.create({
        data: {
          tournamentId: tournament.id,
          roundNumber: null,
          roundLabel: 'Grand Final',
          seq,
          text,
          infoSlide: null,
          motionType: type,
          topic,
        },
      });
      totalMotions += 1;
    }

    // ── Judge-only tournaments stop here.
    if (t.judgeOnly) {
      const participant = await prisma.tournamentParticipant.create({
        data: {
          tournamentId: tournament.id,
          personId: myPersonId,
          judgeTypeTag: t.judgeOnly.judgeTypeTag,
          chairedPrelimRounds: t.judgeOnly.chaired,
          lastOutroundChaired: t.judgeOnly.lastOutroundChaired,
          roles: { create: [{ role: 'judge' }] },
        },
      });
      for (let r = 1; r <= t.judgeOnly.chaired; r += 1) {
        await prisma.judgeAssignment.create({
          data: {
            tournamentId: tournament.id,
            personId: myPersonId,
            roundNumber: r,
            stage: `Round ${r}`,
            panelRole: 'chair',
          },
        });
      }
      await prisma.eliminationResult.create({
        data: {
          tournamentId: tournament.id,
          entityType: 'adjudicator',
          entityName: ME.aliases[1],
          stage: t.judgeOnly.lastOutroundChaired,
        },
      });
      void participant;
      continue;
    }

    // ── The user's own performance.
    const me = t.me;
    const base = 68 + me.skill * 9; // skill 0.5 → 72.5, 0.95 → 76.6
    const myRoundScores = [];
    for (let r = 1; r <= prelims; r += 1) {
      if (me.missedRound === r) {
        myRoundScores.push(null); // swing/absent round
        continue;
      }
      // A mild upward drift across the draw, so momentum has something real
      // to find rather than pure noise.
      const drift = ((r - 1) / Math.max(prelims - 1, 1)) * 1.2;
      myRoundScores.push(round1(normal(base + drift, 1.6)));
    }
    const spoken = myRoundScores.filter((s) => s != null);
    const myTotal = spoken.reduce((a, b) => a + b, 0);

    // ── The field. Every speaker the tab published, so placement
    // percentiles are computed against a real distribution.
    const fieldTotals = [];
    for (let i = 0; i < t.speakers - 1; i += 1) {
      const speakerBase = normal(73.2, 2.4);
      fieldTotals.push(round1(speakerBase) * prelims);
    }

    const myPlacement = fieldTotals.filter((v) => v > myTotal).length + 1;

    // Persist the field as participants. createMany can't create the role
    // rows, so roles go in one bulk insert afterwards keyed on the ids.
    const fieldPersonNames = Array.from({ length: t.speakers - 1 }, () => fieldName());
    await prisma.person.createMany({
      data: fieldPersonNames.map((n) => ({ displayName: n, normalizedName: normalize(n) })),
      skipDuplicates: true,
    });
    const fieldPersons = await prisma.person.findMany({
      where: { normalizedName: { in: fieldPersonNames.map(normalize) } },
      select: { id: true, normalizedName: true },
    });
    const fieldPersonByName = new Map(fieldPersons.map((p) => [p.normalizedName, p.id]));

    const ranked = fieldTotals
      .map((total, i) => ({ total, i }))
      .sort((a, b) => b.total - a.total);
    const rankByIndex = new Map();
    ranked.forEach((entry, idx) => {
      // The user occupies myPlacement, so field speakers above it keep
      // their rank and those below shift down by one.
      rankByIndex.set(entry.i, idx + 1 >= myPlacement ? idx + 2 : idx + 1);
    });

    await prisma.tournamentParticipant.createMany({
      data: fieldPersonNames.map((n, i) => ({
        tournamentId: tournament.id,
        personId: fieldPersonByName.get(normalize(n)),
        teamName: `Team ${Math.floor(i / 2) + 1}`,
        speakerScoreTotal: t.noScoreTotals ? null : fieldTotals[i],
        speakerRankOpen: rankByIndex.get(i),
      })),
      skipDuplicates: true,
    });
    const fieldParticipants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id },
      select: { id: true },
    });
    await prisma.participantRole.createMany({
      data: fieldParticipants.map((p) => ({ tournamentParticipantId: p.id, role: 'speaker' })),
      skipDuplicates: true,
    });
    totalSpeakers += t.speakers;

    // ── The user's participant row.
    const partnerPersonId = await personFor(me.partner);
    const myParticipant = await prisma.tournamentParticipant.create({
      data: {
        tournamentId: tournament.id,
        personId: myPersonId,
        teamName: me.teamName,
        speakerScoreTotal: t.noScoreTotals ? null : myTotal,
        speakerRankOpen: myPlacement,
        speakerRankEsl: me.eslRank ?? null,
        teamBreakRank: me.broke ? Math.max(1, Math.round(t.totalTeams * 0.12)) : null,
        eliminationReached: me.outround ?? null,
        roles: { create: [{ role: 'speaker' }] },
      },
    });
    await prisma.tournamentParticipant.create({
      data: {
        tournamentId: tournament.id,
        personId: partnerPersonId,
        teamName: me.teamName,
        speakerScoreTotal: t.noScoreTotals ? null : round1(normal(72.8, 1.5)) * prelims,
        roles: { create: [{ role: 'speaker' }] },
      },
    });

    // Per-round speaker scores. positionLabel '' is an ordinary round cell.
    await prisma.speakerRoundScore.createMany({
      data: myRoundScores
        .map((score, i) => ({ score, roundNumber: i + 1 }))
        .filter((s) => s.score != null)
        .map((s) => ({
          tournamentParticipantId: myParticipant.id,
          roundNumber: s.roundNumber,
          positionLabel: '',
          score: s.score,
        })),
    });

    // EDGE CASE: publish an Average column computed over rounds SPOKEN, not
    // over the full prelim count. total ÷ prelims disagrees with it, which
    // is exactly the denominator mismatch the field comparison has to own.
    if (me.missedRound) {
      await prisma.speakerRoundScore.create({
        data: {
          tournamentParticipantId: myParticipant.id,
          roundNumber: 0,
          positionLabel: 'average',
          score: Math.round((myTotal / spoken.length) * 100) / 100,
        },
      });
    }

    // ── Team results: the standings row plus one row per prelim.
    if (!t.noRoundData) {
      const wins = [];
      for (let r = 1; r <= prelims; r += 1) {
        // Better speakers win more, with real variance.
        const points = Math.min(3, Math.max(0, Math.round(normal(me.skill * 3, 0.9))));
        wins.push(points);
        await prisma.teamResult.create({
          data: {
            tournamentId: tournament.id,
            teamName: me.teamName,
            roundNumber: r,
            position: POSITIONS[(r + t.name.length) % 4],
            wins: points >= 2 ? 1 : 0,
            points,
          },
        });
      }
      await prisma.teamResult.create({
        data: {
          tournamentId: tournament.id,
          teamName: me.teamName,
          roundNumber: 0,
          rank: me.broke ? Math.max(1, Math.round(t.totalTeams * 0.12)) : Math.round(t.totalTeams * 0.55),
          wins: wins.filter((w) => w >= 2).length,
          points: wins.reduce((a, b) => a + b, 0),
        },
      });
    }

    // ── Outrounds.
    if (me.outround) {
      await prisma.eliminationResult.create({
        data: {
          tournamentId: tournament.id,
          entityType: 'team',
          entityName: me.teamName,
          stage: me.outround,
          result: me.wonFinal === true ? 'won' : me.wonFinal === false ? 'lost' : 'lost',
        },
      });
      // EUDC-style dual break: the same team also ran an ESL bracket.
      if (me.dualBreak) {
        await prisma.eliminationResult.create({
          data: {
            tournamentId: tournament.id,
            entityType: 'team',
            entityName: me.teamName,
            stage: 'ESL Grand Final',
            result: 'lost',
          },
        });
      }
    }

    console.log(
      `  ${t.name.padEnd(48)} ${String(t.speakers).padStart(4)} speakers · ` +
        `me ${t.noScoreTotals ? '—' : `${myPlacement}/${t.speakers}`}`,
    );
  }

  const counts = {
    tournaments: await prisma.tournament.count(),
    persons: await prisma.person.count(),
    participants: await prisma.tournamentParticipant.count(),
    roundScores: await prisma.speakerRoundScore.count(),
    teamResults: await prisma.teamResult.count(),
    motions: await prisma.motion.count(),
  };

  console.log('\nSeeded:', counts);
  console.log(`\nSpeakers in fields: ${totalSpeakers} · motions: ${totalMotions}`);
  console.log(`\nUser id:        ${user.id}`);
  console.log(`Public CV:      /u/maya-rao`);
  console.log(`Session cookie: authjs.session-token=${sessionToken}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
