#!/usr/bin/env node

const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { Chess } = require('chess.js');
const { Pool } = require('pg');
const swaggerUi = require('swagger-ui-express');

const PORT = Number(process.env.PORT || 3001);
const DEFAULT_DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/chess_video';
const pool = new Pool({ connectionString: DEFAULT_DB_URL });
const app = express();

app.use(express.json({ limit: '10mb' }));

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Chess Video API',
    version: '1.0.0',
    description: 'Ingest chess games into Postgres and render stored games to video.',
  },
  servers: [
    {
      url: `http://localhost:${PORT}`,
      description: 'Local development server',
    },
  ],
  tags: [
    { name: 'System' },
    { name: 'Games' },
    { name: 'Ingestion' },
    { name: 'Rendering' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Check API and database health',
        responses: {
          200: {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
          500: {
            description: 'Health check failed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/games': {
      get: {
        tags: ['Games'],
        summary: 'List games from Postgres',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of games to return',
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
          },
          {
            name: 'offset',
            in: 'query',
            description: 'Number of games to skip',
            schema: { type: 'integer', minimum: 0, default: 0 },
          },
          {
            name: 'q',
            in: 'query',
            description: 'Search player names or event text',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Game list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GamesListResponse' },
              },
            },
          },
        },
      },
    },
    '/ingest/lichess': {
      post: {
        tags: ['Ingestion'],
        summary: 'Ingest games directly from the Lichess API',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/IngestLichessRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Ingestion summary',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IngestResponse' },
              },
            },
          },
          400: {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          502: {
            description: 'Upstream API failure',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/ingest/pgn': {
      post: {
        tags: ['Ingestion'],
        summary: 'Ingest games from a local PGN file',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/IngestPgnRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Ingestion summary',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IngestResponse' },
              },
            },
          },
          400: {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          404: {
            description: 'PGN file not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/render/game/{id}': {
      post: {
        tags: ['Rendering'],
        summary: 'Render a stored game to MP4',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Database game id',
            schema: { type: 'integer', minimum: 1 },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RenderGameRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Render finished successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RenderGameResponse' },
              },
            },
          },
          400: {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          500: {
            description: 'Render failed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RenderFailureResponse' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      HealthResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
        },
        required: ['ok'],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
        required: ['error'],
      },
      GameListItem: {
        type: 'object',
        properties: {
          id: { type: 'integer', format: 'int64' },
          white: { type: 'string' },
          black: { type: 'string' },
          event: { type: 'string', nullable: true },
          game_date: { type: 'string', format: 'date', nullable: true },
          result: { type: 'string', nullable: true },
          move_count: { type: 'integer' },
        },
        required: ['id', 'white', 'black', 'move_count'],
      },
      GamesListResponse: {
        type: 'object',
        properties: {
          games: {
            type: 'array',
            items: { $ref: '#/components/schemas/GameListItem' },
          },
        },
        required: ['games'],
      },
      IngestLichessRequest: {
        type: 'object',
        properties: {
          username: { type: 'string', example: 'MagnusCarlsen' },
          max: { type: 'integer', minimum: 1, maximum: 200, example: 20 },
          perf: {
            type: 'string',
            example: 'blitz',
            description: 'Use "all" or a Lichess perf type such as blitz or rapid.',
          },
        },
        required: ['username'],
      },
      IngestPgnRequest: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            example: '/absolute/path/to/games.pgn',
          },
          maxGames: { type: 'integer', minimum: 1, maximum: 1000, example: 100 },
        },
        required: ['filePath'],
      },
      IngestResponse: {
        type: 'object',
        properties: {
          source: { type: 'string', example: 'lichess' },
          username: { type: 'string', nullable: true },
          filePath: { type: 'string', nullable: true },
          fetched: { type: 'integer', nullable: true },
          parsed: { type: 'integer', nullable: true },
          imported: { type: 'integer' },
          skipped: { type: 'integer' },
          errors: { type: 'integer' },
        },
        required: ['imported', 'skipped', 'errors'],
      },
      RenderGameRequest: {
        type: 'object',
        properties: {
          output: {
            type: 'string',
            example: 'my-video.mp4',
            description: 'Output filename placed under the local output/ directory.',
          },
        },
      },
      RenderGameResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          gameId: { type: 'integer', format: 'int64' },
          output: { type: 'string' },
          logs: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['ok', 'gameId', 'output', 'logs'],
      },
      RenderFailureResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          exitCode: { type: 'integer', nullable: true },
          details: { type: 'string', nullable: true },
        },
        required: ['error'],
      },
    },
  },
};

app.get('/openapi.json', (_req, res) => {
  res.json(openApiSpec);
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  explorer: true,
  swaggerOptions: {
    docExpansion: 'list',
    persistAuthorization: false,
  },
}));

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(raw) && !raw.includes('??')) return raw.replace(/\./g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

function cleanMoveText(text) {
  return text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/1-0|0-1|1\/2-1\/2|\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePgnGames(rawPgn, maxGames = 50) {
  const chunks = rawPgn.split(/\n(?=\[Event\s")/g).map((chunk) => chunk.trim()).filter(Boolean);
  const parsedGames = [];

  for (const chunk of chunks) {
    if (parsedGames.length >= maxGames) break;
    const lines = chunk.split('\n');
    const headerLines = [];
    const moveLines = [];
    let inMoves = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line && !inMoves) continue;
      if (line.startsWith('[') && !inMoves) {
        headerLines.push(line);
        continue;
      }
      inMoves = true;
      if (line) moveLines.push(line);
    }

    const headers = {};
    for (const line of headerLines) {
      const match = line.match(/^\[(\w+)\s+"(.*)"\]$/);
      if (match) headers[match[1]] = match[2];
    }

    const cleaned = cleanMoveText(moveLines.join(' '));
    if (!cleaned) continue;
    const tokens = cleaned.split(' ').map((token) => token.trim()).filter(Boolean);

    const chess = new Chess();
    const moves = [];
    let ok = true;
    for (const token of tokens) {
      const move = chess.move(token, { sloppy: true });
      if (!move) {
        ok = false;
        break;
      }
      moves.push({ san: move.san, playedAtSeconds: null });
    }
    if (!ok || moves.length === 0) continue;

    const estimatedTotal = Math.max(120, Math.round(moves.length * 5.5));
    const perMove = estimatedTotal / moves.length;
    let elapsed = 0;
    for (const move of moves) {
      elapsed += perMove;
      move.playedAtSeconds = Math.round(elapsed);
    }

    parsedGames.push({
      source: {
        provider: 'historical-pgn',
        sourceKey: `historical-pgn:${headers.Event || 'event'}:${headers.Date || 'date'}:${headers.White || 'white'}:${headers.Black || 'black'}`,
        rawUri: null,
        metadata: {
          sourceType: 'pgn',
        },
      },
      whitePlayer: headers.White || 'Unknown White',
      blackPlayer: headers.Black || 'Unknown Black',
      game: {
        sourceGameId: headers.GameId || null,
        event: headers.Event || null,
        site: headers.Site || null,
        gameDate: parseDate(headers.Date),
        result: headers.Result || null,
        eco: headers.ECO || null,
        openingName: headers.Opening || null,
        totalTimeSeconds: estimatedTotal,
        moveCount: moves.length,
        movesSanHash: crypto.createHash('sha256').update(moves.map((m) => m.san).join(' ')).digest('hex'),
        headers,
        metadata: {
          estimatedTiming: true,
        },
      },
      moves,
    });
  }

  return parsedGames;
}

function gameFromLichess(rawGame) {
  const movesSan = String(rawGame.moves || '').trim().split(/\s+/).filter(Boolean);
  if (movesSan.length === 0) return null;
  const total = rawGame.clock?.totalTime || rawGame.clock?.initial || Math.max(60, movesSan.length * 6);
  const perMove = total / movesSan.length;
  let elapsed = 0;
  const moves = movesSan.map((san) => {
    elapsed += perMove;
    return { san, playedAtSeconds: Math.round(elapsed) };
  });

  const whiteName = rawGame.players?.white?.user?.name || 'White';
  const blackName = rawGame.players?.black?.user?.name || 'Black';
  const sourceGameId = rawGame.id || null;
  return {
    source: {
      provider: 'lichess',
      sourceKey: `lichess:${sourceGameId}`,
      rawUri: sourceGameId ? `https://lichess.org/${sourceGameId}` : null,
      metadata: {
        speed: rawGame.speed || null,
        perf: rawGame.perf || null,
        rated: !!rawGame.rated,
      },
    },
    whitePlayer: whiteName,
    blackPlayer: blackName,
    game: {
      sourceGameId,
      event: rawGame.tournament || 'Lichess game',
      site: 'lichess.org',
      gameDate: rawGame.createdAt ? new Date(rawGame.createdAt).toISOString().slice(0, 10) : null,
      result: rawGame.winner === 'white' ? '1-0' : rawGame.winner === 'black' ? '0-1' : '1/2-1/2',
      eco: rawGame.opening?.eco || null,
      openingName: rawGame.opening?.name || null,
      totalTimeSeconds: Math.round(total),
      moveCount: moves.length,
      movesSanHash: crypto.createHash('sha256').update(moves.map((m) => m.san).join(' ')).digest('hex'),
      headers: {},
      metadata: {
        speed: rawGame.speed || null,
        perf: rawGame.perf || null,
      },
    },
    moves,
  };
}

async function upsertSource(client, source) {
  const { rows } = await client.query(
    `INSERT INTO sources(provider, source_key, raw_uri, metadata)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_key) DO UPDATE
       SET raw_uri = EXCLUDED.raw_uri,
           metadata = EXCLUDED.metadata
     RETURNING id`,
    [source.provider, source.sourceKey, source.rawUri, source.metadata || {}],
  );
  return rows[0].id;
}

async function upsertPlayer(client, displayName) {
  const normalizedName = normalizeName(displayName);
  const { rows } = await client.query(
    `INSERT INTO players(normalized_name, display_name)
     VALUES ($1, $2)
     ON CONFLICT (normalized_name) DO UPDATE
       SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [normalizedName, displayName],
  );
  return rows[0].id;
}

async function upsertGameAndMoves(client, parsed, sourceId, whiteId, blackId) {
  const g = parsed.game;
  const { rows } = await client.query(
    `INSERT INTO games(
      source_id, source_game_id, event, site, game_date, result, eco, opening_name,
      white_player_id, black_player_id, total_time_seconds, move_count, moves_san_hash, headers, metadata
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15
    )
    ON CONFLICT (source_id, source_game_id) DO UPDATE
      SET event = EXCLUDED.event,
          site = EXCLUDED.site,
          game_date = EXCLUDED.game_date,
          result = EXCLUDED.result,
          eco = EXCLUDED.eco,
          opening_name = EXCLUDED.opening_name,
          white_player_id = EXCLUDED.white_player_id,
          black_player_id = EXCLUDED.black_player_id,
          total_time_seconds = EXCLUDED.total_time_seconds,
          move_count = EXCLUDED.move_count,
          moves_san_hash = EXCLUDED.moves_san_hash,
          headers = EXCLUDED.headers,
          metadata = EXCLUDED.metadata
    RETURNING id`,
    [
      sourceId, g.sourceGameId, g.event, g.site, g.gameDate, g.result, g.eco, g.openingName,
      whiteId, blackId, g.totalTimeSeconds, g.moveCount, g.movesSanHash, g.headers || {}, g.metadata || {},
    ],
  );
  const gameId = rows[0].id;
  await client.query('DELETE FROM game_moves WHERE game_id = $1', [gameId]);
  for (let i = 0; i < parsed.moves.length; i++) {
    const move = parsed.moves[i];
    await client.query(
      `INSERT INTO game_moves(game_id, ply, san, played_at_seconds)
       VALUES ($1, $2, $3, $4)`,
      [gameId, i + 1, move.san, move.playedAtSeconds ?? null],
    );
  }
  return gameId;
}

async function ingestParsedGames(parsedGames, runSourceKey) {
  const client = await pool.connect();
  let runId = null;
  let imported = 0;
  let errors = 0;
  let skipped = 0;
  try {
    await client.query('BEGIN');
    const batchSourceId = await upsertSource(client, {
      provider: 'api-ingest',
      sourceKey: runSourceKey,
      rawUri: null,
      metadata: {},
    });
    const run = await client.query(
      `INSERT INTO ingest_runs(source_id, status) VALUES ($1, 'running') RETURNING id`,
      [batchSourceId],
    );
    runId = run.rows[0].id;
    await client.query('COMMIT');

    for (const parsed of parsedGames) {
      try {
        await client.query('BEGIN');
        const sourceId = await upsertSource(client, parsed.source);
        const whiteId = await upsertPlayer(client, parsed.whitePlayer);
        const blackId = await upsertPlayer(client, parsed.blackPlayer);
        await upsertGameAndMoves(client, parsed, sourceId, whiteId, blackId);
        await client.query('COMMIT');
        imported++;
      } catch (err) {
        await client.query('ROLLBACK');
        if (err && err.code === '23505') {
          skipped++;
        } else {
          errors++;
        }
      }
    }

    if (runId) {
      await client.query(
        `UPDATE ingest_runs
         SET status = $2, imported_count = $3, skipped_count = $4, error_count = $5, finished_at = NOW()
         WHERE id = $1`,
        [runId, errors ? 'completed_with_errors' : 'completed', imported, skipped, errors],
      );
    }
  } finally {
    client.release();
  }
  return { imported, skipped, errors };
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/games', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 20)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const q = String(req.query.q || '').trim();

  const params = [];
  let where = '';
  if (q) {
    params.push(`%${q}%`);
    where = `WHERE wp.display_name ILIKE $${params.length} OR bp.display_name ILIKE $${params.length} OR g.event ILIKE $${params.length}`;
  }
  params.push(limit, offset);

  const sql = `
    SELECT
      g.id,
      wp.display_name AS white,
      bp.display_name AS black,
      g.event,
      g.game_date,
      g.result,
      g.move_count
    FROM games g
    JOIN players wp ON wp.id = g.white_player_id
    JOIN players bp ON bp.id = g.black_player_id
    ${where}
    ORDER BY g.id DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;
  const { rows } = await pool.query(sql, params);
  res.json({ games: rows });
});

app.post('/ingest/lichess', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    if (!username) return res.status(400).json({ error: 'username is required' });
    const max = Math.max(1, Math.min(200, Number(req.body.max || 20)));
    const perfArg = String(req.body.perf || 'all');
    const perfType = perfArg === 'all' ? '' : `&perfType=${encodeURIComponent(perfArg)}`;

    const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${max}&moves=true&pgnInJson=true&opening=true${perfType}`;
    const response = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
    if (!response.ok) {
      return res.status(502).json({ error: `Lichess API failed (${response.status})` });
    }

    const body = await response.text();
    const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
    const parsedGames = lines
      .map((line) => JSON.parse(line))
      .map(gameFromLichess)
      .filter(Boolean);

    const result = await ingestParsedGames(parsedGames, `api-lichess:${username}:${Date.now()}`);
    return res.json({ source: 'lichess', username, fetched: parsedGames.length, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/ingest/pgn', async (req, res) => {
  try {
    const filePath = String(req.body.filePath || '').trim();
    if (!filePath) return res.status(400).json({ error: 'filePath is required' });

    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: `PGN file not found: ${resolved}` });
    const maxGames = Math.max(1, Math.min(1000, Number(req.body.maxGames || 100)));

    const rawPgn = fs.readFileSync(resolved, 'utf8');
    const parsedGames = parsePgnGames(rawPgn, maxGames);
    const sourceTag = `api-pgn:${path.basename(resolved)}:${Date.now()}`;
    const result = await ingestParsedGames(parsedGames, sourceTag);
    return res.json({ source: 'pgn', filePath: resolved, parsed: parsedGames.length, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/render/game/:id', async (req, res) => {
  const gameId = Number(req.params.id);
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return res.status(400).json({ error: 'Invalid game id' });
  }

  const outputNameInput = String(req.body.output || `db-game-${gameId}.mp4`).trim();
  const outputName = path.basename(outputNameInput);
  const outputPath = path.join(process.cwd(), 'output', outputName);

  const child = spawn(
    process.execPath,
    ['index.js', '--game-id', String(gameId), outputName],
    { cwd: path.join(__dirname, '..') },
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  child.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({
        error: 'Render failed',
        exitCode: code,
        details: stderr || stdout,
      });
    }
    return res.json({
      ok: true,
      gameId,
      output: outputPath,
      logs: stdout.split('\n').filter(Boolean).slice(-8),
    });
  });

  return undefined;
});

app.listen(PORT, () => {
  console.log(`Chess ingest API listening on http://localhost:${PORT}`);
});
