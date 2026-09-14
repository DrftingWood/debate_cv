import { prisma } from '@/lib/db';
import type { PrivateUrlSnapshot } from './parseNav';
import { PARSER_VERSION } from './version';

export type RecordParserRunInput = {
  sourceDocumentId: string;
  parserName: string;
  success: boolean;
  warnings?: string[];
  durationMs?: number;
};

export type RegistrationWarningContext = {
  privateUrlSentAt?: Date | null;
  now?: Date;
};

/**
 * Retention window for superseded pipeline history. 90 days keeps enough
 * trail to debug "why did this tournament parse differently last month"
 * while bounding growth — SourceDocument now carries gzipped page bodies,
 * so the table is the storage-heavy one.
 */
const RETENTION_DAYS = 90;

/**
 * Prune pipeline history that no live code path can ever read again. Runs
 * at the end of the cron drain; failures are reported to the caller but
 * must never block queue processing.
 *
 * Two rules, both deliberately conservative:
 *
 * 1. SourceDocument: delete rows past retention that are NOT the newest
 *    snapshot for their URL. The newest row per URL is the re-derivation
 *    archive (the whole point of storing bodies) and is kept forever —
 *    and because fetchHtmlWithProvenance updates fetchedAt on every
 *    content-match, any document still being served fresh is always the
 *    newest for its URL and therefore never eligible. ParserRuns cascade
 *    with their document.
 *
 * 2. ParserRun: delete rows past retention EXCEPT each document's most
 *    recent successful run. isLatestParserRun() reads exactly that row to
 *    decide cache freshness — deleting it would silently force a full
 *    re-scrape of every cached tournament on its next touch.
 */
export async function pruneIngestArtifacts(): Promise<{
  sourceDocumentsDeleted: number;
  parserRunsDeleted: number;
}> {
  const sourceDocumentsDeleted = await prisma.$executeRaw`
    DELETE FROM "SourceDocument" sd
    WHERE sd."fetchedAt" < NOW() - (${RETENTION_DAYS}::int * INTERVAL '1 day')
      AND EXISTS (
        SELECT 1 FROM "SourceDocument" newer
        WHERE newer."url" = sd."url" AND newer."fetchedAt" > sd."fetchedAt"
      )
  `;
  const parserRunsDeleted = await prisma.$executeRaw`
    DELETE FROM "ParserRun" pr
    WHERE pr."createdAt" < NOW() - (${RETENTION_DAYS}::int * INTERVAL '1 day')
      AND pr."id" NOT IN (
        SELECT DISTINCT ON ("sourceDocumentId") "id"
        FROM "ParserRun"
        WHERE "success" = true
        ORDER BY "sourceDocumentId", "createdAt" DESC
      )
  `;
  return { sourceDocumentsDeleted, parserRunsDeleted };
}

/** Always runs — if the provenance write fails we swallow it so ingest isn't blocked. */
export async function recordParserRun(input: RecordParserRunInput): Promise<void> {
  try {
    await prisma.parserRun.create({
      data: {
        sourceDocumentId: input.sourceDocumentId,
        parserName: input.parserName,
        parserVersion: PARSER_VERSION,
        success: input.success,
        warnings: input.warnings ?? [],
        durationMs: input.durationMs ?? null,
      },
    });
  } catch (err) {
    // Non-fatal: we never want parser_runs write failure to break an ingest.
    console.warn('[provenance] recordParserRun failed:', err);
  }
}

/**
 * Inspect a parsed landing page and emit human-readable warnings for fields
 * we expected to find but didn't. Surfacing selector misses into ParserRun.warnings
 * turns the DB into a lightweight parser-health dashboard.
 */
export function collectRegistrationWarnings(
  snapshot: PrivateUrlSnapshot,
  context: RegistrationWarningContext = {},
): string[] {
  const w: string[] = [];
  if (!snapshot.tournamentName) w.push('missing: tournamentName');
  if (!snapshot.registration.personName) w.push('missing: registration.personName');

  // Nav tabs: distinguish "discovered on landing page" from "constructed as
  // fallback" from "truly missing". The extractNavigation matcher now
  // populates `meta.discovered` and `meta.constructed` so we can write
  // informative rows instead of a binary "missing" flag.
  const meta = snapshot.navigation.meta ?? { discovered: [], constructed: [] };
  const discovered = new Set(meta.discovered);
  const constructed = new Set(meta.constructed);
  for (const key of ['teamTab', 'speakerTab', 'participants'] as const) {
    if (constructed.has(key)) w.push(`nav: ${key} constructed as fallback`);
    else if (!discovered.has(key)) w.push(`nav: ${key} not found`);
  }
  if (snapshot.navigation.resultsRounds.length === 0) {
    w.push('nav: resultsRounds not found');
  }
  // Break tabs are optional: tournaments before breaks are published (or with
  // no break stage at all) legitimately have none. Keep this as an optional
  // diagnostic so parser-health dashboards don't overcount it as an error.
  if (snapshot.navigation.breakTabs.length === 0) {
    w.push('nav: breakTabs not found (optional)');
  }

  // Heuristic: if the private URL email was sent over a month ago, the event
  // is likely finished, so missing tabs are often intentional (e.g. school
  // tournaments that hide child-identifying pages from participant links).
  const sentAt = context.privateUrlSentAt ?? null;
  if (sentAt) {
    const now = context.now ?? new Date();
    const ageMs = now.getTime() - sentAt.getTime();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    if (ageMs >= THIRTY_DAYS_MS) {
      w.push('timing: competition likely finished (private URL email is older than 30 days)');
    }
  }
  const hiddenCoreTabs = ['teamTab', 'speakerTab', 'participants']
    .filter((k) => !discovered.has(k) || constructed.has(k));
  if (snapshot.navigation.breakTabs.length === 0 && hiddenCoreTabs.length >= 2) {
    w.push(
      'nav: limited tab visibility may be intentional (e.g., schools/child-protection privacy settings)',
    );
  }
  return w;
}
