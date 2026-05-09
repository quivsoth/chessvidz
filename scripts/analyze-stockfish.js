#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');
const { Chess } = require('chess.js');
const { Pool } = require('pg');

const DEFAULT_DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/chess_video';
const STOCKFISH_PATH = process.env.STOCKFISH_PATH || 'stockfish';
const ANALYSIS_DEPTH = Math.max(1, Number(process.env.STOCKFISH_DEPTH || 14));
const GAME_LIMIT = Math.max(1, Number(process.env.ANALYZE_GAME_LIMIT || 50));
const pool = new Pool({ connectionString: DEFAULT_DB_URL });

function normalizeTitleScore(score, sideToMove) {
  if (!score || typeof score !== 'object') return { evalCp: null, mateIn: null };
  const sign = sideToMove === 'w' ? 1 : -1;
  if (typeof score.mate === 'number' && Number.isFinite(score.mate)) {
    return {
      evalCp: null,
      mateIn: sign * Math.trunc(score.mate),
    };
  }
  if (typeof score.cp === 'number' && Number.isFinite(score.cp)) {
    return {
      evalCp: sign * Math.trunc(score.cp),
      mateIn: null,
    };
  }
  return { evalCp: null, mateIn: null };
}

function parseScoreFromInfo(line) {
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  if (mateMatch) {
    return { mate: Number(mateMatch[1]) };
  }
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  if (cpMatch) {
    return { cp: Number(cpMatch[1]) };
  }
  return null;
}

class StockfishSession {
  constructor(binaryPath, depth) {
    this.binaryPath = binaryPath;
    this.depth = depth;
    this.proc = null;
    this.rl = null;
    this.queue = [];
    this.closed = false;
  }

  async start() {
    if (this.proc) return;

    this.proc = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.proc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      const waiter = this.queue[0];
      if (waiter) {
        waiter.lines.push(trimmed);
        if (waiter.done(trimmed)) {
          this.queue.shift();
          waiter.resolve(trimmed);
        }
      }
    });

    this.proc.on('exit', (code) => {
      if (this.closed) return;
      const err = new Error(`Stockfish exited unexpectedly with code ${code}`);
      while (this.queue.length > 0) {
        const waiter = this.queue.shift();
        waiter.reject(err);
      }
    });

    await this.sendAndWait(['uci'], (line) => line === 'uciok');
    await this.sendAndWait(['isready'], (line) => line === 'readyok');
  }

  async close() {
    this.closed = true;
    if (this.proc && !this.proc.killed) {
      this.proc.stdin.write('quit\n');
      this.proc.kill();
    }
    if (this.rl) {
      this.rl.close();
    }
  }

  sendAndWait(commands, done) {
    if (!this.proc) {
      return Promise.reject(new Error('Stockfish session not started.'));
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        lines: [],
        done,
        resolve: (line) => resolve({ line, lines: [...waiter.lines] }),
        reject,
      };
      this.queue.push(waiter);
      for (const command of commands) {
        this.proc.stdin.write(`${command}\n`);
      }
    });
  }

  async analyzeFen(fen) {
    const result = await this.sendAndWait(
      ['ucinewgame', 'isready', `position fen ${fen}`, `go depth ${this.depth}`],
      (line) => line.startsWith('bestmove '),
    );

    const lines = result.lines;
    const infoLines = lines.filter((line) => line.startsWith('info '));
    const bestMoveLine = result.line || '';
    const bestMove = bestMoveLine.split(/\s+/)[1] || null;

    let score = null;
    for (let i = infoLines.length - 1; i >= 0; i--) {
      score = parseScoreFromInfo(infoLines[i]);
      if (score) break;
    }

    return {
      ...normalizeTitleScore(score, fen.split(' ')[1]),
      bestMove,
      depth: this.depth,
      engine: 'stockfish',
    };
  }
}

async function getGameMoves(client, gameId) {
  const { rows } = await client.query(
    `SELECT ply, san
     FROM game_moves
     WHERE game_id = $1
     ORDER BY ply ASC`,
    [gameId],
  );
  return rows;
}

async function getGameAnalysisState(client, gameId) {
  const { rows } = await client.query(
    `SELECT
       COUNT(*)::int AS eval_count,
       COALESCE(MAX(ply), 0)::int AS max_ply,
       MIN(depth)::int AS min_depth,
       MAX(depth)::int AS max_depth
     FROM game_evals
     WHERE game_id = $1`,
    [gameId],
  );
  const row = rows[0] || {};
  return {
    evalCount: Number(row.eval_count || 0),
    maxPly: Number(row.max_ply || 0),
    minDepth: row.min_depth == null ? null : Number(row.min_depth),
    maxDepth: row.max_depth == null ? null : Number(row.max_depth),
  };
}

async function getGamesNeedingAnalysis(client, limit) {
  const { rows } = await client.query(
    `SELECT g.id
     FROM games g
     LEFT JOIN game_evals ge ON ge.game_id = g.id
     GROUP BY g.id, g.move_count
     HAVING COUNT(ge.ply) < g.move_count
        OR MIN(ge.depth) IS DISTINCT FROM $2
        OR MAX(ge.depth) IS DISTINCT FROM $2
     ORDER BY g.id ASC
     LIMIT $1`,
    [limit, ANALYSIS_DEPTH],
  );
  return rows.map((row) => Number(row.id));
}

async function upsertEval(client, gameId, ply, fen, evalResult) {
  await client.query(
    `INSERT INTO game_evals(
       game_id, ply, fen, eval_cp, mate_in, best_move, depth, engine, analyzed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (game_id, ply) DO UPDATE
       SET fen = EXCLUDED.fen,
           eval_cp = EXCLUDED.eval_cp,
           mate_in = EXCLUDED.mate_in,
           best_move = EXCLUDED.best_move,
           depth = EXCLUDED.depth,
           engine = EXCLUDED.engine,
           analyzed_at = EXCLUDED.analyzed_at`,
    [
      gameId,
      ply,
      fen,
      evalResult.evalCp,
      evalResult.mateIn,
      evalResult.bestMove,
      evalResult.depth,
      evalResult.engine,
    ],
  );
}

async function analyzeGame(client, gameId) {
  const moves = await getGameMoves(client, gameId);
  if (moves.length === 0) {
    console.log(`Skipping game ${gameId}: no moves found.`);
    return { analyzed: 0 };
  }

  const analysisState = await getGameAnalysisState(client, gameId);
  const sameDepth =
    analysisState.evalCount > 0 &&
    analysisState.minDepth === ANALYSIS_DEPTH &&
    analysisState.maxDepth === ANALYSIS_DEPTH;

  if (sameDepth && analysisState.evalCount >= moves.length) {
    console.log(`Skipping game ${gameId}: already analyzed at depth ${ANALYSIS_DEPTH}.`);
    return { analyzed: 0 };
  }

  let startPly = 0;
  if (sameDepth) {
    startPly = analysisState.maxPly;
  } else if (analysisState.evalCount > 0) {
    await client.query('DELETE FROM game_evals WHERE game_id = $1', [gameId]);
    console.log(`Recomputing game ${gameId} at depth ${ANALYSIS_DEPTH}.`);
  }

  const chess = new Chess();
  for (let i = 0; i < startPly; i++) {
    const move = chess.move(moves[i].san, { sloppy: true });
    if (!move) {
      throw new Error(`Illegal move while replaying game ${gameId} at ply ${moves[i].ply}: ${moves[i].san}`);
    }
  }

  const session = new StockfishSession(STOCKFISH_PATH, ANALYSIS_DEPTH);
  await session.start();

  let analyzed = 0;
  try {
    for (let i = startPly; i < moves.length; i++) {
      const moveRow = moves[i];
      const move = chess.move(moveRow.san, { sloppy: true });
      if (!move) {
        throw new Error(`Illegal move at game ${gameId} ply ${moveRow.ply}: ${moveRow.san}`);
      }

      const fen = chess.fen();
      const evalResult = await session.analyzeFen(fen);
      await upsertEval(client, gameId, moveRow.ply, fen, evalResult);
      analyzed++;
    }
  } finally {
    await session.close();
  }

  return { analyzed };
}

async function main() {
  const client = await pool.connect();
  try {
    const gameIds = await getGamesNeedingAnalysis(client, GAME_LIMIT);
    if (gameIds.length === 0) {
      console.log('No games need analysis.');
      return;
    }

    console.log(`Analyzing ${gameIds.length} game(s) at depth ${ANALYSIS_DEPTH} using ${STOCKFISH_PATH}`);

    let totalAnalyzed = 0;
    for (const gameId of gameIds) {
    console.log(`Analyzing game ${gameId} ...`);
      const result = await analyzeGame(client, gameId);
      totalAnalyzed += result.analyzed;
      console.log(`Finished game ${gameId}: ${result.analyzed} ply evaluations stored at depth ${ANALYSIS_DEPTH}.`);
    }

    console.log(`Done. Stored ${totalAnalyzed} eval rows.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
