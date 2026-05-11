#!/usr/bin/env node

const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');

// Use 75% of available cores, or at least 1
const MAX_WORKERS = Math.max(1, Math.floor(os.cpus().length * 0.75));
const workers = parseInt(process.argv[2]) || MAX_WORKERS;

console.log(`\n🚀 Parallel Renderer (${workers} workers on ${os.cpus().length} cores)\n`);

if (!fs.existsSync(inputDir)) {
  console.error('Error: input/ directory not found');
  process.exit(1);
}

const jsonFiles = fs.readdirSync(inputDir)
  .filter(f => f.endsWith('.json'))
  .map(f => ({
    input: path.join(inputDir, f),
    output: path.basename(f, '.json') + '.mp4',
    name: path.basename(f, '.json')
  }));

if (jsonFiles.length === 0) {
  console.error('No .json files found in input/ directory');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

console.log(`Found ${jsonFiles.length} games to render\n`);

const queue = [...jsonFiles];
const activeWorkers = new Map();
const results = {
  completed: 0,
  failed: 0,
  total: jsonFiles.length,
  startTime: Date.now()
};

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function updateStatus() {
  const elapsed = Date.now() - results.startTime;
  const rate = results.completed / (elapsed / 1000);
  const remaining = results.total - results.completed - results.failed;
  const eta = remaining > 0 && rate > 0 ? formatTime((remaining / rate) * 1000) : 'calculating...';

  process.stdout.write('\r\x1b[K'); // Clear line
  process.stdout.write(
    `✓ ${results.completed}  ✗ ${results.failed}  ⚙ ${activeWorkers.size}/${workers}  ` +
    `⏱ ${formatTime(elapsed)}  ETA: ${eta}  (${results.completed + results.failed}/${results.total})`
  );
}

function renderNext() {
  if (queue.length === 0) {
    if (activeWorkers.size === 0) {
      // All done
      const elapsed = Date.now() - results.startTime;
      console.log('\n\n' + '='.repeat(60));
      console.log(`✅ Complete! Rendered ${results.completed}/${results.total} games in ${formatTime(elapsed)}`);
      if (results.failed > 0) {
        console.log(`⚠️  ${results.failed} failed`);
      }
      console.log('='.repeat(60) + '\n');
      process.exit(results.failed > 0 ? 1 : 0);
    }
    return;
  }

  const job = queue.shift();
  const child = fork(path.join(__dirname, 'index.js'), [
    '--payload',
    job.input,
    job.output
  ], {
    stdio: 'ignore' // Suppress child output
  });

  activeWorkers.set(child.pid, { name: job.name, startTime: Date.now() });

  child.on('exit', (code) => {
    activeWorkers.delete(child.pid);

    if (code === 0) {
      results.completed++;
    } else {
      results.failed++;
      console.log(`\n❌ [${job.name}] Failed (exit code ${code})`);
    }

    updateStatus();
    renderNext();
  });

  child.on('error', (err) => {
    activeWorkers.delete(child.pid);
    results.failed++;
    console.log(`\n❌ [${job.name}] Error: ${err.message}`);
    updateStatus();
    renderNext();
  });

  updateStatus();
}

// Start workers
for (let i = 0; i < Math.min(workers, jsonFiles.length); i++) {
  renderNext();
}
