/**
 * Bumped when any parser module changes shape. Stored on every ParserRun so
 * that the ingest orchestrator can invalidate cached tournaments whose last
 * successful parse was on an older version.
 *
 * Convention: YYYYMMDD.N where N starts at 1 and increments within a day.
 */
// 20260611.0: deliberate full-invalidation bump — the parser now fetches
// the motions tab, persists per-round team positions (previously parsed
// and discarded), and fetch.ts retains gzipped page bodies. All three
// only materialize for a tournament on re-parse, so cached parses from
// older versions must be considered stale.
export const PARSER_VERSION = '20260611.0';
