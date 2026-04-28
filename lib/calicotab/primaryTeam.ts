import type { SpeakerTabRow } from '@/lib/calicotab/parseTabs';

/**
 * Determine each speaker's PRIMARY team across an ingest's speaker tab
 * rows. "Primary" = the team where the speaker has the most scored prelim
 * rounds, since that's the team they actually represented at the
 * tournament. Iron-manning speakers (mid-tournament substitutions) appear
 * in multiple rows with different `teamName`s, and naively upserting them
 * clobbers `teamName` on every iteration; this map provides a stable
 * answer the upsert can write on every iteration.
 *
 * Resort-stability is the key property: if Tabbycat re-sorts the speaker
 * tab between ingests (by score, by team, by category), the "primary
 * team" answer doesn't change. The prior "first observed" heuristic was
 * order-dependent and could silently flip a speaker's team affiliation
 * on /cv after a re-ingest (audit issue #14).
 *
 * Ties (same scored-round count across multiple teams) are broken by
 * iteration order — for SpeakerTabRow inputs that come from a single
 * parse, that's deterministic per-parse but not necessarily across
 * parses. Tied iron-mans are vanishingly rare; either choice works.
 *
 * Keyed by lookup-id (the bigint that the speaker upsert uses) so the
 * caller doesn't have to re-resolve names.
 */
export function buildPrimaryTeamMap(
  rows: Array<{ row: SpeakerTabRow; lookupId: bigint }>,
): Map<bigint, string | null> {
  const counts = new Map<bigint, Map<string | null, number>>();
  for (const { row, lookupId } of rows) {
    const scored = row.roundScores.filter((rs) => rs.score != null).length;
    const inner = counts.get(lookupId) ?? new Map();
    inner.set(row.teamName ?? null, (inner.get(row.teamName ?? null) ?? 0) + scored);
    counts.set(lookupId, inner);
  }

  const out = new Map<bigint, string | null>();
  for (const [id, inner] of counts) {
    let best: { team: string | null; count: number } | null = null;
    for (const [team, count] of inner) {
      if (best == null || count > best.count) best = { team, count };
    }
    if (best) out.set(id, best.team);
  }
  return out;
}
