/**
 * Seed a LOCAL database for the admin redesign (R1 to R12): every inbox kind,
 * a checked mark and a changed mark, a failed import whose tournament is
 * stored, info and problem parser warnings, an epoch `scrapedAt`, and enough
 * prelim results, motions and regions that every section of the Captured tab
 * shows real numbers.
 *
 *   set -a; . ./.env.local; set +a
 *   npx vite-node -c vitest.config.ts scripts/seed-admin-redesign.ts
 *
 * (vite-node with the vitest config so the `@/` alias resolves; the audits are
 * computed by the app's own engine, never written by hand.)
 *
 * SAFETY. The script deletes every row it knows about. It therefore reads the
 * database host from the URL BEFORE it imports anything that could connect,
 * prints it, and exits unless it is localhost, 127.0.0.1 or ::1. There is no
 * flag to override that.
 *
 * Sign-in: the script creates the user maya@example.com (the allowlisted admin
 * when ADMIN_EMAIL=maya@example.com) with a database session whose token it
 * prints; set it as the `authjs.session-token` cookie under `next dev`.
 * The credentials here are test values only; nothing is a real password.
 */
import 'dotenv/config';
import { seedImportsReportsWarnings } from './seed-admin-redesign-extras';
import { randomUUID } from 'node:crypto';

const URL_TEXT = process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? '';

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

const host = hostOf(URL_TEXT);
console.log(`Seed target database host: ${host ?? '(unreadable URL)'}`);
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  console.error('Refusing to seed: the database host is not localhost. This script deletes rows.');
  process.exit(1);
}

// ── Deterministic data ───────────────────────────────────────────────────
let seedState = 0x51ed270b;
const rand = () => {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 0x100000000;
};
const shuffle = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const BP = ['OG', 'OO', 'CG', 'CO'];
const BP_POINTS = [3, 2, 1, 0];

type Seats = 'bp' | 'two' | 'none';
type Spec = {
  slug: string;
  name: string;
  format: string | null;
  year: number | null;
  region?: string | null;
  teams: number;
  rounds: number;
  seats: Seats;
  /** Speakers per team on record. */
  squad?: number;
  parserVersion?: string | null;
  scrapedAt?: Date;
  ignored?: boolean;
  /** Stored outrounds (quarters to final) and the break rows behind them. */
  outrounds?: boolean;
  /** Break categories when the tab has no Open bracket (APDA: Varsity and Novice). */
  brackets?: string[];
  breakRows?: boolean;
  /** Motions per prelim round: typed (type and topic), untyped, or none. */
  motions?: 'typed' | 'untyped' | 'none';
  /** Judges on the participants list, how many ticked Adj Core. */
  judges?: number;
  core?: number;
  /** The participants piece is recorded as read. */
  participantsRead?: boolean;
  failedPieces?: Array<{ kind: string; key: string; label: string; status?: number }>;
  withheld?: Array<{ kind: string; key: string; label: string; reason: string }>;
  /** A team missing from one round's results (an incomplete round). */
  dropFromRound?: number;
};

const TOPICS = [
  'Economics & Business',
  'International Relations',
  'Politics & Governance',
  'Ethics & Philosophy',
  'Science & Technology',
];
// Mostly THW so one stem clears the 30-room floor across the large events.
const STEMS = ['THW', 'THW', 'THBT', 'THW', 'THS'];

async function main() {
  // Imported only now, after the host check passed.
  const { prisma } = await import('../lib/db');
  const { runAudit } = await import('../lib/audit/run');
  const { fingerprintOf, markChecked } = await import('../lib/admin/adminChecks');
  const { parseChecks } = await import('../lib/admin/accuracy');

  console.log('Wiping...');
  await prisma.$executeRawUnsafe('DELETE FROM "AdminCheck"');
  await prisma.$transaction([
    prisma.reviewFlag.deleteMany({}),
    prisma.cvErrorReport.deleteMany({}),
    prisma.ingestJob.deleteMany({}),
    prisma.discoveredUrl.deleteMany({}),
    prisma.notification.deleteMany({}),
    prisma.parserRun.deleteMany({}),
    prisma.sourceDocument.deleteMany({}),
    prisma.tournament.deleteMany({}),
    prisma.person.deleteMany({}),
    prisma.session.deleteMany({}),
    prisma.account.deleteMany({}),
    prisma.user.deleteMany({}),
  ]);

  const user = await prisma.user.create({
    data: { name: 'Maya Rao', email: 'maya@example.com', publicCvSlug: 'maya-rao' },
  });
  const sessionToken = randomUUID();
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
  });

  const personIds = new Map<string, bigint>();
  async function person(name: string, claimedBy?: string): Promise<bigint> {
    const key = norm(name);
    const known = personIds.get(key);
    if (known) return known;
    const p = await prisma.person.create({
      data: { displayName: name, normalizedName: key, claimedByUserId: claimedBy ?? null },
    });
    personIds.set(key, p.id);
    return p.id;
  }
  await person('Maya Rao', user.id);

  const CURRENT = (await import('../lib/calicotab/version')).PARSER_VERSION;
  const ids: Record<string, bigint> = {};
  let teamCounter = 0;

  async function tournament(s: Spec) {
    const base = `https://${s.slug}.calicotab.com/${s.slug}/`;
    const t = await prisma.tournament.create({
      data: {
        name: s.name,
        format: s.format,
        year: s.year,
        region: s.region ?? null,
        totalTeams: s.teams,
        prelimRoundCount: s.rounds,
        // A private URL, as an import stores it; the pages show only the public one.
        sourceUrlRaw: `${base}privateurls/s33dK3y${s.slug.length}/`,
        fingerprint: `r7-${s.slug}`,
        parserVersion: s.parserVersion === undefined ? CURRENT : s.parserVersion,
        scrapedAt: s.scrapedAt ?? ago(60 * 24 * 3),
        ignored: s.ignored ?? false,
      },
    });
    ids[s.slug] = t.id;
    const names = Array.from({ length: s.teams }, () => `Team ${(teamCounter += 1)}`);
    const squad = s.squad ?? 2;

    // Prelim results: seats and points per room, one row per team-round.
    const standing = new Map<string, { points: number; wins: number }>(
      names.map((n) => [n, { points: 0, wins: 0 }]),
    );
    const rows: Array<Record<string, unknown>> = [];
    for (let r = 1; r <= s.rounds; r++) {
      const order = shuffle(names);
      const perRoom = s.seats === 'two' ? 2 : 4;
      for (let i = 0; i + perRoom <= order.length; i += perRoom) {
        const room = order.slice(i, i + perRoom);
        // A weak tilt toward the opening seats, so the balance split has a shape.
        const place = shuffle(room.map((_, k) => k));
        room.forEach((team, k) => {
          const rank = place[k];
          const acc = standing.get(team)!;
          const position =
            s.seats === 'bp' ? BP[k] : s.seats === 'two' ? (k === 0 ? 'Prop' : 'Opp') : null;
          const points = s.seats === 'bp' ? BP_POINTS[rank] : null;
          const wins = s.seats === 'two' ? (rank === 0 ? 1 : 0) : null;
          if (points != null) acc.points += points;
          if (wins != null) acc.wins += wins;
          if (s.dropFromRound === r && team === names[0]) return;
          rows.push({
            tournamentId: t.id,
            teamName: team,
            roundNumber: r,
            points,
            wins,
            position,
            rank: null,
          });
        });
      }
    }
    // Teams left over when the count is not a multiple of a room sit out.
    const ranked = [...standing.entries()].sort(
      (a, b) => b[1].points + b[1].wins - (a[1].points + a[1].wins),
    );
    ranked.forEach(([team, acc], i) =>
      rows.push({
        tournamentId: t.id,
        teamName: team,
        roundNumber: 0,
        rank: i + 1,
        points: s.seats === 'bp' ? acc.points : null,
        wins: s.seats === 'two' ? acc.wins : null,
        position: null,
        redactedSpeakers: 0,
      }),
    );
    await prisma.teamResult.createMany({ data: rows as never });

    // Speakers, two or three a team, each with a score total.
    for (const team of names) {
      for (let k = 1; k <= squad; k++) {
        const pid = await person(`${team} Speaker ${k}`);
        const tp = await prisma.tournamentParticipant.create({
          data: {
            tournamentId: t.id,
            personId: pid,
            teamName: team,
            speakerScoreTotal: 70 * s.rounds + Math.round(rand() * 40) / 2,
            roles: { create: [{ role: 'speaker' }] },
          },
        });
        void tp;
      }
    }
    // Judges, some ticked Adj Core.
    for (let j = 0; j < (s.judges ?? 0); j++) {
      const pid = await person(`${s.slug} Judge ${j + 1}`);
      await prisma.tournamentParticipant.create({
        data: {
          tournamentId: t.id,
          personId: pid,
          judgeTypeTag: j < (s.core ?? 0) ? 'core' : null,
          roles: { create: [{ role: 'judge' }] },
        },
      });
    }

    // Motions: one per prelim round, with a stem type and a topic when typed.
    if (s.motions && s.motions !== 'none') {
      for (let r = 1; r <= s.rounds; r++) {
        const stem = STEMS[(r - 1) % STEMS.length];
        await prisma.motion.create({
          data: {
            tournamentId: t.id,
            roundNumber: r,
            roundLabel: `Round ${r}`,
            seq: 0,
            text: `${stem} the motion for ${s.name}, round ${r}.`,
            motionType: s.motions === 'typed' ? stem : null,
            topic: s.motions === 'typed' ? TOPICS[(r + teamCounter) % TOPICS.length] : null,
          },
        });
      }
    }

    // Outrounds: an Open bracket from the top eight, or one semifinal-and-final
    // bracket per named category when the tab has no Open (the open question).
    if (s.outrounds) {
      const top = ranked.slice(0, 8).map(([n]) => n);
      const brackets = s.brackets ?? ['Open'];
      for (const [bi, bracket] of brackets.entries()) {
        const teams8 = s.brackets ? top.slice(bi * 4, bi * 4 + 4) : top;
        const stages: Array<[string, string[], number]> = s.brackets
          ? [
              [`${bracket} Semifinals`, teams8, 2],
              [`${bracket} Grand Final`, teams8.slice(0, 2), 1],
            ]
          : [
              ['Open Quarterfinals', top, 4],
              ['Open Semifinals', top.slice(0, 4), 2],
              ['Open Grand Final', top.slice(0, 2), 1],
            ];
        for (const [stage, teams, winners] of stages) {
          await prisma.eliminationResult.createMany({
            data: teams.map((entityName, i) => ({
              tournamentId: t.id,
              stage,
              entityType: 'team',
              entityName,
              result: i < winners ? 'won' : 'lost',
            })),
          });
        }
        if (s.breakRows) {
          await prisma.eliminationResult.createMany({
            data: teams8.map((entityName) => ({
              tournamentId: t.id,
              stage: bracket,
              entityType: 'team',
              entityName,
              result: null,
            })),
          });
        }
      }
    }

    // The recorded scrape pieces: every tab and every round, ok unless said.
    const failed = new Set((s.failedPieces ?? []).map((p) => `${p.kind}:${p.key}`));
    const held = new Map((s.withheld ?? []).map((p) => [`${p.kind}:${p.key}`, p.reason]));
    const wanted: Array<{ kind: string; key: string; label: string; path: string }> = [
      { kind: 'team', key: '', label: 'Team tab', path: 'tab/team/' },
      { kind: 'speaker', key: '', label: 'Speaker tab', path: 'tab/speaker/' },
      { kind: 'participants', key: '', label: 'Participants', path: 'participants/list/' },
      { kind: 'motions', key: '', label: 'Motions', path: 'motions/' },
      { kind: 'home', key: '', label: 'Home page', path: '' },
      ...Array.from({ length: s.rounds }, (_, i) => ({
        kind: 'round',
        key: String(i + 1),
        label: `R${i + 1}`,
        path: `results/round/${i + 1}/`,
      })),
      ...(s.outrounds || s.breakRows !== undefined
        ? (s.brackets ?? ['Open']).map((b) => ({
            kind: 'break',
            key: b.toLowerCase(),
            label: `Break: ${b}`,
            path: `break/teams/${b.toLowerCase()}/`,
          }))
        : []),
    ];
    for (const w of wanted) {
      const key = `${w.kind}:${w.key}`;
      if (w.kind === 'participants' && s.participantsRead === false) continue;
      const isFailed = failed.has(key);
      const reason = held.get(key);
      await prisma.scrapePiece.create({
        data: {
          tournamentId: t.id,
          kind: w.kind,
          key: w.key,
          label: w.label,
          url: `${base}${w.path}`,
          status: isFailed ? 'failed' : reason ? 'withheld' : 'ok',
          reason: reason ?? null,
          httpStatus: isFailed
            ? (s.failedPieces?.find((p) => `${p.kind}:${p.key}` === key)?.status ?? 503)
            : 200,
          lastError: isFailed ? 'HTTP 503' : null,
          attempts: isFailed ? 2 : 0,
          lastAttemptAt: ago(120),
          loadedAt: isFailed || reason ? null : ago(120),
          nextRetryAt: isFailed ? ago(-60) : null,
        },
      });
    }
    // The user has this tournament on their record: it counts as a user affected.
    await prisma.discoveredUrl.create({
      data: {
        userId: user.id,
        url: `${base}privateurls/s33dK3y${s.slug.length}/`,
        host: `${s.slug}.calicotab.com`,
        tournamentSlug: s.slug,
        tournamentId: t.id,
        ingestedAt: ago(60 * 24),
      },
    });
    return t;
  }

  // ── The tournaments ───────────────────────────────────────────────────
  // Large BP events carry the motion-balance numbers: 48 teams make 12 rooms a
  // round, so a single-motion round clears the 8-room floor, and the typed
  // rounds across them clear 30 rooms for one stem.
  await tournament({
    slug: 'seedville2026',
    name: 'Seedville Open 2026',
    format: 'British Parliamentary',
    year: 2026,
    region: 'South Asia',
    teams: 48,
    rounds: 5,
    seats: 'bp',
    motions: 'typed',
    outrounds: true,
    breakRows: true,
    judges: 6,
    core: 2,
  });
  await tournament({
    slug: 'harbour2025',
    name: 'Harbour Cup 2025',
    format: 'British Parliamentary',
    year: 2025,
    region: 'Europe',
    teams: 40,
    rounds: 5,
    seats: 'bp',
    motions: 'typed',
    outrounds: true,
    breakRows: true,
    judges: 4,
    core: 1,
  });
  await tournament({
    slug: 'lakeside2024',
    name: 'Lakeside Championship 2024',
    format: 'British Parliamentary',
    year: 2024,
    region: 'North America',
    teams: 36,
    rounds: 5,
    seats: 'bp',
    motions: 'typed',
    outrounds: true,
    breakRows: true,
    judges: 4,
    core: 1,
  });
  // Two-team format with sides, for the Prop/Opp split.
  await tournament({
    slug: 'asianopen2025',
    name: 'Asian Open 2025',
    format: 'Asian Parliamentary',
    year: 2025,
    region: 'Southeast Asia',
    teams: 20,
    rounds: 5,
    seats: 'two',
    squad: 3,
    motions: 'typed',
    outrounds: true,
    breakRows: true,
    judges: 4,
    core: 1,
  });
  // Accuracy problems the engine finds: a team missing from a round, a break
  // linked but never stored, a failed speaker tab and a failed round.
  await tournament({
    slug: 'midlands2025',
    name: 'Midlands Open 2025',
    format: 'British Parliamentary',
    year: 2025,
    region: 'Europe',
    teams: 24,
    rounds: 4,
    seats: 'bp',
    motions: 'untyped',
    dropFromRound: 3,
    judges: 3,
    core: 1,
    participantsRead: true,
  });
  await tournament({
    slug: 'breakless2025',
    name: 'Breakless Invitational 2025',
    format: 'British Parliamentary',
    year: 2025,
    region: 'Oceania',
    teams: 16,
    rounds: 4,
    seats: 'bp',
    motions: 'typed',
    outrounds: true,
    breakRows: false,
    judges: 3,
    core: 1,
  });
  await tournament({
    slug: 'harthouse2023',
    name: 'Hart House 2023',
    format: 'British Parliamentary',
    year: 2023,
    region: 'North America',
    teams: 16,
    rounds: 4,
    seats: 'bp',
    motions: 'typed',
    judges: 3,
    core: 1,
    failedPieces: [
      { kind: 'speaker', key: '', label: 'Speaker tab' },
      { kind: 'round', key: '2', label: 'R2' },
    ],
  });
  // Format null: BP seats make it decidable; no seats leave it undecided.
  await tournament({
    slug: 'preworlds24',
    name: 'Preworlds24',
    format: null,
    year: null,
    region: 'East Asia',
    teams: 16,
    rounds: 4,
    seats: 'bp',
    motions: 'typed',
    judges: 3,
    core: 1,
  });
  await tournament({
    slug: 'mysterycup',
    name: 'Mystery Cup',
    format: null,
    year: 2023,
    teams: 12,
    rounds: 3,
    seats: 'none',
    motions: 'untyped',
    judges: 2,
    core: 1,
  });
  // Adjudication core from the Tournament Staff block, and one with none.
  const staffed = await tournament({
    slug: 'staffed2025',
    name: 'Staffed Open 2025',
    format: 'British Parliamentary',
    year: 2025,
    region: 'Africa',
    teams: 16,
    rounds: 4,
    seats: 'bp',
    motions: 'typed',
    judges: 3,
    core: 0,
    outrounds: true,
    breakRows: true,
  });
  const exact = await person('Amara Okafor');
  const candidate = await person('Jonas Berg');
  await prisma.tournamentStaff.createMany({
    data: [
      {
        tournamentId: staffed.id,
        name: 'Amara Okafor',
        nameKey: 'amara okafor',
        role: 'core',
        personId: exact,
      },
      {
        tournamentId: staffed.id,
        name: 'Jonas P. Berg',
        nameKey: 'jonas p berg',
        role: 'core',
        candidatePersonId: candidate,
      },
      { tournamentId: staffed.id, name: 'Chair Nobody', nameKey: 'chair nobody', role: 'core' },
    ],
  });
  await tournament({
    slug: 'nocore2025',
    name: 'No Core Cup 2025',
    format: 'British Parliamentary',
    year: 2025,
    region: 'Latin America & Caribbean',
    teams: 16,
    rounds: 4,
    seats: 'bp',
    motions: 'typed',
    judges: 3,
    core: 0,
  });
  // The old parser and an epoch scrapedAt: the page must say "unknown", never 1970.
  await tournament({
    slug: 'oldparser2022',
    name: 'Old Parser Open 2022',
    format: 'British Parliamentary',
    year: 2022,
    region: 'Middle East & North Africa',
    teams: 16,
    rounds: 4,
    seats: 'bp',
    motions: 'typed',
    judges: 3,
    core: 1,
    parserVersion: '20250101.0',
    scrapedAt: new Date(0),
  });
  // A test tournament an admin set to ignored: nowhere in the admin.
  await tournament({
    slug: 'testdemo',
    name: 'Test Tournament (demo)',
    format: 'British Parliamentary',
    year: 2026,
    teams: 16,
    rounds: 3,
    seats: 'bp',
    motions: 'untyped',
    ignored: true,
    judges: 0,
  });
  // A withheld speaker tab: the tournament's choice, never a fault.
  await tournament({
    slug: 'withheld2024',
    name: 'Withheld Open 2024',
    format: 'British Parliamentary',
    year: 2024,
    region: 'Central Asia',
    teams: 16,
    rounds: 4,
    seats: 'bp',
    motions: 'typed',
    judges: 3,
    core: 1,
    withheld: [{ kind: 'speaker', key: '', label: 'Speaker tab', reason: 'withheld' }],
  });
  // No Open bracket: APDA Varsity and Novice. The champion rule is an open question.
  await tournament({
    slug: 'apda2025',
    name: 'APDA Varsity Nationals 2025',
    format: 'American Parliamentary',
    year: 2025,
    region: 'North America',
    teams: 16,
    rounds: 4,
    seats: 'two',
    motions: 'typed',
    outrounds: true,
    breakRows: true,
    brackets: ['Varsity', 'Novice'],
    judges: 3,
    core: 1,
  });
  // Two stored rows that share an address: "? Check" on an import.
  for (const [i, url] of [
    'https://twinopen2024.calicotab.com/twin/',
    'https://twinopen2024.calicotab.com/twin/privateurls/tw1nK3y/',
  ].entries()) {
    await prisma.tournament.create({
      data: {
        name: `Twin Open 2024${i ? ' (second import)' : ''}`,
        year: 2024,
        format: 'British Parliamentary',
        sourceUrlRaw: url,
        fingerprint: `r7-twin-${i}`,
        scrapedAt: ago(600),
      },
    });
  }

  const { jobIds, reportIds } = await seedImportsReportsWarnings(prisma, user.id, ids, CURRENT);

  // ── Audits come from the app's engine ──────────────────────────────────
  const all = Object.values(ids);
  await runAudit(all);

  // ── Marks: one that holds, one whose data has changed ──────────────────
  const midlands = await prisma.tournamentAudit.findUnique({
    where: { tournamentId: ids.midlands2025 },
  });
  const open = parseChecks(midlands?.checks ?? []).filter(
    (c) => c.status === 'warn' || c.status === 'fail',
  );
  const [first, second] = open;
  if (first) {
    await markChecked({
      kind: 'check',
      subject: `${ids.midlands2025}:${first.code}`,
      fingerprint: fingerprintOf('check', { status: first.status, detail: first.detail }),
      note: 'Looked at the tab: right as published.',
      by: 'maya@example.com',
    });
  }
  const hart = await prisma.tournamentAudit.findUnique({
    where: { tournamentId: ids.harthouse2023 },
  });
  const hartOpen = parseChecks(hart?.checks ?? []).find(
    (c) => c.status === 'warn' || c.status === 'fail',
  );
  if (hartOpen) {
    // A fingerprint of an earlier finding: the data changed since, so it comes back marked.
    await markChecked({
      kind: 'check',
      subject: `${ids.harthouse2023}:${hartOpen.code}`,
      fingerprint: fingerprintOf('check', { status: 'warn', detail: 'an earlier finding' }),
      note: 'Checked before the re-scrape.',
      by: 'maya@example.com',
    });
  }
  void second;
  await markChecked({
    kind: 'report',
    subject: reportIds[3],
    fingerprint: fingerprintOf('report', { status: 'fixed' }),
    note: null,
    by: 'maya@example.com',
  });
  await runAudit(all);

  console.log(
    `Seeded ${all.length} tournaments, ${jobIds.length} failed imports, ${reportIds.length} reports.`,
  );
  console.log(`Session cookie: authjs.session-token=${sessionToken}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
