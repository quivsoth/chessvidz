const { pgnToVideo, renderPayloadToVideo } = require('./video');
const { readRenderPayload } = require('./payload');

async function runCli(args) {
  if (args[0] === '--legacy') {
    if (args.length < 2) {
      throw new Error('Usage: node index.js --legacy "<pgn-or-coords>" [output.mp4]');
    }
    await pgnToVideo(args[1], args[2] || 'chess_game.mp4');
    return;
  }

  if (args[0] === '--payload') {
    if (args.length < 2) {
      throw new Error('Usage: node index.js --payload <payload.json> [output.mp4]');
    }
    const payload = readRenderPayload(args[1]);
    await renderPayloadToVideo(payload, args[2] || 'rendered-game.mp4');
    return;
  }

  throw new Error('Usage: node index.js --payload <payload.json> [output.mp4] OR node index.js --legacy "<pgn-or-coords>" [output.mp4]');
}

module.exports = {
  runCli,
};
