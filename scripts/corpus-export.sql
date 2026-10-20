-- Export one person's record from a corpus database as a single JSON bundle.
--
--   psql -d corpus_mitra -v subject="'Ritabrata Mitra'" \
--        -t -A -f scripts/corpus-export.sql > bundle.json
--
-- JSON rather than CSV because the consumer (scripts/seed-from-corpus.mjs)
-- runs on Prisma, which has no Postgres driver of its own to query with, and
-- adding one just to move rows between two local databases is not worth a
-- dependency. `psql` is already the tool that built the corpus.
--
-- The field slice is deliberately wider than the subject: placement on the
-- tab ("18th of 412") is a fact about everyone else at that tournament, so
-- every speaker's total has to come across even though only one person's
-- record is being rendered.

\set ON_ERROR_STOP on

SELECT json_build_object(
  'subject', :subject,

  'tournaments', (
    SELECT coalesce(json_agg(row_to_json(t)), '[]')
    FROM (SELECT id, root, host, slug, name FROM tournaments ORDER BY id) t
  ),

  -- Every tournament the subject attended, with the role and the name they
  -- registered under there (institution moves across a career; the CV shows
  -- the one from that tournament, not a career-wide guess).
  'participation', (
    SELECT coalesce(json_agg(row_to_json(p)), '[]')
    FROM (
      SELECT DISTINCT tournament_id, role, team_name, institution, judge_tag
      FROM participants WHERE name = :subject
    ) p
  ),

  -- The subject's row on each speaker tab.
  'speaker', (
    SELECT coalesce(json_agg(row_to_json(s)), '[]')
    FROM (
      SELECT id, tournament_id, rank, rank_esl, rank_efl, team_name,
             institution, total_score
      FROM speakers WHERE speaker_name = :subject
    ) s
  ),

  'scores', (
    SELECT coalesce(json_agg(row_to_json(r)), '[]')
    FROM (
      SELECT r.speaker_id, r.tournament_id, r.round_label, r.score, r.position_label
      FROM speaker_round_scores r
      JOIN speakers s ON s.id = r.speaker_id
      WHERE s.speaker_name = :subject
    ) r
  ),

  -- Round label and outround flag come from the results page itself
  -- (round_debates), keyed by URL. A number in the URL is not enough: round 10
  -- at a 9-prelim major is a quarterfinal, and ingest stores it by name.
  -- Teammates' own speeches, round by round. Pro-am labels compare scored
  -- speeches only (a tab total cannot be averaged without knowing how many
  -- rounds the person spoke), and the carry index compares the user with a
  -- partner in the same round. Real ingest stores every speaker's round
  -- scores; the seed only needs the subject's teammates.
  'teammate_scores', (
    SELECT coalesce(json_agg(row_to_json(ts)), '[]')
    FROM (
      SELECT r.tournament_id, r.speaker_name, r.round_label, r.score, r.position_label
      FROM speaker_round_scores r
      JOIN speakers mate ON mate.id = r.speaker_id
      JOIN speakers me
        ON me.tournament_id = mate.tournament_id
       AND me.team_name = mate.team_name
       AND me.speaker_name = :subject
      WHERE mate.speaker_name <> :subject
    ) ts
  ),

  'judging', (
    SELECT coalesce(json_agg(row_to_json(j)), '[]')
    FROM (
      SELECT ja.tournament_id, ja.source_url, ja.panel_role,
             rd.round_label, rd.is_outround, rd.round_number
      FROM judge_assignments ja
      LEFT JOIN round_debates rd
        ON rd.tournament_id = ja.tournament_id AND rd.source_url = ja.source_url
      WHERE ja.person_name = :subject
    ) j
  ),

  -- Field context: every speaker's total, for placement and tab size.
  'field', (
    SELECT coalesce(json_agg(row_to_json(f)), '[]')
    FROM (
      SELECT tournament_id, speaker_name, team_name, total_score, rank
      FROM speakers
    ) f
  ),

  -- The subject's own team on each break tab. This is what makes a speaking
  -- entry count as a break: the CV reads TournamentParticipant.teamBreakRank,
  -- not the EliminationResult rows (those carry outround win/loss and the
  -- adjudicator break). `stage` here is the break CATEGORY — "Open", "ESL" —
  -- not an outround, so it cannot stand in for eliminationReached.
  --
  -- Matched on team name because that is the only key a break tab shares with
  -- a speaker tab. Both truncate long team names identically, so the join
  -- holds; a team renamed between the two tabs would be missed.
  'team_breaks', (
    SELECT coalesce(json_agg(row_to_json(tb)), '[]')
    FROM (
      SELECT DISTINCT b.tournament_id, b.rank, b.stage, b.entity_name
      FROM break_rows b
      WHERE b.entity_type = 'team'
        AND b.entity_name IN (
          SELECT s.team_name FROM speakers s
          WHERE s.speaker_name = :subject AND s.tournament_id = b.tournament_id
          UNION
          SELECT p.team_name FROM participants p
          WHERE p.name = :subject AND p.tournament_id = b.tournament_id
        )
    ) tb
  ),

  'categories', (
    SELECT coalesce(json_agg(row_to_json(c)), '[]')
    FROM (
      SELECT c.tournament_id, c.category
      FROM speaker_categories c
      JOIN speakers s ON s.id = c.speaker_id
      WHERE s.speaker_name = :subject
    ) c
  ),

  'breaks', (
    SELECT coalesce(json_agg(row_to_json(b)), '[]')
    FROM (
      SELECT tournament_id, rank, entity_type, entity_name, institution, stage
      FROM break_rows
    ) b
  ),

  -- The team tab: standings (stored by ingest as TeamResult round 0) and
  -- rosters, which format inference uses for squad size.
  'teams', (
    SELECT coalesce(json_agg(row_to_json(tm)), '[]')
    FROM (
      SELECT tournament_id, team_name, rank, wins, total_points, firsts, seconds, speakers
      FROM teams
    ) tm
  ),

  -- Speakers by team from the participants page — the squad-size source of
  -- last resort, for tournaments that publish neither a team nor speaker tab.
  'squads', (
    SELECT coalesce(json_agg(row_to_json(sq)), '[]')
    FROM (
      SELECT tournament_id, team_name FROM participants
      WHERE role = 'speaker' AND coalesce(team_name, '') <> ''
    ) sq
  ),

  'team_results', (
    SELECT coalesce(json_agg(row_to_json(tr)), '[]')
    FROM (
      SELECT tr.tournament_id, tr.source_url, tr.team_name, tr.position, tr.points, tr.won,
             rd.round_label, rd.is_outround
      FROM team_results tr
      LEFT JOIN round_debates rd
        ON rd.tournament_id = tr.tournament_id AND rd.source_url = tr.source_url
    ) tr
  ),

  -- Prelim count per tournament, the divisor every "speaker average" on the
  -- CV is computed against. Taken from how many distinct rounds the speaker
  -- tab actually published rather than from a round-label digit, so a
  -- tournament with split rounds (R1A / R1B) is not counted twice and the
  -- tab's own "Average" column is not mistaken for a round.
  'prelims', (
    SELECT coalesce(json_agg(row_to_json(pr)), '[]')
    FROM (
      SELECT tournament_id,
             count(DISTINCT regexp_replace(round_label, '[A-Za-z]+$', '')) AS prelims
      FROM speaker_round_scores
      WHERE coalesce(position_label, '') <> 'average'
      GROUP BY tournament_id
    ) pr
  ),

  'motions', (
    SELECT coalesce(json_agg(row_to_json(m)), '[]')
    FROM (
      SELECT tournament_id, round_number, round_label, stage, category, seq,
             text, info_slide
      FROM motions
    ) m
  )
);
