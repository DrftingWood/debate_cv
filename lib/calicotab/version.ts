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
//
// 20260914.0: same reasoning, wider. Every cached parse from 20260611.0
// is wrong in at least one of these ways, and none of it is repaired
// without re-parsing the tournament:
//   - the winner of an outround was recorded as having LOST it, because
//     "advancing" matched none of the win patterns
//   - judge names were stored as HTML fragments, and every judge as a
//     panellist, because the adjudicator cell is markup
//   - a stage label's break category was dropped ("ESL Final" -> "Final")
//     and non-English labels were misread ("Cuartos de Final", Spanish for
//     QUARTERfinals, read as the final)
//   - "M&Ms" was stored as "M&amp;Ms"
//   - split rounds (R1A/R1B) were dropped from speaker scores
//   - motions were fetched from the wrong URL and unreadable at it
//   - speaker break categories, team rosters and BP firsts/seconds were
//     never read at all
// A tournament scraped inside the 30-day freshness window would otherwise
// keep all of that until it aged out.
export const PARSER_VERSION = '20260914.0';
