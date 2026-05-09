#!/usr/bin/env node

const { Chess } = require('chess.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ffmpeg = require('fluent-ffmpeg');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const SQUARE_SIZE  = 80;
const BOARD_SIZE   = SQUARE_SIZE * 8;
const PADDING      = 40;
const CANVAS_SIZE  = BOARD_SIZE + PADDING * 2;

const VIDEO_FPS    = 24;
const TWEEN_FRAMES = 16;   // frames of sliding animation per move  (~0.67s)
const HOLD_FRAMES  = 18;   // frames to hold the settled position   (~0.75s)
const INTRO_FRAMES = 36;   // frames to hold the starting position  (~1.5s)
const DEFAULT_DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/chess_video';
const PLAYER_NAME_BAR_HEIGHT = Math.round(PADDING * 0.6);
const PLAYER_NAME_BAR_EDGE_MARGIN = 2;
const BOARD_FRAME_OUTER_PADDING = Math.round(PADDING * 0.22);
const ASSETS_DIR = path.join(__dirname, 'assets');

const COLORS = {
  light:          '#f0d9b5',
  dark:           '#b58863',
  lastMoveLight:  'rgba(205, 210, 106, 0.75)',
  lastMoveDark:   'rgba(170, 162, 58, 0.75)',
  frameOuter:     '#3b2616',
  frameInner:     '#8b5a2b',
  coordText:      '#e8d7bf',
  background:     '#1d120d',
};

// Unicode chess pieces
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert algebraic square ("e4") to pixel centre coordinates */
function squareToPixel(square) {
  const col = square.charCodeAt(0) - 97;
  const row = 8 - parseInt(square[1]);
  return {
    x: PADDING + col * SQUARE_SIZE + SQUARE_SIZE / 2,
    y: PADDING + row * SQUARE_SIZE + SQUARE_SIZE / 2,
  };
}

function colRowFromSquare(square) {
  return {
    col: square.charCodeAt(0) - 97,
    row: 8 - parseInt(square[1]),
  };
}

/** Ease-in-out cubic */
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
  // Priority: promotion > capture > castle > check > regular move
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
  // Alternate between self/opponent based on color
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

/** Read raw input text from a direct string or file path */
function readInputText(input) {
  if (fs.existsSync(input) && fs.statSync(input).isFile()) {
    return fs.readFileSync(input, 'utf8');
  }
  return input;
}

/**
 * Parse UCI-style coordinate tokens (e2e4, e7e8q, ...).
 * Returns null when input is not a pure coordinate list.
 */
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
    if (/^\d+$/.test(cleaned)) continue; // allow optional move numbers
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(cleaned)) return null;
    moves.push(cleaned);
  }

  return moves.length > 0 ? moves : null;
}

/** Build verbose history from either coordinate moves or PGN */
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

// ── Drawing primitives ────────────────────────────────────────────────────────

function drawBoard(ctx, lastMove) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isLight = (r + c) % 2 === 0;
      const x = PADDING + c * SQUARE_SIZE;
      const y = PADDING + r * SQUARE_SIZE;

      ctx.fillStyle = isLight ? COLORS.light : COLORS.dark;
      ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);

      if (lastMove) {
        const from = colRowFromSquare(lastMove.from);
        const to   = colRowFromSquare(lastMove.to);
        if ((from.col === c && from.row === r) || (to.col === c && to.row === r)) {
          ctx.fillStyle = isLight ? COLORS.lastMoveLight : COLORS.lastMoveDark;
          ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
        }
      }
    }
  }
}

function drawCoords(ctx) {
  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = ['8','7','6','5','4','3','2','1'];
  const fileY = PADDING + BOARD_SIZE - Math.round(SQUARE_SIZE * 0.12);
  ctx.font = `bold ${Math.round(SQUARE_SIZE * 0.2)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.coordText;
  files.forEach((f, i) => {
    ctx.fillText(f, PADDING + i * SQUARE_SIZE + SQUARE_SIZE / 2, fileY);
  });
  ranks.forEach((r, i) => {
    ctx.fillText(r, PADDING * 0.5, PADDING + i * SQUARE_SIZE + SQUARE_SIZE / 2);
  });
}

function drawPieceAt(ctx, piece, px, py, alpha = 1) {
  const key    = piece.color + piece.type.toUpperCase();
  const sprite = PIECE_IMAGES.get(key);
  if (sprite) {
    const size = Math.round(SQUARE_SIZE * 0.86);
    const x = Math.round(px - size / 2);
    const y = Math.round(py - size / 2);
    ctx.globalAlpha = alpha * 0.22;
    ctx.drawImage(sprite, x + 2, y + 3, size, size);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x, y, size, size);
    ctx.globalAlpha = 1;
    return;
  }

  const symbol = PIECE_SYMBOLS[key];
  const fontSize = Math.round(SQUARE_SIZE * 0.72);
  ctx.font = `${fontSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha * 0.35;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(symbol, px + 2, py + 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = piece.color === 'w' ? '#fffef0' : '#1a1a1a';
  ctx.fillText(symbol, px, py);
  ctx.globalAlpha = 1;
}

/**
 * Draw all static pieces from a board array.
 * skipSquares: Set of algebraic squares to omit (moving pieces handled separately).
 */
function drawStaticPieces(ctx, board, skipSquares = new Set()) {
  board.forEach((row, r) => {
    row.forEach((piece, c) => {
      if (!piece) return;
      const sq = String.fromCharCode(97 + c) + String(8 - r);
      if (skipSquares.has(sq)) return;
      const px = PADDING + c * SQUARE_SIZE + SQUARE_SIZE / 2;
      const py = PADDING + r * SQUARE_SIZE + SQUARE_SIZE / 2;
      drawPieceAt(ctx, piece, px, py);
    });
  });
}

function drawMoveLabel(ctx, moveNumber, san, totalMoves) {
  // No move notation display - keep it clean
}

function extractTitleAndName(name) {
  const match = String(name || '').match(/^(GM|IM|FM|WGM|WIM|WFM|NM|CM|WCM)\s+(.+)$/);
  return {
    title: match ? match[1] : null,
    displayName: match ? match[2] : String(name || ''),
  };
}

function drawPlayerNameBars(ctx, meta) {
  if (!meta) return;

  const topMargin = 6;
  const bottomMargin = 6;
  const barX = 0; // Start at edge
  const barW = CANVAS_SIZE; // Full width
  const barHeight = PLAYER_NAME_BAR_HEIGHT;
  const topBarY = topMargin;
  const bottomBarY = CANVAS_SIZE - barHeight - bottomMargin;

  function drawSingleBar(y, name, title, rating, color, timeRemaining, isActive) {
    // Draw full-width black bar (edge to edge)
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(barX, y, barW, barHeight);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, y + 0.5, barW - 1, barHeight - 1);

    // Draw player name with title color-coding
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(PADDING * 0.32)}px sans-serif`;
    ctx.textAlign = 'left';

    const parsed = extractTitleAndName(name);
    const effectiveTitle = title || parsed.title;
    const displayName = title ? (name.startsWith(`${title} `) ? name.slice(title.length + 1) : name) : parsed.displayName;

    const titleColors = {
      'GM': '#ff8c00',    // orange
      'FM': '#9370db',    // purple
      'IM': '#20b2aa',    // teal
      'NM': '#ffd700',    // yellow
      'WGM': '#ff8c00',   // orange (same as GM)
      'WIM': '#20b2aa',   // teal (same as IM)
      'WFM': '#9370db',   // purple (same as FM)
      'CM': '#ffffff',    // white
      'WCM': '#ffffff',   // white
    };

    const x = PADDING + 10;
    const centerY = y + barHeight / 2;

    if (effectiveTitle) {
      // Draw title in color
      const titleColor = titleColors[effectiveTitle] || '#ffffff';
      ctx.fillStyle = titleColor;
      ctx.fillText(effectiveTitle, x, centerY);

      // Measure title width to position name
      const titleWidth = ctx.measureText(effectiveTitle).width;

      // Draw name and rating in white
      ctx.fillStyle = color;
      const nameRating = rating ? ` ${displayName} ${rating}` : ` ${displayName}`;
      ctx.fillText(nameRating, x + titleWidth, centerY);
    } else {
      // No title, just draw name and rating
      ctx.fillStyle = color;
      const nameRating = rating ? `${displayName} ${rating}` : displayName;
      ctx.fillText(nameRating, x, centerY);
    }

    // Draw clock at far right edge
    const clockW = 90;
    const clockH = barHeight - 6;
    const clockX = barW - clockW - 8; // 8px from right edge
    const clockY = y + 3;

    // Only draw clock background if active (green highlight)
    // Inactive clocks blend with black bar
    if (isActive) {
      ctx.fillStyle = 'rgba(130, 180, 64, 0.95)';
      ctx.fillRect(clockX, clockY, clockW, clockH);

      ctx.strokeStyle = 'rgba(160, 200, 90, 1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(clockX + 0.5, clockY + 0.5, clockW - 1, clockH - 1);
    }

    // Clock text - smaller with better padding
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(PADDING * 0.34)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const totalSecs = Math.max(0, timeRemaining || 0);
    const mins = Math.floor(totalSecs / 60);
    const secs = Math.floor(totalSecs % 60);
    const tenths = Math.floor((totalSecs % 1) * 10);
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;

    ctx.fillText(timeStr, clockX + clockW / 2, clockY + clockH / 2);
  }

  drawSingleBar(topBarY, meta.blackName, meta.blackTitle, meta.blackRating, '#d9d9d9', meta.blackRemainingSeconds, meta.blackToMove);
  drawSingleBar(bottomBarY, meta.whiteName, meta.whiteTitle, meta.whiteRating, '#f7f7f7', meta.whiteRemainingSeconds, meta.whiteToMove);
}

function drawCornerClocks(ctx, meta) {
  // Clocks are now integrated into player name bars
  // This function is no longer needed but kept for compatibility
  return;
}

function drawBackground(ctx) {
  const outerPadding = BOARD_FRAME_OUTER_PADDING;
  const frameX = PADDING - outerPadding;
  const frameY = PADDING - outerPadding;
  const frameW = BOARD_SIZE + outerPadding * 2;
  const frameH = BOARD_SIZE + outerPadding * 2;

  const bgGradient = ctx.createLinearGradient(0, 0, 0, CANVAS_SIZE);
  bgGradient.addColorStop(0, '#281912');
  bgGradient.addColorStop(1, COLORS.background);
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const frameGradient = ctx.createLinearGradient(frameX, frameY, frameX + frameW, frameY + frameH);
  frameGradient.addColorStop(0, '#a97a49');
  frameGradient.addColorStop(0.5, COLORS.frameInner);
  frameGradient.addColorStop(1, COLORS.frameOuter);
  ctx.fillStyle = frameGradient;
  ctx.fillRect(frameX, frameY, frameW, frameH);

  ctx.strokeStyle = '#2b1a0e';
  ctx.lineWidth = 4;
  ctx.strokeRect(frameX + 1, frameY + 1, frameW - 2, frameH - 2);

  ctx.strokeStyle = '#d1ae7e';
  ctx.lineWidth = 2;
  ctx.strokeRect(PADDING - 2, PADDING - 2, BOARD_SIZE + 4, BOARD_SIZE + 4);
}

// ── Frame builders ────────────────────────────────────────────────────────────

function renderStaticFrame(boardArray, lastMove, moveNumber, san, totalMoves, customMeta = null) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx    = canvas.getContext('2d');
  drawBackground(ctx);
  drawPlayerNameBars(ctx, customMeta || drawMoveLabel.meta);
  drawCornerClocks(ctx, customMeta || drawMoveLabel.meta);
  drawBoard(ctx, lastMove);
  drawCoords(ctx);
  drawStaticPieces(ctx, boardArray);
  drawMoveLabel(ctx, moveNumber, san, totalMoves);
  return canvas.toBuffer('image/png');
}

/**
 * Render one tween frame.
 * boardBefore: board state before the move.
 * move: verbose move object (from, to, piece, color, flags, promotion, captured).
 * t: 0..1 progress (eased internally).
 */
function renderTweenFrame(boardBefore, move, t, moveNumber, totalMoves) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx    = canvas.getContext('2d');
  const ease   = easeInOut(t);

  // Squares to skip when drawing static pre-move pieces
  const skipSquares = new Set();
  skipSquares.add(move.from);             // lifted piece
  // Captured piece stays until capturing piece is almost there (90% through animation)
  if (move.captured && t > 0.9) skipSquares.add(move.to);

  // Castling: also lift the rook
  let rookFrom = null, rookTo = null, rookPiece = null;
  if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) {
    const rank = move.color === 'w' ? '1' : '8';
    rookFrom   = (move.flags.includes('k') ? 'h' : 'a') + rank;
    rookTo     = (move.flags.includes('k') ? 'f' : 'd') + rank;
    skipSquares.add(rookFrom);
    const rc = colRowFromSquare(rookFrom);
    rookPiece = boardBefore[rc.row][rc.col];
  }

  drawBackground(ctx);
  drawPlayerNameBars(ctx, drawMoveLabel.meta);
  drawCornerClocks(ctx, drawMoveLabel.meta);
  drawBoard(ctx, null);   // no highlight during tween
  drawCoords(ctx);
  drawStaticPieces(ctx, boardBefore, skipSquares);

  // Animate main piece
  const fromPx = squareToPixel(move.from);
  const toPx   = squareToPixel(move.to);
  const curX   = fromPx.x + (toPx.x - fromPx.x) * ease;
  const curY   = fromPx.y + (toPx.y - fromPx.y) * ease;

  // Snap to promoted piece type near end of tween
  const movingType = (move.promotion && t > 0.85) ? move.promotion : move.piece;
  drawPieceAt(ctx, { color: move.color, type: movingType }, curX, curY);

  // Animate rook for castling
  if (rookPiece) {
    const rfPx = squareToPixel(rookFrom);
    const rtPx = squareToPixel(rookTo);
    drawPieceAt(ctx, rookPiece,
      rfPx.x + (rtPx.x - rfPx.x) * ease,
      rfPx.y + (rtPx.y - rfPx.y) * ease,
    );
  }

  drawMoveLabel(ctx, moveNumber, move.san, totalMoves);
  return canvas.toBuffer('image/png');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function pgnToVideo(pgnInput, outputPath = 'chess_game.mp4') {
  await preloadStauntonPieces();

  const inputText = readInputText(pgnInput);
  const { history, inputType } = buildHistoryFromInput(inputText);
  const perMoveSeconds = history.map(() => (HOLD_FRAMES + TWEEN_FRAMES) / VIDEO_FPS);
  const totalTimeSeconds = perMoveSeconds.reduce((acc, v) => acc + v, 0);
  const elapsedByMove = [];
  let runningElapsed = 0;
  perMoveSeconds.forEach((seconds) => {
    runningElapsed += seconds;
    elapsedByMove.push(runningElapsed);
  });
  const totalMoves = history.length;
  if (totalMoves === 0) {
    throw new Error('No moves found in input.');
  }
  console.log(`Loaded ${inputType} input — ${totalMoves} moves found.`);

  // Pre-build board states: [0] = initial, [i+1] = after move i
  const boardStates = [];
  const replay = new Chess();
  boardStates.push(replay.board());
  for (const move of history) {
    replay.move(move.san);
    boardStates.push(replay.board());
  }

  // Frames directory
  const framesDir = path.join(__dirname, 'frames');
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir);

  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const resolvedOutputPath = path.join(outputDir, path.basename(outputPath));

  let frameIndex = 0;
  const soundEvents = []; // Track sound effects with timestamps

  function saveFrame(buf) {
    const file = path.join(framesDir, `frame_${String(frameIndex).padStart(6, '0')}.png`);
    fs.writeFileSync(file, buf);
    frameIndex++;
  }

  // Intro hold (no clocks for legacy JSON-based games)
  drawMoveLabel.meta = null;
  const introFrame = renderStaticFrame(boardStates[0], null, 0, '', totalMoves);
  for (let i = 0; i < INTRO_FRAMES; i++) saveFrame(introFrame);

  // Add game-start sound
  const introSeconds = INTRO_FRAMES / VIDEO_FPS;
  soundEvents.push({ timestamp: 0, soundFile: 'game-start.mp3' });

  // Per-move animation
  let whiteRemainingSeconds = totalTimeSeconds;
  let blackRemainingSeconds = totalTimeSeconds;
  let elapsed = 0;

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const moveSeconds = perMoveSeconds[i];

    // Store time BEFORE this move
    const whiteRemainingBefore = whiteRemainingSeconds;
    const blackRemainingBefore = blackRemainingSeconds;

    // Calculate time AFTER this move
    elapsed += moveSeconds;
    if (move.color === 'w') {
      whiteRemainingSeconds = Math.max(0, whiteRemainingSeconds - moveSeconds);
    } else {
      blackRemainingSeconds = Math.max(0, blackRemainingSeconds - moveSeconds);
    }

    const { tweenFrames, holdFrames } = framePlanFromMoveSeconds(moveSeconds);
    const totalFrames = tweenFrames + holdFrames;
    const timePerFrame = moveSeconds / totalFrames;

    // Check if move causes check
    const chess = new Chess();
    for (let j = 0; j <= i; j++) {
      chess.move(history[j].san);
    }
    const isCheck = chess.inCheck();

    // Add sound event at the END of tween animation (when piece settles)
    const tweenDuration = (tweenFrames / VIDEO_FPS);
    const videoTimestamp = introSeconds + (elapsed - moveSeconds) + tweenDuration;
    const soundFile = getSoundForMove(move, isCheck);
    soundEvents.push({ timestamp: videoTimestamp, soundFile });

    // Render tween frames with current player's clock highlighted and ticking
    for (let f = 0; f < tweenFrames; f++) {
      const frameElapsed = f * timePerFrame;
      const t = tweenFrames === 1 ? 1 : f / (tweenFrames - 1);

      drawMoveLabel.meta = {
        whiteName: 'White',
        blackName: 'Black',
        whiteRating: null,
        blackRating: null,
        totalTimeSeconds,
        elapsedSeconds: elapsedByMove[i] - moveSeconds + frameElapsed,
        whiteRemainingSeconds: move.color === 'w'
          ? Math.max(0, whiteRemainingBefore - frameElapsed)
          : whiteRemainingBefore,
        blackRemainingSeconds: move.color === 'b'
          ? Math.max(0, blackRemainingBefore - frameElapsed)
          : blackRemainingBefore,
        whiteToMove: move.color === 'w',
        blackToMove: move.color === 'b',
      };

      saveFrame(renderTweenFrame(boardStates[i], move, t, i + 1, totalMoves));
    }

    // Render hold frames - piece has settled, next player's turn starts and their clock ticks
    for (let h = 0; h < holdFrames; h++) {
      const holdElapsed = h * timePerFrame;

      // Next player is now highlighted and their clock starts ticking
      const nextPlayerIsWhite = move.color === 'b';
      const nextPlayerIsBlack = move.color === 'w';

      drawMoveLabel.meta = {
        whiteName: 'White',
        blackName: 'Black',
        whiteRating: null,
        blackRating: null,
        totalTimeSeconds,
        elapsedSeconds: elapsed + holdElapsed,
        // Next player's clock ticks down immediately
        whiteRemainingSeconds: nextPlayerIsWhite
          ? Math.max(0, whiteRemainingSeconds - holdElapsed)
          : whiteRemainingSeconds,
        blackRemainingSeconds: nextPlayerIsBlack
          ? Math.max(0, blackRemainingSeconds - holdElapsed)
          : blackRemainingSeconds,
        whiteToMove: nextPlayerIsWhite,
        blackToMove: nextPlayerIsBlack,
      };

      saveFrame(renderStaticFrame(boardStates[i + 1], move, i + 1, move.san, totalMoves));
    }

    process.stdout.write(`\r  Animated move ${i + 1} / ${totalMoves}`);
  }
  drawMoveLabel.meta = null;
  console.log(`\n  All frames rendered (${frameIndex} total).`);

  // Add game-end sound at the end
  const totalVideoDuration = frameIndex / VIDEO_FPS;
  soundEvents.push({ timestamp: totalVideoDuration - 0.5, soundFile: 'game-end.mp3' });

  // Encode
  console.log(`Encoding to ${resolvedOutputPath} with ${soundEvents.length} sound effects …`);
  try {
    await encodeVideoWithAudio(
      path.join(framesDir, 'frame_%06d.png'),
      soundEvents,
      totalVideoDuration,
      resolvedOutputPath
    );
    console.log(`Done! Video saved to: ${resolvedOutputPath}`);
  } finally {
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
  }
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
  return {
    history,
    inputType: 'historical-json',
    gameMeta: { whiteName, blackName, whiteTitle, blackTitle, whiteRating, blackRating, totalTimeSeconds, sourceName },
    perMoveSeconds,
  };
}

async function encodeVideoWithAudio(framePattern, soundEvents, videoDuration, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    // Input 0: video frames
    cmd.input(framePattern)
       .inputFPS(VIDEO_FPS);

    if (soundEvents.length === 0) {
      // No sounds, create silent audio
      cmd.input('anullsrc=r=44100:cl=stereo')
         .inputFormat('lavfi')
         .outputOptions(['-map', '0:v', '-map', '1:a']);
    } else {
      // Add each sound file as input
      const validEvents = [];
      soundEvents.forEach((event) => {
        const soundPath = path.join(ASSETS_DIR, event.soundFile);
        if (fs.existsSync(soundPath)) {
          cmd.input(soundPath);
          validEvents.push(event);
        } else {
          console.warn(`Warning: Sound file not found: ${soundPath}`);
        }
      });

      // Build filter complex to delay and mix all sounds
      const filterParts = [];

      // Delay each sound by its timestamp
      validEvents.forEach((event, idx) => {
        const inputIdx = idx + 1; // Inputs are: 0=video, 1+=sounds
        const delayMs = Math.round(event.timestamp * 1000);
        filterParts.push(`[${inputIdx}:a]adelay=delays=${delayMs}:all=1[a${idx}]`);
      });

      // Mix all delayed sounds together
      const mixInputs = validEvents.map((_, idx) => `[a${idx}]`).join('');
      filterParts.push(`${mixInputs}amix=inputs=${validEvents.length}:duration=longest:dropout_transition=0,apad=whole_dur=${videoDuration}[aout]`);

      const filterComplex = filterParts.join(';');
      cmd.complexFilter(filterComplex);
      cmd.outputOptions(['-map', '0:v', '-map', '[aout]']);
    }

    cmd.videoCodec('libx264')
       .audioCodec('aac')
       .audioBitrate('192k')
       .outputOptions([
         '-pix_fmt yuv420p',
         '-crf 18',
         '-preset slow'
       ])
       .fps(VIDEO_FPS)
       .output(outputPath)
       .on('end', resolve)
       .on('error', reject)
       .run();
  });
}

async function historicalParsedToVideo(parsedGame, outputPath) {
  const { history, gameMeta, perMoveSeconds } = parsedGame;
  await preloadStauntonPieces();

  const totalMoves = history.length;
  console.log(`Loaded historical game "${gameMeta.sourceName}" — ${totalMoves} moves found.`);

  const boardStates = [];
  const replay = new Chess();
  boardStates.push(replay.board());
  for (const move of history) {
    replay.move(move.san);
    boardStates.push(replay.board());
  }

  const framesDir = path.join(__dirname, 'frames');
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir);

  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const resolvedOutputPath = path.join(outputDir, path.basename(outputPath));

  let frameIndex = 0;
  const soundEvents = []; // Track sound effects with timestamps

  function saveFrame(buf) {
    const file = path.join(framesDir, `frame_${String(frameIndex).padStart(6, '0')}.png`);
    fs.writeFileSync(file, buf);
    frameIndex++;
  }

  drawMoveLabel.meta = {
    whiteName: gameMeta.whiteName,
    blackName: gameMeta.blackName,
    whiteTitle: gameMeta.whiteTitle,
    blackTitle: gameMeta.blackTitle,
    whiteRating: gameMeta.whiteRating,
    blackRating: gameMeta.blackRating,
    totalTimeSeconds: gameMeta.totalTimeSeconds,
    elapsedSeconds: 0,
    whiteRemainingSeconds: gameMeta.totalTimeSeconds,
    blackRemainingSeconds: gameMeta.totalTimeSeconds,
    whiteToMove: true,
    blackToMove: false,
  };

  // Intro frames with ticking white clock (white to move first)
  const timePerFrame = 1 / VIDEO_FPS;
  for (let i = 0; i < INTRO_FRAMES; i++) {
    const elapsedDuringIntro = i * timePerFrame;
    const introMeta = {
      ...drawMoveLabel.meta,
      whiteRemainingSeconds: Math.max(0, drawMoveLabel.meta.whiteRemainingSeconds - elapsedDuringIntro),
      whiteToMove: true,
      blackToMove: false,
    };
    saveFrame(renderStaticFrame(boardStates[0], null, 0, '', totalMoves, introMeta));
  }

  let elapsed = 0;
  let whiteRemainingSeconds = gameMeta.totalTimeSeconds;
  let blackRemainingSeconds = gameMeta.totalTimeSeconds;

  // Add game-start sound
  const introSeconds = INTRO_FRAMES / VIDEO_FPS;
  soundEvents.push({ timestamp: 0, soundFile: 'game-start.mp3' });

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const moveSeconds = perMoveSeconds[i];

    // Store time BEFORE this move
    const whiteRemainingBefore = whiteRemainingSeconds;
    const blackRemainingBefore = blackRemainingSeconds;

    // Calculate time AFTER this move
    elapsed += moveSeconds;
    if (move.color === 'w') {
      whiteRemainingSeconds = Math.max(0, whiteRemainingSeconds - moveSeconds);
    } else {
      blackRemainingSeconds = Math.max(0, blackRemainingSeconds - moveSeconds);
    }

    const { tweenFrames, holdFrames } = framePlanFromMoveSeconds(moveSeconds);
    const totalFrames = tweenFrames + holdFrames;
    const timePerFrame = moveSeconds / totalFrames;

    // Check if move causes check by examining board state after move
    const chess = new Chess();
    for (let j = 0; j <= i; j++) {
      chess.move(history[j].san);
    }
    const isCheck = chess.inCheck();

    // Add sound event at the END of tween animation (when piece settles)
    const tweenDuration = (tweenFrames / VIDEO_FPS);
    const videoTimestamp = introSeconds + (elapsed - moveSeconds) + tweenDuration;
    const soundFile = getSoundForMove(move, isCheck);
    soundEvents.push({ timestamp: videoTimestamp, soundFile });

    // Render tween frames with current player's clock highlighted and ticking
    for (let f = 0; f < tweenFrames; f++) {
      const frameElapsed = f * timePerFrame;
      const t = tweenFrames === 1 ? 1 : f / (tweenFrames - 1);

      drawMoveLabel.meta = {
        whiteName: gameMeta.whiteName,
        blackName: gameMeta.blackName,
        whiteTitle: gameMeta.whiteTitle,
        blackTitle: gameMeta.blackTitle,
        whiteRating: gameMeta.whiteRating,
        blackRating: gameMeta.blackRating,
        totalTimeSeconds: gameMeta.totalTimeSeconds,
        elapsedSeconds: elapsed - moveSeconds + frameElapsed,
        whiteRemainingSeconds: move.color === 'w'
          ? Math.max(0, whiteRemainingBefore - frameElapsed)
          : whiteRemainingBefore,
        blackRemainingSeconds: move.color === 'b'
          ? Math.max(0, blackRemainingBefore - frameElapsed)
          : blackRemainingBefore,
        whiteToMove: move.color === 'w',
        blackToMove: move.color === 'b',
      };

      saveFrame(renderTweenFrame(boardStates[i], move, t, i + 1, totalMoves));
    }

    // Render hold frames - piece has settled, next player's turn starts and their clock ticks
    for (let h = 0; h < holdFrames; h++) {
      const holdElapsed = h * timePerFrame;

      // Next player is now highlighted and their clock starts ticking
      const nextPlayerIsWhite = move.color === 'b';
      const nextPlayerIsBlack = move.color === 'w';

      drawMoveLabel.meta = {
        whiteName: gameMeta.whiteName,
        blackName: gameMeta.blackName,
        whiteTitle: gameMeta.whiteTitle,
        blackTitle: gameMeta.blackTitle,
        whiteRating: gameMeta.whiteRating,
        blackRating: gameMeta.blackRating,
        totalTimeSeconds: gameMeta.totalTimeSeconds,
        elapsedSeconds: elapsed + holdElapsed,
        // Next player's clock ticks down immediately
        whiteRemainingSeconds: nextPlayerIsWhite
          ? Math.max(0, whiteRemainingSeconds - holdElapsed)
          : whiteRemainingSeconds,
        blackRemainingSeconds: nextPlayerIsBlack
          ? Math.max(0, blackRemainingSeconds - holdElapsed)
          : blackRemainingSeconds,
        whiteToMove: nextPlayerIsWhite,
        blackToMove: nextPlayerIsBlack,
      };

      saveFrame(renderStaticFrame(boardStates[i + 1], move, i + 1, move.san, totalMoves));
    }

    process.stdout.write(`\r  Animated move ${i + 1} / ${totalMoves}`);
  }
  drawMoveLabel.meta = null;
  console.log(`\n  All frames rendered (${frameIndex} total).`);

  // Add game-end sound at the end
  const totalVideoDuration = frameIndex / VIDEO_FPS;
  soundEvents.push({ timestamp: totalVideoDuration - 0.5, soundFile: 'game-end.mp3' });

  console.log(`Encoding to ${resolvedOutputPath} with ${soundEvents.length} sound effects …`);
  try {
    await encodeVideoWithAudio(
      path.join(framesDir, 'frame_%06d.png'),
      soundEvents,
      totalVideoDuration,
      resolvedOutputPath
    );
    console.log(`Done! Video saved to: ${resolvedOutputPath}`);
  } finally {
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
  }
}

async function historicalDbGameToVideo(gameIdInput, outputPath) {
  const gameId = Number(gameIdInput);
  if (!Number.isInteger(gameId) || gameId <= 0) {
    throw new Error(`Invalid game id: "${gameIdInput}"`);
  }

  const client = new Client({ connectionString: DEFAULT_DB_URL });
  await client.connect();
  try {
    const gameResult = await client.query(
      `SELECT
        g.id,
        g.total_time_seconds,
        wp.display_name AS white_name,
        wp.title AS white_title,
        bp.display_name AS black_name,
        bp.title AS black_title,
        g.metadata->>'whiteRating' AS white_rating,
        g.metadata->>'blackRating' AS black_rating
      FROM games g
      JOIN players wp ON wp.id = g.white_player_id
      JOIN players bp ON bp.id = g.black_player_id
      WHERE g.id = $1`,
      [gameId],
    );
    if (gameResult.rows.length === 0) {
      throw new Error(`No game found in database with id ${gameId}.`);
    }

    const movesResult = await client.query(
      `SELECT ply, san, played_at_seconds
       FROM game_moves
       WHERE game_id = $1
       ORDER BY ply ASC`,
      [gameId],
    );
    if (movesResult.rows.length === 0) {
      throw new Error(`Game ${gameId} has no moves in database.`);
    }

    const gameRow = gameResult.rows[0];
    const jsonData = {
      whitePlayer: gameRow.white_name,
      blackPlayer: gameRow.black_name,
      whiteTitle: gameRow.white_title,
      blackTitle: gameRow.black_title,
      totalTimeSeconds: gameRow.total_time_seconds,
      whiteRating: gameRow.white_rating,
      blackRating: gameRow.black_rating,
      moves: movesResult.rows.map((row) => (
        row.played_at_seconds == null
          ? { san: row.san }
          : { san: row.san, playedAt: row.played_at_seconds }
      )),
    };
    const sourceName = `db-game-${gameId}`;
    const parsedGame = parseHistoricalGame(jsonData, sourceName);
    const resolvedOutput = outputPath || `${sourceName}.mp4`;
    await historicalParsedToVideo(parsedGame, resolvedOutput);
  } finally {
    await client.end();
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args[0] === '--legacy') {
  if (args.length < 2) {
    console.error('Usage: node index.js --legacy "<pgn-or-coords>" [output.mp4]');
    process.exit(1);
  }
  pgnToVideo(args[1], args[2] || 'chess_game.mp4').catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (args[0] === '--game-id') {
  if (args.length < 2) {
    console.error('Usage: node index.js --game-id <id> [output.mp4]');
    process.exit(1);
  }
  historicalDbGameToVideo(args[1], args[2]).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
} else {
  console.error('Usage: node index.js --game-id <id> [output.mp4] OR node index.js --legacy "<pgn-or-coords>" [output.mp4]');
  process.exit(1);
}
