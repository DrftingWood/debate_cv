-- Questions to ask of the parsed corpus (load it with schema.sql + load.sql).
--
-- Each heading says what the answer should be. Where a count can be nonzero
-- for a legitimate reason, the comment says what that reason is — the first
-- version of several of these checks was wrong precisely there, and a wrong
-- check reads the same as a clean parse:
--   - "no duplicate ranks" passed because every tied rank had been DROPPED
--   - "one chair per debate" grouped by results PAGE, which holds many rooms
--   - "near-duplicate names" stripped digits, so "Speaker 1" = "Speaker 2"
--   - "rank follows firsts" assumed a tiebreak order tournaments choose
--   - "wins <= firsts" counted outround advancement as a room won
--
--   psql -d corpus -f tests/corpusdb/checks.sql

\pset pager off
\timing off

-- Rosters, one row per member. Materialised once: re-expanding the ' | '
-- lists inside a correlated subquery does not finish on this corpus.
CREATE TEMP TABLE roster AS
SELECT t.tournament_id, lower(btrim(m)) AS nm, lower(btrim(t.team_name)) AS team
FROM teams t, unnest(string_to_array(t.speakers, ' | ')) AS m
WHERE t.speakers <> '';
CREATE INDEX ON roster (tournament_id, nm);

-- Stage depth on the scale the app ranks outrounds by (JUDGE_STATS_RANK).
CREATE TEMP VIEW round_stage AS
SELECT rl.tournament_id,
       (regexp_match(rl.url, '/results/round/(\d+)'))[1]::int AS round_no,
       rl.url, rl.label, rl.stage, rl.category,
       CASE rl.stage
         WHEN 'grand_final' THEN 100 WHEN 'final' THEN 95
         WHEN 'semifinal' THEN 90 WHEN 'partial_semifinal' THEN 85
         WHEN 'quarterfinal' THEN 80 WHEN 'partial_quarterfinal' THEN 75
         WHEN 'octofinal' THEN 70 WHEN 'partial_octofinal' THEN 65
         WHEN 'double_octofinal' THEN 60 WHEN 'partial_double_octofinal' THEN 55
         WHEN 'triple_octofinal' THEN 50 WHEN 'partial_triple_octofinal' THEN 45 END AS depth
FROM round_labels rl
WHERE rl.url ~ '/results/round/\d+';

ANALYZE;

-- ════════════════════════════════════════════════════════════ corpus shape

\echo '== 0. corpus shape =='
SELECT (SELECT count(*) FROM tournaments) AS tournaments,
       (SELECT count(DISTINCT tournament_id) FROM teams) AS team_tabs,
       (SELECT count(DISTINCT tournament_id) FROM speakers) AS speaker_tabs,
       (SELECT count(DISTINCT tournament_id) FROM break_rows) AS break_tabs,
       (SELECT count(DISTINCT tournament_id) FROM team_results) AS results_tabs,
       (SELECT count(DISTINCT tournament_id) FROM motions) AS motions_tabs;

-- ═══════════════════════════════════════════════════════════════════ ranks

\echo '== R1. rows left unranked on a tab that ranks (expect 0) =='
-- A shared place is published as "5=". Reading that as no rank left 9896
-- speakers and 316 teams unranked.
SELECT 'teams' AS src, count(*) AS unranked FROM teams t
WHERE t.rank IS NULL
  AND EXISTS (SELECT 1 FROM teams x WHERE x.tournament_id = t.tournament_id AND x.rank IS NOT NULL)
UNION ALL
SELECT 'speakers', count(*) FROM speakers s
WHERE s.rank IS NULL
  AND EXISTS (SELECT 1 FROM speakers x WHERE x.tournament_id = s.tournament_id AND x.rank IS NOT NULL);

\echo '== R2. places follow competition ranking, 1 1 3 (expect 0) =='
-- Compared with rank() over the published places, so a dropped tie marker,
-- a misread column and a dense 1 1 2 scheme all show up here.
SELECT src, count(*) FILTER (WHERE rank <> expected) AS violations, count(*) AS rows
FROM (
  SELECT 'teams' AS src, rank, rank() OVER (PARTITION BY tournament_id ORDER BY rank) AS expected
  FROM teams WHERE rank IS NOT NULL
  UNION ALL
  SELECT 'speakers', rank, rank() OVER (PARTITION BY tournament_id ORDER BY rank)
  FROM speakers WHERE rank IS NOT NULL
) x GROUP BY src;

\echo '== R3. team places never put more points below fewer (expect 0) =='
-- BP tabs only (firsts published): two-team formats rank on wins, and their
-- points column is the speaker-score fallback.
SELECT count(*) AS inversions FROM (
  SELECT total_points, lead(total_points) OVER (PARTITION BY tournament_id ORDER BY rank) AS nxt
  FROM teams WHERE rank IS NOT NULL AND total_points IS NOT NULL AND firsts IS NOT NULL
) x WHERE nxt > total_points;

\echo '== R4. speaker places agree with totals, between equal speech counts (expect 0) =='
-- A split-round tab ranks by average, so a speaker with fewer speeches can
-- hold a better place on a lower total; those pairs are not compared. Nor
-- are rows sharing one place: tabs put everyone below a cutoff on the same
-- last place ("217=") whatever their totals, and inside a tie the row order
-- is arbitrary.
WITH n AS (
  SELECT s.tournament_id, s.rank, s.total_score, count(r.score) AS speeches
  FROM speakers s JOIN speaker_round_scores r ON r.speaker_id = s.id
  WHERE s.rank IS NOT NULL AND s.total_score IS NOT NULL
  GROUP BY s.id
)
SELECT count(*) AS inversions FROM (
  SELECT rank, total_score,
         max(total_score) OVER (PARTITION BY tournament_id, speeches ORDER BY rank
                                RANGE BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS best_below
  FROM n
) x WHERE best_below > total_score;

-- ══════════════════════════════════════════════════════════ speaker scores

\echo '== S1. a speaker total is the sum of their scored rounds (expect 0) =='
-- Includes speakers with empty rounds: an empty cell is a round not spoken
-- (a swing, an absence), and the published total leaves it out too.
SELECT count(*) AS mismatches FROM (
  SELECT s.total_score, sum(r.score) AS summed
  FROM speakers s JOIN speaker_round_scores r ON r.speaker_id = s.id
  WHERE s.total_score IS NOT NULL
  GROUP BY s.id HAVING count(r.score) > 0
) x WHERE abs(summed - total_score) > 0.5;

\echo '== S2. implausible speech scores (expect 0 0 0) =='
SELECT count(*) FILTER (WHERE score < 0)   AS negative,
       count(*) FILTER (WHERE score > 100) AS over_100,
       count(*) FILTER (WHERE score = 0)   AS exactly_zero,
       count(*)                            AS scored
FROM speaker_round_scores WHERE score IS NOT NULL;

\echo '== S3. empty speech cells, by tab (informational) =='
-- "some" = rounds not spoken. "all empty" should be rare: twelve tabs read
-- that way only because a score written "78<small>.50</small>" was
-- unreadable, and every one of them turned out to publish its scores.
WITH t AS (SELECT tournament_id, count(*) AS n, count(score) AS scored FROM speaker_round_scores GROUP BY 1)
SELECT CASE WHEN scored = 0 THEN 'all empty' WHEN scored = n THEN 'none empty' ELSE 'some empty' END AS tabs,
       count(*), sum(n - scored) AS empty_cells
FROM t GROUP BY 1;

\echo '== S4. declared speaker categories (informational) =='
SELECT category, count(*) AS speakers, count(DISTINCT tournament_id) AS tournaments
FROM speaker_categories GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

-- ═══════════════════════════════════════════════════════════════ BP teams

\echo '== T1. firsts x3 + seconds x2 never exceed points (expect 0) =='
SELECT count(*) FILTER (WHERE firsts * 3 + seconds * 2 > total_points) AS impossible, count(*) AS checked
FROM teams WHERE firsts IS NOT NULL AND seconds IS NOT NULL AND total_points IS NOT NULL;

\echo '== T2. firsts + seconds never exceed prelim rounds (expect 0) =='
-- Split halves (R1A / R1B) are one round.
SELECT count(*) FILTER (WHERE t.firsts + t.seconds > rr.rounds) AS impossible, count(*) AS checked
FROM teams t
JOIN (
  SELECT tournament_id, count(DISTINCT regexp_replace(round_label, '(\d)[A-Za-z]$', '\1')) AS rounds
  FROM speaker_round_scores GROUP BY 1
) rr ON rr.tournament_id = t.tournament_id
WHERE t.firsts IS NOT NULL AND t.seconds IS NOT NULL;

\echo '== T3. BP rooms topped on prelim results pages never exceed firsts (expect 0) =='
-- Prelim pages only: on an outround page "won" means advanced, which is not
-- a first. BP rooms only: a two-team tab can publish a 1sts column of
-- zeros (bigboi), and a two-team win is not a first.
SELECT count(*) FILTER (WHERE x.won_rounds > t.firsts) AS more_wins_than_firsts, count(*) AS checked
FROM teams t
JOIN (
  SELECT tr.tournament_id, lower(btrim(tr.team_name)) AS team, count(*) FILTER (WHERE tr.won) AS won_rounds
  FROM team_results tr
  JOIN round_labels rl ON rl.tournament_id = tr.tournament_id AND rl.url = tr.source_url
  WHERE rl.stage IS NULL AND tr.position ~ '^(Opening|Closing) '
  GROUP BY 1, 2
) x ON x.tournament_id = t.tournament_id AND x.team = lower(btrim(t.team_name))
WHERE t.firsts IS NOT NULL;

\echo '== T4. how tabs order teams level on points (informational) =='
-- Tabbycat lets each tournament choose its standings precedence. A low share
-- here is not a parse error: most tabs break point ties on speaker score.
SELECT count(*) AS point_tied_pairs,
       count(*) FILTER (WHERE f >= nf) AS ordered_by_firsts,
       count(*) FILTER (WHERE f < nf) AS against_firsts
FROM (
  SELECT total_points AS p, lead(total_points) OVER w AS np, firsts AS f, lead(firsts) OVER w AS nf
  FROM teams WHERE rank IS NOT NULL AND firsts IS NOT NULL
  WINDOW w AS (PARTITION BY tournament_id ORDER BY rank)
) x WHERE p = np;

\echo '== T5. roster vs speaker tab, names unique on both (informational) =='
-- A name listed more than once ("Speaker 1" on every swing team, a swing
-- speaker per team filled) cannot be placed, so it is left out. What remains
-- on a different team is swing movement between swing teams.
WITH uniq AS (
  SELECT tournament_id, lower(btrim(speaker_name)) AS nm, min(lower(btrim(team_name))) AS team
  FROM speakers WHERE speaker_name !~* 'redacted'
  GROUP BY 1, 2 HAVING count(*) = 1
), r1 AS (
  SELECT tournament_id, nm, min(team) AS team FROM roster GROUP BY 1, 2 HAVING count(*) = 1
)
SELECT count(*) AS checked,
       count(*) FILTER (WHERE u.team = r.team) AS same_team,
       count(*) FILTER (WHERE u.team <> r.team) AS different_team
FROM r1 r JOIN uniq u USING (tournament_id, nm);

\echo '== T6. roster members the speaker tab does not list (expect only "redacted") =='
SELECT r.nm, count(*) FROM roster r
WHERE EXISTS (SELECT 1 FROM speakers x WHERE x.tournament_id = r.tournament_id)
  AND NOT EXISTS (
    SELECT 1 FROM speakers s
    WHERE s.tournament_id = r.tournament_id AND lower(btrim(s.speaker_name)) = r.nm)
GROUP BY 1 ORDER BY 2 DESC LIMIT 5;

-- ═══════════════════════════════════════════════════════════════════ breaks

\echo '== B1. broken teams with no row on the team tab (expect 0) =='
SELECT count(*) AS orphan_break_rows
FROM break_rows b
WHERE b.entity_type = 'team'
  AND EXISTS (SELECT 1 FROM teams t WHERE t.tournament_id = b.tournament_id)
  AND NOT EXISTS (
    SELECT 1 FROM teams t
    WHERE t.tournament_id = b.tournament_id
      AND lower(btrim(t.team_name)) = lower(btrim(b.entity_name)));

\echo '== B2. an entry listed twice on one break page (expect 0 beyond Redacted) =='
SELECT count(*) AS duplicated FROM (
  SELECT tournament_id, source_url, entity_name FROM break_rows
  WHERE entity_name !~* 'redacted'
  GROUP BY 1, 2, 3 HAVING count(*) > 1
) x;

\echo '== B3. break category acronyms are upper case (expect 0) =='
-- An acronym slug is cased as the lexicon cases it: "hs" is "HS", which is
-- how "HS Grand Final" reads. A short WORD is not an acronym — "nov" is
-- "Nov", "pro" is "Pro" — so only the lexicon's acronym list is checked.
SELECT stage, count(*) FROM break_rows
WHERE lower(stage) IN ('esl', 'efl', 'ell', 'eal', 'hs', 'ms', 'jhs', 'shs', 'ele') AND stage <> upper(stage)
GROUP BY 1;

\echo '== B4. break stages (informational) =='
SELECT coalesce(stage, '(null)') AS stage, count(*) AS rows, count(DISTINCT tournament_id) AS tournaments
FROM break_rows GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

-- ═══════════════════════════════════════════════════════════════════ stages

\echo '== L1. round-label vocabulary (informational) =='
SELECT coalesce(stage, '(prelim / unclassified)') AS stage, count(*) AS labels,
       count(DISTINCT tournament_id) AS tournaments
FROM round_labels GROUP BY 1 ORDER BY 2 DESC;

\echo '== L2. outround-looking labels left unclassified (expect 0) =='
SELECT label, count(*) FROM round_labels
WHERE stage IS NULL AND label ~* 'final|semi|quarter|octo|elim|bracket'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

\echo '== L3. a later outround never classifies shallower, per category (expect 0) =='
-- aoix runs "Partial finals" before its "Semi- Finals". A partial final
-- is read as the Partial Semifinal, which ranks below the Semifinal, so the
-- order holds even there.
SELECT t.host, x.cat, x.round_no, x.prev_label, x.label
FROM (
  SELECT tournament_id, coalesce(category, '(open)') AS cat, round_no, label, depth,
         lag(depth) OVER w AS prev_depth, lag(label) OVER w AS prev_label
  FROM round_stage WHERE depth IS NOT NULL
  WINDOW w AS (PARTITION BY tournament_id, coalesce(category, '(open)') ORDER BY round_no)
) x JOIN tournaments t ON t.id = x.tournament_id
WHERE x.prev_depth IS NOT NULL AND x.depth < x.prev_depth
ORDER BY 1, 3;

\echo '== L4. a prelim after an outround (expect 0) =='
SELECT count(*) FROM (
  SELECT depth, max(depth) OVER (PARTITION BY tournament_id ORDER BY round_no
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS deepest_before
  FROM round_stage
) x WHERE depth IS NULL AND deepest_before IS NOT NULL;

\echo '== L5. two labels classified into one stage slot (expect only spelling variants) =='
-- "Partial X" beside "X" used to land here; a partial round is now the
-- pre-round of X. What remains should be one round spelled two ways.
SELECT t.host, x.stage, x.cat, x.labels
FROM (
  SELECT tournament_id, stage, coalesce(category, '(open)') AS cat,
         string_agg(DISTINCT label, ' | ') AS labels
  FROM round_labels WHERE stage IS NOT NULL
  GROUP BY 1, 2, 3 HAVING count(DISTINCT label) > 1
) x JOIN tournaments t ON t.id = x.tournament_id
ORDER BY 1;

-- ═════════════════════════════════════════════════════════════ results pages

\echo '== P1. is_outround agrees with the nav label (expect 0) =='
SELECT count(*) AS disagreements
FROM round_debates d
JOIN round_labels rl ON rl.tournament_id = d.tournament_id AND rl.url = d.source_url
WHERE d.is_outround <> (rl.stage IS NOT NULL);

\echo '== P2. one chair per BP room: chairs = teams / 4 (expect 0 extra; a few pages short) =='
-- Trainees carry a symbol too (Ⓣ beside the chair's Ⓒ); reading "has a
-- symbol" as chair put 96 chairs in 30 rooms. A small residue can be real:
-- a room whose chair is redacted has no readable chair at all.
SELECT count(*) AS pages_off, count(*) FILTER (WHERE c.chairs > tr.teams / 4) AS extra_chairs
FROM (SELECT tournament_id, source_url, count(*) AS teams FROM team_results
      WHERE position ~ '^(Opening|Closing) ' GROUP BY 1, 2) tr
JOIN (SELECT tournament_id, source_url, count(*) FILTER (WHERE panel_role = 'chair') AS chairs
      FROM judge_assignments GROUP BY 1, 2) c USING (tournament_id, source_url)
WHERE c.chairs <> tr.teams / 4;

\echo '== P3. BP sides balance on every page (expect all true) =='
SELECT (count(*) FILTER (WHERE position = 'Opening Government') = count(*) FILTER (WHERE position = 'Opening Opposition')
    AND count(*) FILTER (WHERE position = 'Opening Government') = count(*) FILTER (WHERE position = 'Closing Government')
    AND count(*) FILTER (WHERE position = 'Opening Government') = count(*) FILTER (WHERE position = 'Closing Opposition')) AS balanced,
       count(*) OVER () AS pages
FROM team_results WHERE position ~ '^(Opening|Closing) '
GROUP BY tournament_id, source_url LIMIT 1;

\echo '== P4. share of BP teams marked won, by stage (1 in 4 for prelims and finals, 1 in 2 otherwise) =='
SELECT coalesce(rl.stage, '(prelim)') AS stage, x.share, count(*) AS pages
FROM (SELECT tournament_id, source_url, round(avg(won::int), 2) AS share
      FROM team_results WHERE position ~ '^(Opening|Closing) ' GROUP BY 1, 2) x
LEFT JOIN round_labels rl ON rl.tournament_id = x.tournament_id AND rl.url = x.source_url
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== P4b. two-team pages: every row has a result, one winner per room (expect 0 0) =='
-- The outcome is only in the result cell's popover title ("Won against X");
-- reading the cell text left 1083 of 1084 prelim rows without one.
SELECT count(*) FILTER (WHERE won_null > 0) AS pages_with_unread_results,
       count(*) FILTER (WHERE won <> teams / 2) AS pages_without_one_winner_per_room,
       count(*) AS pages
FROM (
  SELECT tournament_id, source_url, count(*) AS teams,
         count(*) FILTER (WHERE won) AS won, count(*) FILTER (WHERE won IS NULL) AS won_null
  FROM team_results WHERE position !~ '^(Opening|Closing) '
  GROUP BY 1, 2
) x;

\echo '== P5. a results-page team the team tab never lists (expect 0) =='
SELECT count(*) FROM team_results tr
WHERE EXISTS (SELECT 1 FROM teams t WHERE t.tournament_id = tr.tournament_id)
  AND NOT EXISTS (
    SELECT 1 FROM teams t
    WHERE t.tournament_id = tr.tournament_id AND lower(btrim(t.team_name)) = lower(btrim(tr.team_name)));

\echo '== P6. judges the participants page cannot place (expect a handful of typos) =='
SELECT t.host, j.person_name
FROM (SELECT DISTINCT tournament_id, person_name FROM judge_assignments) j
JOIN tournaments t ON t.id = j.tournament_id
WHERE EXISTS (SELECT 1 FROM participants x WHERE x.tournament_id = j.tournament_id)
  AND NOT EXISTS (
    SELECT 1 FROM participants p
    WHERE p.tournament_id = j.tournament_id AND lower(btrim(p.name)) = lower(btrim(j.person_name)))
LIMIT 10;

-- ════════════════════════════════════════════════════════════════════ names

\echo '== N1. markup or entities left in a name (expect 0) =='
SELECT 'teams' AS src, count(*) FROM teams WHERE team_name ~ '<[a-zA-Z/]|&(amp|lt|gt|quot|#[0-9]+);'
UNION ALL SELECT 'speakers', count(*) FROM speakers
  WHERE speaker_name ~ '<[a-zA-Z/]|&(amp|lt|gt|quot|#[0-9]+);' AND speaker_name !~* '^<em>\s*redacted\s*</em>$'
UNION ALL SELECT 'participants', count(*) FROM participants
  WHERE name ~ '<[a-zA-Z/]|&(amp|lt|gt|quot|#[0-9]+);' AND name !~* '^<em>\s*redacted\s*</em>$'
UNION ALL SELECT 'judges', count(*) FROM judge_assignments WHERE person_name ~ '<[a-zA-Z/]|&(amp|lt|gt|quot|#[0-9]+);';

\echo '== N2. empty names (expect 0) =='
SELECT 'teams' AS src, count(*) FROM teams WHERE btrim(coalesce(team_name, '')) = ''
UNION ALL SELECT 'speakers', count(*) FROM speakers WHERE btrim(coalesce(speaker_name, '')) = ''
UNION ALL SELECT 'participants', count(*) FROM participants WHERE btrim(coalesce(name, '')) = '';

\echo '== N3. one name in two spellings on one speaker tab (informational) =='
-- Punctuation and case folded, digits KEPT. Normalised identically on
-- ingest, so both rows land on one Person.
SELECT t.host, string_agg(DISTINCT s.speaker_name, ' | ') AS spellings
FROM speakers s JOIN tournaments t ON t.id = s.tournament_id
WHERE s.speaker_name !~* 'redacted'
GROUP BY t.host, s.tournament_id, lower(regexp_replace(s.speaker_name, '[^[:alnum:]]', '', 'g'))
HAVING count(DISTINCT s.speaker_name) > 1;

\echo '== N4. placeholder speakers (informational) =='
-- Organisers' stand-ins on swing teams. Parsed as written; ingest makes no
-- Person for any name lib/calicotab/names.ts calls a placeholder.
SELECT lower(regexp_replace(speaker_name, '\s*[0-9]+[a-z]?$', ' N')) AS placeholder,
       count(*) AS rows, count(DISTINCT tournament_id) AS tournaments
FROM speakers
WHERE speaker_name ~* '^(speaker|debater|orador|member|participant|iron|swing)\s*[0-9]+[a-z]?$'
GROUP BY 1 ORDER BY 2 DESC;

\echo '== N5. names still carrying an attendance tag like "[o] " (expect 0) =='
SELECT 'participants' AS src, count(*) FROM participants WHERE name ~ '^\[[a-z]\] ' OR team_name ~ '^\[[a-z]\] '
UNION ALL SELECT 'judges', count(*) FROM judge_assignments WHERE person_name ~ '^\[[a-z]\] '
UNION ALL SELECT 'teams', count(*) FROM teams WHERE team_name ~ '^\[[a-z]\] '
UNION ALL SELECT 'speaker teams', count(*) FROM speakers WHERE team_name ~ '^\[[a-z]\] '
UNION ALL SELECT 'results', count(*) FROM team_results WHERE team_name ~ '^\[[a-z]\] '
UNION ALL SELECT 'break', count(*) FROM break_rows WHERE entity_name ~ '^\[[a-z]\] ';

-- ══════════════════════════════════════════════════════════════════ motions
-- Meaningful only once motions.csv holds the real /motions/ pages (see
-- tests/__motionsweep.live.test.ts, MOTIONS_CSV); a corpus built from
-- /motions/statistics/ yields a handful of rows, with motion text where the
-- round label should be.

\echo '== K1. motion text quality (expect 0 in every column but rows) =='
SELECT count(*) AS rows,
       count(*) FILTER (WHERE text ~ '<[a-zA-Z/]') AS with_markup,
       count(*) FILTER (WHERE text ~ '&(amp|lt|gt|quot|#[0-9]+);') AS with_entity,
       count(*) FILTER (WHERE btrim(text) = '') AS empty_text,
       count(*) FILTER (WHERE text ~* 'view info slide') AS button_text_leaked
FROM motions;

\echo '== K2. every motion round is a round the nav lists (expect 0 unmatched) =='
SELECT count(*) FILTER (WHERE rl.label IS NULL) AS unmatched, count(*) AS motion_rounds
FROM (SELECT DISTINCT tournament_id, round_label FROM motions) m
LEFT JOIN (SELECT DISTINCT tournament_id, label FROM round_labels) rl
  ON rl.tournament_id = m.tournament_id AND lower(btrim(rl.label)) = lower(btrim(m.round_label))
WHERE EXISTS (SELECT 1 FROM round_labels x WHERE x.tournament_id = m.tournament_id);

\echo '== K3. seq is contiguous from 0 per page (expect all 0) =='
SELECT (max(seq) + 1) - count(DISTINCT seq) AS gaps, count(*) OVER () AS pages
FROM motions GROUP BY tournament_id, url LIMIT 1;
