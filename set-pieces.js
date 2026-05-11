#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');

const AVAILABLE_SETS = [
  'alpha', 'anarcandy', 'caliente', 'california', 'cardinal', 'cburnett',
  'celtic', 'chess7', 'chessnut', 'companion', 'cooke', 'disguised',
  'dubrovny', 'fantasy', 'firi', 'fresca', 'gioco', 'governor', 'horsey',
  'icpieces', 'kiwen-suwi', 'kosal', 'leipzig', 'letter', 'maestro',
  'merida', 'monarchy', 'mono', 'mpchess', 'pirouetti', 'pixel',
  'reillycraig', 'rhosgfx', 'riohacha', 'shahi-ivory-brown', 'shapes',
  'spatial', 'staunty', 'tatiana', 'xkcd'
];

const requestedSet = process.argv[2];

if (!requestedSet) {
  console.log('Usage: node set-pieces.js <piece-set-name>');
  console.log('\nAvailable sets:');
  AVAILABLE_SETS.forEach((set, idx) => {
    process.stdout.write(`  ${set.padEnd(20)}`);
    if ((idx + 1) % 3 === 0) console.log('');
  });
  console.log('\n\nRecommended sets:');
  console.log('  staunty     - Traditional Staunton style');
  console.log('  cburnett    - Clean modern (default)');
  console.log('  merida      - Tournament style');
  console.log('  maestro     - Classic elegant');
  console.log('  alpha       - Simple and clean');
  process.exit(0);
}

if (!AVAILABLE_SETS.includes(requestedSet)) {
  console.error(`Error: "${requestedSet}" is not a valid piece set.`);
  console.log('\nAvailable sets:', AVAILABLE_SETS.join(', '));
  process.exit(1);
}

// Check if pieces are downloaded
const piecesDir = path.join(__dirname, 'assets', 'pieces', requestedSet);
if (!fs.existsSync(piecesDir)) {
  console.error(`\nError: Piece set "${requestedSet}" not found locally.`);
  console.log('Run: node download-pieces.js');
  process.exit(1);
}

// Update config
let config = { pieceSet: 'cburnett', availableSets: AVAILABLE_SETS };
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.warn('Could not parse existing config, creating new one');
  }
}

config.pieceSet = requestedSet;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log(`✅ Piece set changed to: ${requestedSet}`);
console.log(`   All new renders will use the "${requestedSet}" pieces.`);
