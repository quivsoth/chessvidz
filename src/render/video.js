const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { Chess } = require('chess.js');

const {
  ASSETS_DIR,
  HOLD_FRAMES,
  INTRO_FRAMES,
  TWEEN_FRAMES,
  VIDEO_FPS,
  buildHistoryFromInput,
  framePlanFromMoveSeconds,
  getSoundForMove,
  easeInOut,
  preloadStauntonPieces,
  readInputText,
} = require('./shared');
const {
  renderStaticFrame,
  renderTweenFrame,
  drawMoveLabel,
} = require('./draw');
const { normalizeRenderPayload } = require('./payload');

async function encodeVideoWithAudio(framePattern, soundEvents, videoDuration, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    cmd.input(framePattern).inputFPS(VIDEO_FPS);

    if (soundEvents.length === 0) {
      cmd.input('anullsrc=r=44100:cl=stereo')
        .inputFormat('lavfi')
        .outputOptions(['-map', '0:v', '-map', '1:a']);
    } else {
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

      const filterParts = [];
      validEvents.forEach((event, idx) => {
        const inputIdx = idx + 1;
        const delayMs = Math.round(event.timestamp * 1000);
        filterParts.push(`[${inputIdx}:a]adelay=delays=${delayMs}:all=1[a${idx}]`);
      });

      const mixInputs = validEvents.map((_, idx) => `[a${idx}]`).join('');
      filterParts.push(`${mixInputs}amix=inputs=${validEvents.length}:duration=longest:dropout_transition=0,apad=whole_dur=${videoDuration}[aout]`);

      cmd.complexFilter(filterParts.join(';'));
      cmd.outputOptions(['-map', '0:v', '-map', '[aout]']);
    }

    cmd.videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('192k')
      .outputOptions([
        '-pix_fmt yuv420p',
        '-crf 18',
        '-preset slow',
      ])
      .fps(VIDEO_FPS)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

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

  const boardStates = [];
  const replay = new Chess();
  boardStates.push(replay.board());
  for (const move of history) {
    replay.move(move.san);
    boardStates.push(replay.board());
  }

  const framesDir = path.join(__dirname, '..', '..', 'frames');
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir);

  const outputDir = path.join(__dirname, '..', '..', 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const resolvedOutputPath = path.join(outputDir, path.basename(outputPath));

  let frameIndex = 0;
  const soundEvents = [];

  function saveFrame(buf) {
    const file = path.join(framesDir, `frame_${String(frameIndex).padStart(6, '0')}.png`);
    fs.writeFileSync(file, buf);
    frameIndex++;
  }

  drawMoveLabel.meta = null;
  const introFrame = renderStaticFrame(boardStates[0], null, 0, '', totalMoves);
  for (let i = 0; i < INTRO_FRAMES; i++) saveFrame(introFrame);

  const introSeconds = INTRO_FRAMES / VIDEO_FPS;
  soundEvents.push({ timestamp: 0, soundFile: 'game-start.mp3' });

  let whiteRemainingSeconds = totalTimeSeconds;
  let blackRemainingSeconds = totalTimeSeconds;
  let elapsed = 0;

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const moveSeconds = perMoveSeconds[i];
    const whiteRemainingBefore = whiteRemainingSeconds;
    const blackRemainingBefore = blackRemainingSeconds;

    elapsed += moveSeconds;
    if (move.color === 'w') {
      whiteRemainingSeconds = Math.max(0, whiteRemainingSeconds - moveSeconds);
    } else {
      blackRemainingSeconds = Math.max(0, blackRemainingSeconds - moveSeconds);
    }

    const { tweenFrames, holdFrames } = framePlanFromMoveSeconds(moveSeconds);
    const totalFrames = tweenFrames + holdFrames;
    const timePerFrame = moveSeconds / totalFrames;

    const chess = new Chess();
    for (let j = 0; j <= i; j++) {
      chess.move(history[j].san);
    }
    const isCheck = chess.inCheck();

    const tweenDuration = tweenFrames / VIDEO_FPS;
    const videoTimestamp = introSeconds + (elapsed - moveSeconds) + tweenDuration;
    const soundFile = getSoundForMove(move, isCheck);
    soundEvents.push({ timestamp: videoTimestamp, soundFile });

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

    for (let h = 0; h < holdFrames; h++) {
      const holdElapsed = h * timePerFrame;
      const nextPlayerIsWhite = move.color === 'b';
      const nextPlayerIsBlack = move.color === 'w';

      drawMoveLabel.meta = {
        whiteName: 'White',
        blackName: 'Black',
        whiteRating: null,
        blackRating: null,
        totalTimeSeconds,
        elapsedSeconds: elapsed + holdElapsed,
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

  const totalVideoDuration = frameIndex / VIDEO_FPS;
  soundEvents.push({ timestamp: totalVideoDuration - 0.5, soundFile: 'game-end.mp3' });

  console.log(`Encoding to ${resolvedOutputPath} with ${soundEvents.length} sound effects …`);
  try {
    await encodeVideoWithAudio(
      path.join(framesDir, 'frame_%06d.png'),
      soundEvents,
      totalVideoDuration,
      resolvedOutputPath,
    );
    console.log(`Done! Video saved to: ${resolvedOutputPath}`);
  } finally {
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
  }
}

async function renderGame(parsedGame, outputPath) {
  const { history, gameMeta, perMoveSeconds, evals } = parsedGame;
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

  const framesDir = path.join(__dirname, '..', '..', 'frames');
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir);

  const outputDir = path.join(__dirname, '..', '..', 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const resolvedOutputPath = path.join(outputDir, path.basename(outputPath));

  let frameIndex = 0;
  const soundEvents = [];

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

  const timePerFrame = 1 / VIDEO_FPS;
  const startingEval = evals?.get(1)?.evalCp || 0;
  for (let i = 0; i < INTRO_FRAMES; i++) {
    const elapsedDuringIntro = i * timePerFrame;
    const introMeta = {
      ...drawMoveLabel.meta,
      whiteRemainingSeconds: Math.max(0, drawMoveLabel.meta.whiteRemainingSeconds - elapsedDuringIntro),
      whiteToMove: true,
      blackToMove: false,
      evalCp: startingEval,
    };
    saveFrame(renderStaticFrame(boardStates[0], null, 0, '', totalMoves, introMeta));
  }

  let elapsed = 0;
  let whiteRemainingSeconds = gameMeta.totalTimeSeconds;
  let blackRemainingSeconds = gameMeta.totalTimeSeconds;

  const introSeconds = INTRO_FRAMES / VIDEO_FPS;
  soundEvents.push({ timestamp: 0, soundFile: 'game-start.mp3' });

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const moveSeconds = perMoveSeconds[i];
    const whiteRemainingBefore = whiteRemainingSeconds;
    const blackRemainingBefore = blackRemainingSeconds;

    elapsed += moveSeconds;
    if (move.color === 'w') {
      whiteRemainingSeconds = Math.max(0, whiteRemainingSeconds - moveSeconds);
    } else {
      blackRemainingSeconds = Math.max(0, blackRemainingSeconds - moveSeconds);
    }

    const { tweenFrames, holdFrames } = framePlanFromMoveSeconds(moveSeconds);
    const totalFrames = tweenFrames + holdFrames;
    const timePerFrame = moveSeconds / totalFrames;

    const chess = new Chess();
    for (let j = 0; j <= i; j++) {
      chess.move(history[j].san);
    }
    const isCheck = chess.inCheck();

    const tweenDuration = tweenFrames / VIDEO_FPS;
    const videoTimestamp = introSeconds + (elapsed - moveSeconds) + tweenDuration;
    const soundFile = getSoundForMove(move, isCheck);
    soundEvents.push({ timestamp: videoTimestamp, soundFile });

    const prevEval = evals?.get(i)?.evalCp ?? 0;
    const moveEval = evals?.get(i + 1)?.evalCp ?? prevEval;

    for (let f = 0; f < tweenFrames; f++) {
      const frameElapsed = f * timePerFrame;
      const t = tweenFrames === 1 ? 1 : f / (tweenFrames - 1);
      const ease = easeInOut(t);
      const interpolatedEval = prevEval + (moveEval - prevEval) * ease;

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
        evalCp: interpolatedEval,
      };

      saveFrame(renderTweenFrame(boardStates[i], move, t, i + 1, totalMoves));
    }

    for (let h = 0; h < holdFrames; h++) {
      const holdElapsed = h * timePerFrame;
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
        whiteRemainingSeconds: nextPlayerIsWhite
          ? Math.max(0, whiteRemainingSeconds - holdElapsed)
          : whiteRemainingSeconds,
        blackRemainingSeconds: nextPlayerIsBlack
          ? Math.max(0, blackRemainingSeconds - holdElapsed)
          : blackRemainingSeconds,
        whiteToMove: nextPlayerIsWhite,
        blackToMove: nextPlayerIsBlack,
        evalCp: moveEval,
      };

      saveFrame(renderStaticFrame(boardStates[i + 1], move, i + 1, move.san, totalMoves));
    }

    process.stdout.write(`\r  Animated move ${i + 1} / ${totalMoves}`);
  }
  drawMoveLabel.meta = null;
  console.log(`\n  All frames rendered (${frameIndex} total).`);

  const totalVideoDuration = frameIndex / VIDEO_FPS;
  soundEvents.push({ timestamp: totalVideoDuration - 0.5, soundFile: 'game-end.mp3' });

  console.log(`Encoding to ${resolvedOutputPath} with ${soundEvents.length} sound effects …`);
  try {
    await encodeVideoWithAudio(
      path.join(framesDir, 'frame_%06d.png'),
      soundEvents,
      totalVideoDuration,
      resolvedOutputPath,
    );
    console.log(`Done! Video saved to: ${resolvedOutputPath}`);
  } finally {
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
  }
}

async function renderPayloadToVideo(payload, outputPath) {
  const parsedGame = normalizeRenderPayload(payload);
  return renderGame(parsedGame, outputPath);
}

module.exports = {
  encodeVideoWithAudio,
  pgnToVideo,
  renderGame,
  renderPayloadToVideo,
};
