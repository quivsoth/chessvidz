CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  raw_uri TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  normalized_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT REFERENCES sources(id),
  source_game_id TEXT,
  event TEXT,
  site TEXT,
  game_date DATE,
  result TEXT,
  eco TEXT,
  opening_name TEXT,
  white_player_id BIGINT NOT NULL REFERENCES players(id),
  black_player_id BIGINT NOT NULL REFERENCES players(id),
  total_time_seconds INTEGER,
  move_count INTEGER NOT NULL,
  moves_san_hash TEXT NOT NULL,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, source_game_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_dedupe
  ON games (moves_san_hash, white_player_id, black_player_id, COALESCE(game_date, DATE '0001-01-01'), result);

CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_player_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_player_id);
CREATE INDEX IF NOT EXISTS idx_games_source ON games(source_id);

CREATE TABLE IF NOT EXISTS game_moves (
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL,
  san TEXT NOT NULL,
  played_at_seconds INTEGER,
  PRIMARY KEY (game_id, ply)
);

CREATE INDEX IF NOT EXISTS idx_game_moves_game ON game_moves(game_id);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT REFERENCES sources(id),
  status TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
