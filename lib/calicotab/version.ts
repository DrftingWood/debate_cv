/**
 * Bumped when any parser module changes shape. Stored on every ParserRun so
 * that the ingest orchestrator can invalidate cached tournaments whose last
 * successful parse was on an older version.
 *
 * Convention: YYYYMMDD.N where N starts at 1 and increments within a day.
 */
export const PARSER_VERSION = '20260424.1';
