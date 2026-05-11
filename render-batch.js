#!/usr/bin/env node

const { runCli } = require('./src/render/cli');
const fs = require('fs');
const path = require('path');

const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');

if (!fs.existsSync(inputDir)) {
  console.error('Error: input/ directory not found');
  console.error('Create it with: mkdir input');
  process.exit(1);
}

const jsonFiles = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));

if (jsonFiles.length === 0) {
  console.error('No .json files found in input/ directory');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

console.log(`Found ${jsonFiles.length} JSON file(s) in input/\n`);

async function processAll() {
  for (const file of jsonFiles) {
    const inputPath = path.join(inputDir, file);
    const baseName = path.basename(file, '.json');
    const outputPath = `${baseName}.mp4`;

    console.log(`\n[${baseName}] Processing...`);

    try {
      await runCli(['--payload', inputPath, outputPath]);
      console.log(`[${baseName}] ✓ Complete`);
    } catch (err) {
      console.error(`[${baseName}] ✗ Failed: ${err.message}`);
    }
  }

  console.log('\nDone!');
}

processAll().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
