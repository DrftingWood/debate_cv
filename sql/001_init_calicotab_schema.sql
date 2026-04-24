-- Foundational relational schema for Calicotab tournament ingestion.

CREATE TABLE IF NOT EXISTS tournaments (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT,
  year INTEGER,
  source_url_raw TEXT NOT NULL,
  source_host TEXT,
  source_tournament_slug TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS people (
  id BIGSERIAL PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(normalized_name)
);

CREATE TABLE IF NOT EXISTS tournament_participants (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  person_id BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  team_name TEXT,
  speaker_score_total NUMERIC,
  team_score_total NUMERIC,
  wins INTEGER,
  losses INTEGER,
  elimination_reached TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, person_id)
);

CREATE TABLE IF NOT EXISTS participant_roles (
  tournament_participant_id BIGINT NOT NULL REFERENCES tournament_participants(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (tournament_participant_id, role)
);

CREATE TABLE IF NOT EXISTS speaker_round_scores (
  id BIGSERIAL PRIMARY KEY,
  tournament_participant_id BIGINT NOT NULL REFERENCES tournament_participants(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  position_label TEXT,
  score NUMERIC,
  UNIQUE(tournament_participant_id, round_number, position_label)
);

CREATE TABLE IF NOT EXISTS team_results (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  round_number INTEGER,
  wins INTEGER,
  losses INTEGER,
  points NUMERIC,
  UNIQUE(tournament_id, team_name, round_number)
);

CREATE TABLE IF NOT EXISTS elimination_results (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  result TEXT,
  UNIQUE(tournament_id, stage, entity_type, entity_name)
);

CREATE TABLE IF NOT EXISTS judge_assignments (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  person_id BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  stage TEXT,
  panel_role TEXT,
  round_number INTEGER,
  UNIQUE(tournament_id, person_id, stage, panel_role, round_number)
);

CREATE INDEX IF NOT EXISTS idx_tournaments_year ON tournaments(year);
CREATE INDEX IF NOT EXISTS idx_tournaments_format ON tournaments(format);
CREATE INDEX IF NOT EXISTS idx_tp_tournament_id ON tournament_participants(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tp_person_id ON tournament_participants(person_id);
