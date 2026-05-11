#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

const PIECE_SETS = [
  'alpha', 'anarcandy', 'caliente', 'california', 'cardinal', 'cburnett',
  'celtic', 'chess7', 'chessnut', 'companion', 'cooke', 'disguised',
  'dubrovny', 'fantasy', 'firi', 'fresca', 'gioco', 'governor', 'horsey',
  'icpieces', 'kiwen-suwi', 'kosal', 'leipzig', 'letter', 'maestro',
  'merida', 'monarchy', 'mono', 'mpchess', 'pirouetti', 'pixel',
  'reillycraig', 'rhosgfx', 'riohacha', 'shahi-ivory-brown', 'shapes',
  'spatial', 'staunty', 'tatiana', 'xkcd'
];

const PIECES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];

const piecesDir = path.join(__dirname, 'assets', 'pieces');
fs.mkdirSync(piecesDir, { recursive: true });

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

async function downloadPieceSet(setName) {
  const setDir = path.join(piecesDir, setName);
  fs.mkdirSync(setDir, { recursive: true });

  console.log(`\nDownloading ${setName}...`);
  let success = 0;
  let failed = 0;

  for (const piece of PIECES) {
    const url = `https://lichess1.org/assets/piece/${setName}/${piece}.svg`;
    const destPath = path.join(setDir, `${piece}.svg`);

    try {
      await downloadFile(url, destPath);
      process.stdout.write('.');
      success++;
    } catch (err) {
      process.stdout.write('x');
      failed++;
    }
  }

  console.log(` ${success}/${PIECES.length} pieces`);
  return { success, failed };
}

async function main() {
  console.log(`Downloading ${PIECE_SETS.length} piece sets from Lichess...\n`);
  console.log(`Destination: ${piecesDir}\n`);

  let totalSuccess = 0;
  let totalFailed = 0;
  const failedSets = [];

  for (const setName of PIECE_SETS) {
    const result = await downloadPieceSet(setName);
    totalSuccess += result.success;
    totalFailed += result.failed;
    if (result.failed > 0) {
      failedSets.push(setName);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Downloaded ${totalSuccess} pieces across ${PIECE_SETS.length} sets`);
  if (totalFailed > 0) {
    console.log(`⚠️  ${totalFailed} pieces failed to download`);
    if (failedSets.length > 0) {
      console.log(`   Sets with issues: ${failedSets.join(', ')}`);
    }
  }
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
