CREATE TABLE IF NOT EXISTS game_evals (
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL,
  fen TEXT NOT NULL,
  eval_cp INTEGER,
  mate_in INTEGER,
  best_move TEXT,
  depth INTEGER NOT NULL,
  engine TEXT NOT NULL DEFAULT 'stockfish',
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, ply)
);

CREATE INDEX IF NOT EXISTS idx_game_evals_game ON game_evals(game_id);
