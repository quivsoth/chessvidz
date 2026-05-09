#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const { Pool } = require('pg');

// ── Config ────────────────────────────────────────────────────────────────────
const DEFAULT_DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/chess_video';
const pool = new Pool({ connectionString: DEFAULT_DB_URL });
const RATE_LIMIT_DELAY = 600; // ms between requests to avoid 429 errors
const RANKS_DIR = path.join(__dirname, '..', 'sources', 'titled-tuesday-data', 'ranks');
const KNOWN_TITLES = new Set(['GM', 'IM', 'FM', 'NM', 'WGM', 'WIM', 'WFM', 'CM', 'WCM']);

// Recent Titled Tuesday tournaments from 2026
const TOURNAMENT_IDS = [
  'titled-tuesday-blitz-may-05-2026-6412037',
  'titled-tuesday-blitz-april-28-2026-6391967',
  'titled-tuesday-blitz-april-21-2026-6371729',
  'titled-tuesday-blitz-april-14-2026-6362193',
  'titled-tuesday-blitz-april-07-2026-6342683',
  'titled-tuesday-blitz-march-31-2026-6322539',
  'titled-tuesday-blitz-march-24-2026-6292855',
  'titled-tuesday-blitz-march-17-2026-6282783',
  'titled-tuesday-blitz-march-10-2026-6277141',
  'titled-tuesday-blitz-march-03-2026-6262447',
  'titled-tuesday-blitz-february-24-2026-6256793',
  'titled-tuesday-blitz-february-17-2026-6221393',
  'titled-tuesday-blitz-february-10-2026-6221327',
  'titled-tuesday-blitz-february-03-2026-6190821',
  'titled-tuesday-blitz-january-27-2026-6170439',
  'titled-tuesday-blitz-january-20-2026-6160609',
  'titled-tuesday-blitz-january-13-2026-6151065',
  'titled-tuesday-blitz-january-06-2026-6140433',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildTitleLookup() {
  const titleByUsername = new Map();
  if (!fs.existsSync(RANKS_DIR)) return titleByUsername;

  for (const file of fs.readdirSync(RANKS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const fullPath = path.join(RANKS_DIR, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (err) {
      console.warn(`Skipping ${file}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      const username = normalizeName(entry && entry.username);
      const title = entry && entry.title;
      if (!username || !KNOWN_TITLES.has(title) || titleByUsername.has(username)) continue;
      titleByUsername.set(username, title);
    }
  }

  return titleByUsername;
}

const TITLE_BY_USERNAME = buildTitleLookup();

function getPlayerTitle(username) {
  return TITLE_BY_USERNAME.get(normalizeName(username)) || null;
}

function parseDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(raw)) return raw.replace(/\./g, '-');
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

function parsePgnHeaders(pgnText) {
  const headers = {};
  const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = headerRegex.exec(pgnText)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}

function parseClockTime(clkString) {
  // Parse "0:04:59.9" format to seconds
  const match = clkString.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseFloat(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

function parsePgnMovesWithTiming(pgnText, initialTimeSeconds = 300) {
  const moveTextMatch = pgnText.match(/\n\n(.+)$/s);
  if (!moveTextMatch) return [];

  const moveText = moveTextMatch[1];

  // Extract move+clock pairs using regex
  const pattern = /(\S+)\s+\{?\[%clk\s+([^\]]+)\]\}?/g;
  const chess = new Chess();
  const moves = [];
  let match;

  // Track time for both players
  let whiteTimeRemaining = initialTimeSeconds;
  let blackTimeRemaining = initialTimeSeconds;
  let cumulativeTime = 0;

  while ((match = pattern.exec(moveText)) !== null) {
    const san = match[1];
    const clkTime = match[2];

    // Skip move numbers like "1." or "1..."
    if (/^\d+\.+$/.test(san)) continue;

    const chessMove = chess.move(san, { sloppy: true });
    if (!chessMove) continue;

    const remainingSeconds = parseClockTime(clkTime);
    if (remainingSeconds === null) {
      moves.push({ san: chessMove.san, playedAtSeconds: null });
      continue;
    }

    // Calculate time used for this move
    const isWhite = moves.length % 2 === 0;
    const timeUsed = isWhite
      ? whiteTimeRemaining - remainingSeconds
      : blackTimeRemaining - remainingSeconds;

    // Update remaining time
    if (isWhite) {
      whiteTimeRemaining = remainingSeconds;
    } else {
      blackTimeRemaining = remainingSeconds;
    }

    // Add to cumulative time
    cumulativeTime += Math.max(0, timeUsed);

    moves.push({
      san: chessMove.san,
      playedAtSeconds: Math.round(cumulativeTime)
    });
  }

  return moves;
}

function parseChesscomGame(gameData, tournamentName) {
  const pgnText = gameData.pgn;
  if (!pgnText) return null;

  const headers = parsePgnHeaders(pgnText);

  // Parse time control (e.g., "300" = 5 minutes)
  const timeControl = parseInt(gameData.time_control || '300');
  const initialTimeSeconds = timeControl || 180;

  // Parse moves with real timestamps from PGN clock annotations
  const moves = parsePgnMovesWithTiming(pgnText, initialTimeSeconds);

  if (moves.length === 0) return null;

  // Check if we got real timestamps
  const hasRealTiming = moves.some(m => m.playedAtSeconds !== null);

  // Fall back to estimation only if no clock data available
  if (!hasRealTiming) {
    const perMove = initialTimeSeconds / moves.length;
    let elapsed = 0;
    for (const move of moves) {
      elapsed += perMove;
      move.playedAtSeconds = Math.round(elapsed);
    }
  }

  // Always use the actual time control, not the max elapsed time
  const estimatedTotal = initialTimeSeconds;

  const gameUrl = gameData.url || '';
  const gameId = gameUrl.split('/').pop() || `${headers.White}-${headers.Black}-${headers.Date}`;
  const whiteTitle = getPlayerTitle(gameData.white?.username || headers.White);
  const blackTitle = getPlayerTitle(gameData.black?.username || headers.Black);

  return {
    source: {
      provider: 'chesscom-titled-tuesday',
      sourceKey: `titled-tuesday:${gameId}`,
      rawUri: gameUrl,
      metadata: {
        tournament: tournamentName,
        timeControl: gameData.time_control,
      },
    },
    whitePlayer: gameData.white?.username || headers.White || 'Unknown',
    blackPlayer: gameData.black?.username || headers.Black || 'Unknown',
    whiteTitle,
    blackTitle,
    game: {
      sourceGameId: gameId,
      event: headers.Event || tournamentName,
      site: 'chess.com',
      gameDate: parseDate(headers.Date || headers.UTCDate),
      result: headers.Result || '*',
      eco: gameData.eco || headers.ECO || null,
      openingName: headers.Opening || null,
      totalTimeSeconds: estimatedTotal,
      moveCount: moves.length,
      movesSanHash: crypto.createHash('sha256').update(moves.map((m) => m.san).join(' ')).digest('hex'),
      headers,
      metadata: {
        estimatedTiming: !hasRealTiming,
        whiteRating: gameData.white?.rating || null,
        blackRating: gameData.black?.rating || null,
        rated: gameData.rated || false,
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

async function upsertPlayer(client, displayName, title = null) {
  const normalizedName = normalizeName(displayName);
  const { rows } = await client.query(
    `INSERT INTO players(normalized_name, display_name, title)
     VALUES ($1, $2, $3)
     ON CONFLICT (normalized_name) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           title = COALESCE(EXCLUDED.title, players.title)
     RETURNING id`,
    [normalizedName, displayName, title],
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

async function ingestGame(parsed) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceId = await upsertSource(client, parsed.source);
        const whiteId = await upsertPlayer(client, parsed.whitePlayer, parsed.whiteTitle || null);
        const blackId = await upsertPlayer(client, parsed.blackPlayer, parsed.blackTitle || null);
    await upsertGameAndMoves(client, parsed, sourceId, whiteId, blackId);
    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === '23505') {
      return { success: false, duplicate: true };
    }
    throw err;
  } finally {
    client.release();
  }
}

async function fetchJson(url) {
  await sleep(RATE_LIMIT_DELAY);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return await response.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🏆 Chess.com Titled Tuesday Fetcher\n');

  const args = process.argv.slice(2);
  const maxGamesPerTournament = args[0] ? parseInt(args[0]) : 50;

  console.log(`Settings:`);
  console.log(`  - Max games per tournament: ${maxGamesPerTournament}`);
  console.log(`  - Rate limit delay: ${RATE_LIMIT_DELAY}ms`);
  console.log(`  - Tournaments to process: ${TOURNAMENT_IDS.length}\n`);

  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const tournamentId of TOURNAMENT_IDS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 Tournament: ${tournamentId}`);
    console.log('='.repeat(60));

    try {
      // Step 1: Fetch round to get groups
      const roundUrl = `https://api.chess.com/pub/tournament/${tournamentId}/1`;
      console.log(`  Fetching round: ${roundUrl}`);
      const roundData = await fetchJson(roundUrl);

      if (!roundData.groups || roundData.groups.length === 0) {
        console.log('  ⚠️  No groups found in round 1');
        continue;
      }

      // Step 2: Fetch first group to get games
      const groupUrl = roundData.groups[0];
      console.log(`  Fetching group: ${groupUrl}`);
      const groupData = await fetchJson(groupUrl);

      if (!groupData.games || groupData.games.length === 0) {
        console.log('  ⚠️  No games found in group');
        continue;
      }

      const gamesToFetch = Math.min(maxGamesPerTournament, groupData.games.length);
      console.log(`  Found ${groupData.games.length} games, processing first ${gamesToFetch}...\n`);

      let imported = 0;
      let skipped = 0;
      let errors = 0;

      for (let i = 0; i < gamesToFetch; i++) {
        const gameData = groupData.games[i];

        try {
          const parsed = parseChesscomGame(gameData, tournamentId);

          if (!parsed) {
            errors++;
            continue;
          }

          const result = await ingestGame(parsed);

          if (result.success) {
            imported++;
            if (imported % 10 === 0) {
              console.log(`  ✅ Progress: ${imported}/${gamesToFetch} games imported`);
            }
          } else if (result.duplicate) {
            skipped++;
          }
        } catch (err) {
          console.error(`  ❌ Game ${i + 1}: ${err.message}`);
          errors++;
        }
      }

      console.log(`\n  📊 Tournament Summary:`);
      console.log(`     Imported: ${imported}`);
      console.log(`     Skipped:  ${skipped} (duplicates)`);
      console.log(`     Errors:   ${errors}`);

      totalImported += imported;
      totalSkipped += skipped;
      totalErrors += errors;

    } catch (err) {
      console.error(`  ❌ Failed to process tournament: ${err.message}`);
      totalErrors++;
    }
  }

  console.log('\n' + '━'.repeat(60));
  console.log('📊 FINAL SUMMARY');
  console.log('━'.repeat(60));
  console.log(`Tournaments processed: ${TOURNAMENT_IDS.length}`);
  console.log(`Games imported:        ${totalImported}`);
  console.log(`Games skipped:         ${totalSkipped} (duplicates)`);
  console.log(`Errors:                ${totalErrors}`);
  console.log('━'.repeat(60));

  await pool.end();
  console.log('\n✅ Done!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
