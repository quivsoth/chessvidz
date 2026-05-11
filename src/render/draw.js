const { createCanvas } = require('@napi-rs/canvas');

const {
  BOARD_FRAME_OUTER_PADDING,
  BOARD_SIZE,
  BOTTOM_GAP,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COLORS,
  EVAL_BAR_GAP,
  EVAL_BAR_WIDTH,
  PADDING,
  PADDING_X,
  PADDING_Y,
  PLAYER_NAME_BAR_HEIGHT,
  PIECE_IMAGES,
  PIECE_SYMBOLS,
  SQUARE_SIZE,
  TOP_GAP,
  colRowFromSquare,
  easeInOut,
  extractTitleAndName,
  squareToPixel,
} = require('./shared');

function drawBoard(ctx, lastMove) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isLight = (r + c) % 2 === 0;
      const x = PADDING_X + c * SQUARE_SIZE;
      const y = PADDING_Y + r * SQUARE_SIZE;

      ctx.fillStyle = isLight ? COLORS.light : COLORS.dark;
      ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);

      if (lastMove) {
        const from = colRowFromSquare(lastMove.from);
        const to = colRowFromSquare(lastMove.to);
        if ((from.col === c && from.row === r) || (to.col === c && to.row === r)) {
          ctx.fillStyle = isLight ? COLORS.lastMoveLight : COLORS.lastMoveDark;
          ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
        }
      }
    }
  }
}

function drawCoords(ctx) {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
  const fileY = PADDING_Y + BOARD_SIZE - Math.round(SQUARE_SIZE * 0.12);
  ctx.font = `bold ${Math.round(SQUARE_SIZE * 0.2)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.coordText;
  files.forEach((f, i) => {
    ctx.fillText(f, PADDING_X + i * SQUARE_SIZE + SQUARE_SIZE / 2, fileY);
  });
  ranks.forEach((r, i) => {
    ctx.fillText(r, PADDING_X * 0.5, PADDING_Y + i * SQUARE_SIZE + SQUARE_SIZE / 2);
  });
}

function drawPieceAt(ctx, piece, px, py, alpha = 1) {
  const key = piece.color + piece.type.toUpperCase();
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

function drawStaticPieces(ctx, board, skipSquares = new Set()) {
  board.forEach((row, r) => {
    row.forEach((piece, c) => {
      if (!piece) return;
      const sq = String.fromCharCode(97 + c) + String(8 - r);
      if (skipSquares.has(sq)) return;
      const px = PADDING_X + c * SQUARE_SIZE + SQUARE_SIZE / 2;
      const py = PADDING_Y + r * SQUARE_SIZE + SQUARE_SIZE / 2;
      drawPieceAt(ctx, piece, px, py);
    });
  });
}

function drawMoveLabel() {
  // No move notation display - keep it clean
}

function drawPlayerNameBars(ctx, meta) {
  if (!meta) return;

  const barX = 0;
  const barW = CANVAS_WIDTH;
  const barHeight = PLAYER_NAME_BAR_HEIGHT;
  const topBarY = 0;
  const bottomBarY = CANVAS_HEIGHT - PLAYER_NAME_BAR_HEIGHT;

  function drawSingleBar(y, name, title, rating, color, timeRemaining, isActive) {
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(barX, y, barW, barHeight);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, y + 0.5, barW - 1, barHeight - 1);

    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(PADDING * 0.32)}px sans-serif`;
    ctx.textAlign = 'left';

    const parsed = extractTitleAndName(name);
    const effectiveTitle = title || parsed.title;
    const displayName = title ? (name.startsWith(`${title} `) ? name.slice(title.length + 1) : name) : parsed.displayName;

    const titleColors = {
      GM: '#ff8c00',
      FM: '#9370db',
      IM: '#20b2aa',
      NM: '#ffd700',
      WGM: '#ff8c00',
      WIM: '#20b2aa',
      WFM: '#9370db',
      CM: '#ffffff',
      WCM: '#ffffff',
    };

    const x = PADDING_X + 10;
    const centerY = y + barHeight / 2;

    if (effectiveTitle) {
      const titleColor = titleColors[effectiveTitle] || '#ffffff';
      ctx.fillStyle = titleColor;
      ctx.fillText(effectiveTitle, x, centerY);

      const titleWidth = ctx.measureText(effectiveTitle).width;

      ctx.fillStyle = color;
      const nameRating = rating ? ` ${displayName} ${rating}` : ` ${displayName}`;
      ctx.fillText(nameRating, x + titleWidth, centerY);
    } else {
      ctx.fillStyle = color;
      const nameRating = rating ? `${displayName} ${rating}` : displayName;
      ctx.fillText(nameRating, x, centerY);
    }

    const clockW = 90;
    const clockH = barHeight - 6;
    const clockX = barW - clockW - 8;
    const clockY = y + 3;

    if (isActive) {
      ctx.fillStyle = 'rgba(130, 180, 64, 0.95)';
      ctx.fillRect(clockX, clockY, clockW, clockH);

      ctx.strokeStyle = 'rgba(160, 200, 90, 1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(clockX + 0.5, clockY + 0.5, clockW - 1, clockH - 1);
    }

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

function drawCornerClocks() {
  return;
}

function drawEvalBar(ctx, evalCp) {
  if (evalCp === null || evalCp === undefined) return;

  const barX = PADDING_X + BOARD_SIZE + EVAL_BAR_GAP;
  const barY = PLAYER_NAME_BAR_HEIGHT;
  const barHeight = CANVAS_HEIGHT - (PLAYER_NAME_BAR_HEIGHT * 2);
  const barWidth = EVAL_BAR_WIDTH;

  ctx.fillStyle = '#2d2d2d';
  ctx.fillRect(barX, barY, barWidth, barHeight);

  const clampedEval = Math.max(-1000, Math.min(1000, evalCp));
  const evalPercent = (clampedEval + 1000) / 2000;
  const whiteHeight = barHeight * evalPercent;

  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(barX, barY, barWidth, whiteHeight);

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(barX, barY + whiteHeight, barWidth, barHeight - whiteHeight);

  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);

  ctx.fillStyle = evalCp > 0 ? '#1a1a1a' : '#f0f0f0';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const evalText = (Math.abs(evalCp) / 100).toFixed(1);
  const textY = evalCp > 0 ? barY + whiteHeight / 2 : barY + whiteHeight + (barHeight - whiteHeight) / 2;
  ctx.fillText(evalText, barX + barWidth / 2, textY);
}

function drawBackground(ctx) {
  const outerPadding = BOARD_FRAME_OUTER_PADDING;
  const frameX = PADDING_X - outerPadding;
  const frameY = PADDING_Y - outerPadding;
  const frameW = BOARD_SIZE + outerPadding * 2;
  const frameH = BOARD_SIZE + outerPadding * 2;

  const bgGradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  bgGradient.addColorStop(0, '#281912');
  bgGradient.addColorStop(1, COLORS.background);
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

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
  ctx.strokeRect(PADDING_X - 2, PADDING_Y - 2, BOARD_SIZE + 4, BOARD_SIZE + 4);
}

function renderStaticFrame(boardArray, lastMove, moveNumber, san, totalMoves, customMeta = null) {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx);
  drawPlayerNameBars(ctx, customMeta || drawMoveLabel.meta);
  drawCornerClocks(ctx, customMeta || drawMoveLabel.meta);
  drawEvalBar(ctx, (customMeta || drawMoveLabel.meta)?.evalCp);
  drawBoard(ctx, lastMove);
  drawCoords(ctx);
  drawStaticPieces(ctx, boardArray);
  drawMoveLabel(ctx, moveNumber, san, totalMoves);
  return canvas.toBuffer('image/png');
}

function renderTweenFrame(boardBefore, move, t, moveNumber, totalMoves) {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');
  const ease = easeInOut(t);

  const skipSquares = new Set();
  skipSquares.add(move.from);
  if (move.captured && t > 0.9) skipSquares.add(move.to);

  let rookFrom = null, rookTo = null, rookPiece = null;
  if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) {
    const rank = move.color === 'w' ? '1' : '8';
    rookFrom = (move.flags.includes('k') ? 'h' : 'a') + rank;
    rookTo = (move.flags.includes('k') ? 'f' : 'd') + rank;
    skipSquares.add(rookFrom);
    const rc = colRowFromSquare(rookFrom);
    rookPiece = boardBefore[rc.row][rc.col];
  }

  drawBackground(ctx);
  drawPlayerNameBars(ctx, drawMoveLabel.meta);
  drawCornerClocks(ctx, drawMoveLabel.meta);
  drawEvalBar(ctx, drawMoveLabel.meta?.evalCp);
  drawBoard(ctx, null);
  drawCoords(ctx);
  drawStaticPieces(ctx, boardBefore, skipSquares);

  const fromPx = squareToPixel(move.from);
  const toPx = squareToPixel(move.to);
  const curX = fromPx.x + (toPx.x - fromPx.x) * ease;
  const curY = fromPx.y + (toPx.y - fromPx.y) * ease;

  const movingType = (move.promotion && t > 0.85) ? move.promotion : move.piece;
  drawPieceAt(ctx, { color: move.color, type: movingType }, curX, curY);

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

module.exports = {
  drawBackground,
  drawBoard,
  drawCornerClocks,
  drawCoords,
  drawEvalBar,
  drawMoveLabel,
  drawPieceAt,
  drawPlayerNameBars,
  drawStaticPieces,
  renderStaticFrame,
  renderTweenFrame,
};
