// Dev data for the partial-scrapes admin pages and the CV's "Partly loaded"
// mark, kept apart from seed-dev-data.mjs (which is at the 800-line cap).
// Called once, after every tournament is written, against the same LOCAL
// database the main seed has already checked.

/**
 * Per-page scrape records (ScrapePiece) for two tournaments, so /admin, the
 * per-tournament grid and the "Partly loaded" badge have something to show:
 * Delhi loaded every page; Hart House lost its speaker tab (retry still
 * queued) and round 2 (retries exhausted, so nextRetryAt is null and only an
 * admin re-scrape can fix it), and its motions page is withheld by the
 * tournament (never retried, no badge). Every other seeded tournament gets
 * no pieces, like a tournament imported before the table existed.
 */
const PIECE_PLANS = {
  delhi2025: { rounds: 3, failed: {} },
  harthouse2023: {
    rounds: 3,
    failed: {
      speaker: {
        httpStatus: 503,
        error: 'HTTP 503 from the speaker tab',
        attempts: 2,
        retryInMin: 30,
      },
      'round:2': { httpStatus: 500, error: 'HTTP 500 from round 2', attempts: 5, retryInMin: null },
      motions: { status: 'withheld', httpStatus: 403, error: 'HTTP 403', attempts: 0 },
    },
  },
};

async function seedScrapePieces(prisma, tournament, plan) {
  const base = tournament.sourceUrlRaw;
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const pieces = [
    { kind: 'team', key: '', label: 'Team tab', url: `${base}tab/team/` },
    { kind: 'speaker', key: '', label: 'Speaker tab', url: `${base}tab/speaker/` },
    { kind: 'participants', key: '', label: 'Participants', url: `${base}participants/list/` },
    { kind: 'motions', key: '', label: 'Motions', url: `${base}motions/` },
  ];
  for (let r = 1; r <= plan.rounds; r += 1) {
    pieces.push({
      kind: 'round',
      key: String(r),
      label: `R${r}`,
      url: `${base}results/round/${r}/`,
    });
  }
  for (const piece of pieces) {
    const fail = plan.failed[piece.kind === 'round' ? `round:${piece.key}` : piece.kind];
    await prisma.scrapePiece.create({
      data: {
        tournamentId: tournament.id,
        ...piece,
        status: fail ? (fail.status ?? 'failed') : 'ok',
        httpStatus: fail?.httpStatus ?? null,
        lastError: fail?.error ?? null,
        attempts: fail?.attempts ?? 0,
        lastAttemptAt: tenMinAgo,
        loadedAt: fail ? null : tenMinAgo,
        nextRetryAt:
          fail?.retryInMin != null ? new Date(Date.now() + fail.retryInMin * 60 * 1000) : null,
      },
    });
  }
}

/** The ScrapePiece rows above, and one failed import for the admin list. */
export async function seedScrapeHealth(prisma, userId) {
  for (const [host, plan] of Object.entries(PIECE_PLANS)) {
    const tournament = await prisma.tournament.findFirst({
      where: { sourceUrlRaw: { contains: `//${host}.` } },
      select: { id: true, sourceUrlRaw: true },
    });
    if (tournament) await seedScrapePieces(prisma, tournament, plan);
  }
  // Its URL has no tournament row: the scrape never got far enough to create one.
  await prisma.ingestJob.create({
    data: {
      userId,
      url: 'https://brokenopen2025.calicotab.com/t/private-brokenopen2025/',
      status: 'failed',
      attempts: 3,
      lastError: 'Tournament nav could not be read (HTTP 502)',
      scheduledAt: new Date(Date.now() - 3600 * 1000),
      finishedAt: new Date(Date.now() - 1800 * 1000),
    },
  });
  // The part-2 admin ledgers (Tab states, review set, CV reports, parser
  // warnings) need the pieces above, so they are seeded after them.
  await (await import('./seed-dev-review.mjs')).seedReview(prisma, userId);
}
