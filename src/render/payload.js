const { Chess } = require('chess.js');

const { parseSeconds } = require('./shared');

function normalizeMoveEntry(entry, idx, sourceName) {
  if (typeof entry === 'string') {
    const san = entry.trim();
    if (!san) {
      throw new Error(`Missing move text in ${sourceName} at #${idx + 1}.`);
    }
    return { san };
  }

  if (!entry || typeof entry !== 'object') {
    throw new Error(`Invalid move entry in ${sourceName} at #${idx + 1}.`);
  }

  const rawMove = entry.move || entry.uci || entry.coordinate || entry.san || '';
  const moveText = String(rawMove).trim();
  if (!moveText) {
    throw new Error(`Missing move text in ${sourceName} at #${idx + 1}.`);
  }

  const lower = moveText.toLowerCase();
  const looksLikeUci = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(lower);
  const move = entry.san != null || (!entry.uci && !entry.coordinate && !looksLikeUci)
    ? { san: moveText }
    : {
      from: lower.slice(0, 2),
      to: lower.slice(2, 4),
      promotion: lower[4],
    };

  const playedAtSeconds = entry.playedAtSeconds ?? entry.playedAt ?? entry.time ?? entry.timestamp ?? null;
  if (playedAtSeconds != null) {
    const parsed = parseSeconds(playedAtSeconds);
    if (parsed == null) {
      throw new Error(`Invalid move time in ${sourceName} at #${idx + 1}.`);
    }
    move.playedAtSeconds = parsed;
  }

  return move;
}

function normalizeEvalEntries(evals) {
  if (!evals) return new Map();
  if (evals instanceof Map) return evals;

  const map = new Map();

  if (Array.isArray(evals)) {
    evals.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const ply = Number(entry.ply);
      if (!Number.isInteger(ply) || ply < 0) return;
      map.set(ply, {
        evalCp: entry.evalCp ?? entry.eval_cp ?? null,
        mateIn: entry.mateIn ?? entry.mate_in ?? null,
      });
    });
    return map;
  }

  if (typeof evals === 'object') {
    Object.entries(evals).forEach(([plyKey, value]) => {
      const ply = Number(plyKey);
      if (!Number.isInteger(ply) || ply < 0) return;
      if (value && typeof value === 'object') {
        map.set(ply, {
          evalCp: value.evalCp ?? value.eval_cp ?? null,
          mateIn: value.mateIn ?? value.mate_in ?? null,
        });
      }
    });
  }

  return map;
}

function normalizeRenderPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid render payload: expected an object.');
  }

  const sourceName = payload.sourceName || payload.gameMeta?.sourceName || 'render-payload';
  const gameMeta = payload.gameMeta || {};
  const whiteName = payload.whitePlayer || payload.whiteName || gameMeta.whiteName || payload.white || payload.players?.white;
  const blackName = payload.blackPlayer || payload.blackName || gameMeta.blackName || payload.black || payload.players?.black;
  if (!whiteName || !blackName) {
    throw new Error(`Invalid render payload in ${sourceName}: missing white/black player names.`);
  }

  const moves = Array.isArray(payload.moves) ? payload.moves : null;
  if (!moves || moves.length === 0) {
    throw new Error(`Invalid render payload in ${sourceName}: "moves" must be a non-empty array.`);
  }

  const explicitTotalSeconds = parseSeconds(
    payload.totalTimeSeconds ?? gameMeta.totalTimeSeconds ?? payload.totalTime ?? payload.totalGameTime,
  );
  if ((payload.totalTimeSeconds ?? gameMeta.totalTimeSeconds ?? payload.totalTime ?? payload.totalGameTime) != null && explicitTotalSeconds == null) {
    throw new Error(`Invalid total time in ${sourceName}. Use seconds, MM:SS, or HH:MM:SS.`);
  }

  const chess = new Chess();
  const history = [];
  const moveTimestamps = [];
  let seenTimestamp = false;
  let previousTimestamp = 0;

  moves.forEach((entry, idx) => {
    const move = normalizeMoveEntry(entry, idx, sourceName);

    let verboseMove = null;
    if (move.san) {
      verboseMove = chess.move(move.san);
    } else {
      verboseMove = chess.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      });
    }

    if (!verboseMove) {
      const raw = typeof entry === 'string'
        ? entry
        : String(entry.san || entry.move || entry.coordinate || entry.uci || '');
      throw new Error(`Illegal move in ${sourceName} at #${idx + 1}: "${raw}"`);
    }
    history.push(verboseMove);

    if (move.playedAtSeconds != null) {
      if (move.playedAtSeconds < previousTimestamp) {
        throw new Error(`Move times must be non-decreasing in ${sourceName}.`);
      }
      moveTimestamps.push(move.playedAtSeconds);
      previousTimestamp = move.playedAtSeconds;
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
  } else if (Array.isArray(payload.perMoveSeconds) && payload.perMoveSeconds.length === history.length) {
    perMoveSeconds = payload.perMoveSeconds.map((value, idx) => {
      const parsed = parseSeconds(value);
      if (parsed == null) {
        throw new Error(`Invalid per-move time in ${sourceName} at #${idx + 1}.`);
      }
      return Math.max(0.2, parsed);
    });
  } else {
    const total = explicitTotalSeconds || Math.max(60, history.length * 6);
    perMoveSeconds = history.map(() => total / history.length);
  }

  const totalTimeSeconds = explicitTotalSeconds || perMoveSeconds.reduce((acc, value) => acc + value, 0);
  const evals = normalizeEvalEntries(payload.evals);

  return {
    history,
    inputType: payload.inputType || 'render-payload',
    gameMeta: {
      whiteName,
      blackName,
      whiteTitle: payload.whiteTitle || gameMeta.whiteTitle || null,
      blackTitle: payload.blackTitle || gameMeta.blackTitle || null,
      whiteRating: payload.whiteRating || gameMeta.whiteRating || null,
      blackRating: payload.blackRating || gameMeta.blackRating || null,
      totalTimeSeconds,
      sourceName,
    },
    perMoveSeconds,
    evals,
  };
}

function readRenderPayload(source) {
  const fs = require('fs');
  if (typeof source !== 'string') {
    return source;
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Render payload file not found: ${source}`);
  }
  return JSON.parse(fs.readFileSync(source, 'utf8'));
}

module.exports = {
  normalizeRenderPayload,
  readRenderPayload,
};
