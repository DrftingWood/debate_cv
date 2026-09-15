-- Bulk-load the loader's CSVs. Pass the CSV directory as a psql variable:
--
--   psql -d corpus -v csv=/path/to/csv -f tests/corpusdb/load.sql
--
-- `\copy` takes the rest of its line literally, so a variable cannot name
-- the file. `\cd` does expand one, and `\copy` resolves a relative path
-- against it — both on the machine psql runs on.

\set ON_ERROR_STOP on
\cd :csv

\copy tournaments FROM 'tournaments.csv' WITH (FORMAT csv)
\copy teams FROM 'teams.csv' WITH (FORMAT csv)
\copy speakers FROM 'speakers.csv' WITH (FORMAT csv)
\copy speaker_round_scores FROM 'speaker_round_scores.csv' WITH (FORMAT csv)
\copy speaker_categories FROM 'speaker_categories.csv' WITH (FORMAT csv)
\copy break_rows FROM 'break_rows.csv' WITH (FORMAT csv)
\copy round_debates FROM 'round_debates.csv' WITH (FORMAT csv)
\copy team_results FROM 'team_results.csv' WITH (FORMAT csv)
\copy judge_assignments FROM 'judge_assignments.csv' WITH (FORMAT csv)
\copy participants FROM 'participants.csv' WITH (FORMAT csv)
\copy round_labels FROM 'round_labels.csv' WITH (FORMAT csv)
\copy motions FROM 'motions.csv' WITH (FORMAT csv)

CREATE INDEX ON speakers (tournament_id);
CREATE INDEX ON speaker_round_scores (speaker_id);
CREATE INDEX ON speaker_categories (speaker_id);
CREATE INDEX ON teams (tournament_id);
CREATE INDEX ON break_rows (tournament_id);
CREATE INDEX ON team_results (tournament_id, source_url);
CREATE INDEX ON judge_assignments (tournament_id, source_url);
CREATE INDEX ON participants (tournament_id);
CREATE INDEX ON round_labels (tournament_id, url);
ANALYZE;
