-- The parsed Tabbycat corpus, relational. Pairs with the CSVs written by
-- tests/__corpusdb.live.test.ts and the questions in checks.sql.
--
-- Deliberately NOT the app's Prisma schema: this is several hundred public
-- tournaments with no user, no identity resolution and no private URLs.
-- Keep it in its own database so a query here can never be mistaken for app
-- data.
--
--   createdb corpus
--   psql -d corpus -f tests/corpusdb/schema.sql
--   psql -d corpus -v csv=<CSV_OUT> -f tests/corpusdb/load.sql
--   psql -d corpus -f tests/corpusdb/checks.sql
--
-- `\copy` reads the CSVs from wherever psql runs, so when Postgres is in a
-- container, run psql inside it and copy the CSVs in first.

DROP TABLE IF EXISTS motions, round_labels, participants, judge_assignments, team_results,
  round_debates, break_rows, speaker_categories, speaker_round_scores, speakers, teams,
  tournaments CASCADE;

CREATE TABLE tournaments (
  id           int PRIMARY KEY,
  root         text NOT NULL,
  host         text NOT NULL,
  slug         text,
  name         text,
  version      text,
  page_count   int
);

CREATE TABLE teams (
  tournament_id int REFERENCES tournaments(id),
  rank          int,
  team_name     text,
  institution   text,
  wins          int,
  total_points  numeric,
  -- The roster, ' | ' joined, from the team cell's popover.
  speakers      text,
  firsts        int,
  seconds       int
);

CREATE TABLE speakers (
  -- Surrogate key. The speaker's NAME is not unique within a tournament:
  -- two people can share one, swing speakers are listed once per team they
  -- filled in for, and every opted-out speaker is the same
  -- "<em>Redacted</em>" string.
  id            int PRIMARY KEY,
  tournament_id int REFERENCES tournaments(id),
  rank          int,
  rank_esl      int,
  rank_efl      int,
  speaker_name  text,
  team_name     text,
  institution   text,
  total_score   numeric
);

CREATE TABLE speaker_round_scores (
  speaker_id     int REFERENCES speakers(id),
  tournament_id  int REFERENCES tournaments(id),
  speaker_name   text,
  round_label    text,
  score          numeric,
  position_label text
);

-- The break categories a speaker tab declares for each speaker, one row per
-- category, from the same parser the app runs.
CREATE TABLE speaker_categories (
  speaker_id    int REFERENCES speakers(id),
  tournament_id int REFERENCES tournaments(id),
  category      text
);

CREATE TABLE break_rows (
  tournament_id int REFERENCES tournaments(id),
  source_url    text,
  rank          int,
  entity_type   text,
  entity_name   text,
  institution   text,
  score         numeric,
  stage         text
);

CREATE TABLE round_debates (
  tournament_id int REFERENCES tournaments(id),
  source_url    text,
  round_label   text,
  is_outround   boolean,
  round_number  int
);

CREATE TABLE team_results (
  tournament_id int REFERENCES tournaments(id),
  source_url    text,
  team_name     text,
  position      text,
  points        int,
  won           boolean
);

CREATE TABLE judge_assignments (
  tournament_id int REFERENCES tournaments(id),
  source_url    text,
  person_name   text,
  panel_role    text
);

CREATE TABLE participants (
  tournament_id int REFERENCES tournaments(id),
  name          text,
  role          text,
  judge_tag     text,
  team_name     text,
  institution   text
);

-- Round labels with what the stage lexicon made of them, so the vocabulary
-- itself is queryable.
CREATE TABLE round_labels (
  tournament_id int REFERENCES tournaments(id),
  url           text,
  label         text,
  stage         text,
  category      text
);

-- Motions as released on /motions/. Multiple rows per round are legal
-- (motion-per-room formats, replaced motions).
CREATE TABLE motions (
  tournament_id int REFERENCES tournaments(id),
  url           text,
  round_number  int,
  round_label   text,
  stage         text,
  category      text,
  seq           int,
  text          text,
  info_slide    text
);
