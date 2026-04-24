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
export function collectRegistrationWarnings(snapshot: PrivateUrlSnapshot): string[] {
  const w: string[] = [];
  if (!snapshot.tournamentName) w.push('missing: tournamentName');
  if (!snapshot.registration.personName) w.push('missing: registration.personName');
  if (!snapshot.navigation.teamTab) w.push('missing: navigation.teamTab');
  if (!snapshot.navigation.speakerTab) w.push('missing: navigation.speakerTab');
  if (snapshot.navigation.resultsRounds.length === 0) {
    w.push('missing: navigation.resultsRounds');
  }
  return w;
}
