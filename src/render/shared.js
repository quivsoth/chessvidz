const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const { loadImage } = require('@napi-rs/canvas');

const SQUARE_SIZE = 80;
const BOARD_SIZE = SQUARE_SIZE * 8;
const PADDING = 40;
const EVAL_BAR_WIDTH = 40;
const CANVAS_SIZE = BOARD_SIZE + PADDING * 2 + EVAL_BAR_WIDTH;

const VIDEO_FPS = 24;
const TWEEN_FRAMES = 16;
const HOLD_FRAMES = 18;
const INTRO_FRAMES = 36;
const PLAYER_NAME_BAR_HEIGHT = Math.round(PADDING * 0.6);
const BOARD_FRAME_OUTER_PADDING = Math.round(PADDING * 0.22);
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');

const COLORS = {
  light: '#f0d9b5',
  dark: '#b58863',
  lastMoveLight: 'rgba(205, 210, 106, 0.75)',
  lastMoveDark: 'rgba(170, 162, 58, 0.75)',
  frameOuter: '#3b2616',
  frameInner: '#8b5a2b',
  coordText: '#e8d7bf',
  background: '#1d120d',
};

const PIECE_SYMBOLS = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

const STAUNTON_PIECE_URLS = {
  wK: 'https://chessboardjs.com/img/chesspieces/wikipedia/wK.png',
  wQ: 'https://chessboardjs.com/img/chesspieces/wikipedia/wQ.png',
  wR: 'https://chessboardjs.com/img/chesspieces/wikipedia/wR.png',
  wB: 'https://chessboardjs.com/img/chesspieces/wikipedia/wB.png',
  wN: 'https://chessboardjs.com/img/chesspieces/wikipedia/wN.png',
  wP: 'https://chessboardjs.com/img/chesspieces/wikipedia/wP.png',
  bK: 'https://chessboardjs.com/img/chesspieces/wikipedia/bK.png',
  bQ: 'https://chessboardjs.com/img/chesspieces/wikipedia/bQ.png',
  bR: 'https://chessboardjs.com/img/chesspieces/wikipedia/bR.png',
  bB: 'https://chessboardjs.com/img/chesspieces/wikipedia/bB.png',
  bN: 'https://chessboardjs.com/img/chesspieces/wikipedia/bN.png',
  bP: 'https://chessboardjs.com/img/chesspieces/wikipedia/bP.png',
};

const PIECE_IMAGES = new Map();
let pieceSetLoaded = false;

function squareToPixel(square) {
  const col = square.charCodeAt(0) - 97;
  const row = 8 - parseInt(square[1], 10);
  return {
    x: PADDING + col * SQUARE_SIZE + SQUARE_SIZE / 2,
    y: PADDING + row * SQUARE_SIZE + SQUARE_SIZE / 2,
  };
}

function colRowFromSquare(square) {
  return {
    col: square.charCodeAt(0) - 97,
    row: 8 - parseInt(square[1], 10),
  };
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function parseSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const chunks = trimmed.split(':').map((chunk) => Number(chunk));
  if (chunks.some((chunk) => !Number.isFinite(chunk) || chunk < 0)) return null;
  if (chunks.length === 2) return chunks[0] * 60 + chunks[1];
  if (chunks.length === 3) return chunks[0] * 3600 + chunks[1] * 60 + chunks[2];
  return null;
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function framePlanFromMoveSeconds(moveSeconds) {
  const sec = Math.max(0.2, moveSeconds);
  const totalFrames = Math.max(8, Math.round(sec * VIDEO_FPS));
  const tweenFrames = Math.max(6, Math.min(20, Math.round(totalFrames * 0.45)));
  const holdFrames = Math.max(2, totalFrames - tweenFrames);
  return { tweenFrames, holdFrames };
}

function getSoundForMove(move, isCheck) {
  if (move.flags && move.flags.includes('p')) {
    return 'promote.mp3';
  }
  if (move.captured || (move.flags && move.flags.includes('e'))) {
    return 'capture.mp3';
  }
  if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) {
    return 'castle.mp3';
  }
  if (isCheck) {
    return 'move-check.mp3';
  }
  return move.color === 'w' ? 'move-self.mp3' : 'move-opponent.mp3';
}

async function preloadStauntonPieces() {
  if (pieceSetLoaded) return;

  await Promise.all(Object.entries(STAUNTON_PIECE_URLS).map(async ([key, url]) => {
    try {
      PIECE_IMAGES.set(key, await loadImage(url));
    } catch (err) {
      console.warn(`Could not load piece image ${key}: ${err.message}`);
      PIECE_IMAGES.set(key, null);
    }
  }));

  pieceSetLoaded = true;
  if ([...PIECE_IMAGES.values()].every((img) => !img)) {
    console.warn('No Staunton images loaded; using Unicode fallback pieces.');
  }
}

function readInputText(input) {
  if (fs.existsSync(input) && fs.statSync(input).isFile()) {
    return fs.readFileSync(input, 'utf8');
  }
  return input;
}

function parseCoordinateTokens(input) {
  const rawTokens = input
    .replace(/\r/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const moves = [];
  for (const token of rawTokens) {
    const cleaned = token.replace(/[,.!?;:]/g, '').toLowerCase();
    if (!cleaned) continue;
    if (/^\d+$/.test(cleaned)) continue;
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(cleaned)) return null;
    moves.push(cleaned);
  }

  return moves.length > 0 ? moves : null;
}

function buildHistoryFromInput(inputText) {
  const coordinateTokens = parseCoordinateTokens(inputText);
  if (coordinateTokens) {
    const chess = new Chess();
    const history = [];
    coordinateTokens.forEach((token, idx) => {
      const move = chess.move({
        from: token.slice(0, 2),
        to: token.slice(2, 4),
        promotion: token[4],
      });
      if (!move) {
        throw new Error(`Invalid coordinate move at #${idx + 1}: "${token}"`);
      }
      history.push(move);
    });
    return { history, inputType: 'coordinates' };
  }

  const chess = new Chess();
  let loaded;
  try {
    loaded = chess.loadPgn(inputText);
  } catch (err) {
    throw new Error(`Invalid PGN input: ${err.message}`);
  }
  if (loaded === false) {
    throw new Error('Invalid PGN input.');
  }
  return { history: chess.history({ verbose: true }), inputType: 'pgn' };
}

function extractTitleAndName(name) {
  const match = String(name || '').match(/^(GM|IM|FM|WGM|WIM|WFM|NM|CM|WCM)\s+(.+)$/);
  return {
    title: match ? match[1] : null,
    displayName: match ? match[2] : String(name || ''),
  };
}

function parseHistoricalGame(jsonData, sourceName) {
  if (!jsonData || typeof jsonData !== 'object') {
    throw new Error(`Invalid JSON in ${sourceName}: expected an object.`);
  }

  const whiteName = jsonData.whitePlayer || jsonData.white || jsonData.players?.white;
  const blackName = jsonData.blackPlayer || jsonData.black || jsonData.players?.black;
  if (!whiteName || !blackName) {
    throw new Error(`Invalid JSON in ${sourceName}: missing white/black player names.`);
  }

  if (!Array.isArray(jsonData.moves) || jsonData.moves.length === 0) {
    throw new Error(`Invalid JSON in ${sourceName}: "moves" must be a non-empty array.`);
  }

  const explicitTotalSeconds = parseSeconds(
    jsonData.totalTimeSeconds ?? jsonData.totalTime ?? jsonData.totalGameTime,
  );
  if ((jsonData.totalTimeSeconds ?? jsonData.totalTime ?? jsonData.totalGameTime) != null && explicitTotalSeconds == null) {
    throw new Error(`Invalid total time in ${sourceName}. Use seconds, MM:SS, or HH:MM:SS.`);
  }

  const chess = new Chess();
  const history = [];
  const moveTimestamps = [];
  let seenTimestamp = false;
  let previousTimestamp = 0;

  jsonData.moves.forEach((entry, idx) => {
    const rawMove = typeof entry === 'string'
      ? entry
      : (entry.move || entry.uci || entry.coordinate || entry.san || '');
    const moveText = String(rawMove).trim();
    if (!moveText) {
      throw new Error(`Missing move text in ${sourceName} at #${idx + 1}.`);
    }

    const explicitSan = typeof entry === 'object' && entry !== null && entry.san != null;
    const explicitUci = typeof entry === 'object' && entry !== null && (entry.uci != null || entry.coordinate != null);
    const lower = moveText.toLowerCase();
    const looksLikeUci = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(lower);

    let move = null;
    if (explicitSan || (!explicitUci && !looksLikeUci)) {
      move = chess.move(moveText);
    } else {
      move = chess.move({
        from: lower.slice(0, 2),
        to: lower.slice(2, 4),
        promotion: lower[4],
      });
    }

    if (!move) {
      throw new Error(`Illegal move in ${sourceName} at #${idx + 1}: "${moveText}"`);
    }
    history.push(move);

    const rawTimestamp = typeof entry === 'object' && entry !== null
      ? (entry.playedAt ?? entry.time ?? entry.timestamp)
      : null;
    if (rawTimestamp != null) {
      const parsed = parseSeconds(rawTimestamp);
      if (parsed == null) {
        throw new Error(`Invalid move time in ${sourceName} at #${idx + 1}.`);
      }
      if (parsed < previousTimestamp) {
        throw new Error(`Move times must be non-decreasing in ${sourceName}.`);
      }
      moveTimestamps.push(parsed);
      previousTimestamp = parsed;
      seenTimestamp = true;
    } else {
      moveTimestamps.push(null);
    }
  });

  if (seenTimestamp && moveTimestamps.some((value) => value == null)) {
    throw new Error(`If one move has a timestamp in ${sourceName}, all moves must have timestamps.`);
  }

  let perMoveSeconds;
  if (seenTimestamp) {
    perMoveSeconds = moveTimestamps.map((stamp, idx) => {
      const prev = idx === 0 ? 0 : moveTimestamps[idx - 1];
      return Math.max(0.2, stamp - prev);
    });
  } else {
    const total = explicitTotalSeconds || Math.max(60, history.length * 6);
    perMoveSeconds = history.map(() => total / history.length);
  }

  const totalTimeSeconds = explicitTotalSeconds || perMoveSeconds.reduce((acc, value) => acc + value, 0);
  const whiteRating = jsonData.whiteRating || null;
  const blackRating = jsonData.blackRating || null;
  const whiteTitle = jsonData.whiteTitle || null;
  const blackTitle = jsonData.blackTitle || null;
  const evals = jsonData.evals || null;
  return {
    history,
    inputType: 'historical-json',
    gameMeta: {
      whiteName,
      blackName,
      whiteTitle,
      blackTitle,
      whiteRating,
      blackRating,
      totalTimeSeconds,
      sourceName,
    },
    perMoveSeconds,
    evals,
  };
}

module.exports = {
  ASSETS_DIR,
  BOARD_FRAME_OUTER_PADDING,
  BOARD_SIZE,
  CANVAS_SIZE,
  COLORS,
  EVAL_BAR_WIDTH,
  HOLD_FRAMES,
  INTRO_FRAMES,
  PIECE_IMAGES,
  PIECE_SYMBOLS,
  PLAYER_NAME_BAR_HEIGHT,
  PADDING,
  SQUARE_SIZE,
  STAUNTON_PIECE_URLS,
  TWEEN_FRAMES,
  VIDEO_FPS,
  buildHistoryFromInput,
  colRowFromSquare,
  easeInOut,
  extractTitleAndName,
  framePlanFromMoveSeconds,
  formatClock,
  getSoundForMove,
  parseHistoricalGame,
  parseSeconds,
  preloadStauntonPieces,
  readInputText,
  squareToPixel,
};
