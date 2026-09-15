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
//
// 20260915.0: two more, found by querying the same corpus loaded into
// Postgres. Neither 20260914.0 nor production has these right, so the bump
// costs production nothing beyond the re-parse it is already due; it exists
// so anything parsed at 20260914.0 (a preview deploy) is not kept.
//   - a tied place ("5=") was read as no rank: 69% of speakers and 5% of
//     teams in the corpus were stored unranked
//   - every trainee on a results page was read as a chair (5310 marks)
//   - "GF", "Octavos" and "Cuartos" results pages read as prelims, so their
//     winners were never recorded
//   - "Double Quarterfinals" / "Double Semifinals" were read one full stage
//     too deep; a break slug like "hs" was stored as "Hs"
//   - rounds get one nomenclature: a round run with byes is "Partial
//     <rung>", whatever it was called ("Pre-Quarterfinals" and "Partial
//     Double Quarters" are both Partial Octofinals)
//   - a hybrid event's "[o]"/"[i]" attendance tag was kept in names, and
//     stand-ins like "Speaker 1" were made into people
//   - a score written "78<small>.50</small>" was unreadable: every speech on
//     twelve corpus tabs was stored empty, and no-Total tabs had no total
//   - two-team results ("Won against X" in a popover) were never read
//   - split / zero-based rounds put scores and motions on the wrong round
//   - a "—" team was stored as a team; category casing varied
export const PARSER_VERSION = '20260915.0';
