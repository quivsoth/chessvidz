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

// Check for verbose flag
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

console.log(`\n🚀 Parallel Renderer (${workers} workers on ${os.cpus().length} cores)`);
if (VERBOSE) console.log('   Verbose mode enabled\n');
else console.log('   Tip: Use --verbose for detailed output\n');

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
  }))
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

if (jsonFiles.length === 0) {
  console.error('No .json files found in input/ directory');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

console.log(`Found ${jsonFiles.length} games to render\n`);

const queue = [...jsonFiles];
const activeWorkers = new Map();
const completedGames = [];
const failedGames = [];
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

let lastStatusUpdate = 0;

function updateStatus(force = false) {
  const now = Date.now();

  // In verbose mode, only update status every 10 seconds unless forced
  if (VERBOSE && !force && now - lastStatusUpdate < 10000) {
    return;
  }

  lastStatusUpdate = now;
  const elapsed = now - results.startTime;
  const rate = results.completed / (elapsed / 1000);
  const remaining = results.total - results.completed - results.failed;
  const eta = remaining > 0 && rate > 0 ? formatTime((remaining / rate) * 1000) : 'calculating...';

  if (!VERBOSE) {
    // Compact single-line status
    process.stdout.write('\r\x1b[K'); // Clear line
    process.stdout.write(
      `✓ ${results.completed}  ✗ ${results.failed}  ⚙ ${activeWorkers.size}/${workers}  ` +
      `⏱ ${formatTime(elapsed)}  ETA: ${eta}  (${results.completed + results.failed}/${results.total})`
    );
  } else {
    // Verbose mode - periodic status summary on new line
    const activeList = Array.from(activeWorkers.values())
      .map(w => w.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, 5)
      .join(', ');
    const more = activeWorkers.size > 5 ? ` +${activeWorkers.size - 5} more` : '';

    console.log(
      `\n📊 Status: ✓ ${results.completed}  ✗ ${results.failed}  ` +
      `⚙ Active[${activeWorkers.size}]: ${activeList}${more}  ` +
      `⏱ ${formatTime(elapsed)}  ETA: ${eta}\n`
    );
  }
}

function renderNext() {
  if (queue.length === 0) {
    if (activeWorkers.size === 0) {
      // All done
      const elapsed = Date.now() - results.startTime;
      console.log('\n\n' + '='.repeat(70));
      console.log(`✅ Complete! Rendered ${results.completed}/${results.total} games in ${formatTime(elapsed)}`);

      if (results.failed > 0) {
        console.log(`\n⚠️  ${results.failed} failed:`);
        failedGames.forEach(({ name, error }) => {
          console.log(`   ❌ ${name}: ${error}`);
        });
      }

      if (VERBOSE && completedGames.length > 0) {
        const avgTime = completedGames.reduce((sum, g) => sum + g.duration, 0) / completedGames.length;
        console.log(`\n📊 Statistics:`);
        console.log(`   Average render time: ${formatTime(avgTime)}`);
        console.log(`   Fastest: ${completedGames[0].name} (${formatTime(completedGames[0].duration)})`);
        console.log(`   Slowest: ${completedGames[completedGames.length - 1].name} (${formatTime(completedGames[completedGames.length - 1].duration)})`);
      }

      console.log('='.repeat(70) + '\n');
      process.exit(results.failed > 0 ? 1 : 0);
    }
    return;
  }

  const job = queue.shift();

  if (VERBOSE) {
    console.log(`▶️  Starting: ${job.name} (${queue.length} remaining in queue)`);
  }

  const child = fork(path.join(__dirname, 'index.js'), [
    '--payload',
    job.input,
    job.output
  ], {
    stdio: VERBOSE ? ['ignore', 'pipe', 'pipe', 'ipc'] : 'ignore'
  });

  if (VERBOSE) {
    // Stream output with game name prefix
    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`   [${job.name}] ${line}`);
        }
      });
    });

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`   [${job.name}] ${line}`);
        }
      });
    });
  }

  const workerData = {
    name: job.name,
    startTime: Date.now()
  };

  activeWorkers.set(child.pid, workerData);

  child.on('exit', (code) => {
    const worker = activeWorkers.get(child.pid);
    activeWorkers.delete(child.pid);

    const duration = Date.now() - worker.startTime;

    if (code === 0) {
      results.completed++;
      completedGames.push({ name: job.name, duration });
      completedGames.sort((a, b) => a.duration - b.duration);

      if (VERBOSE) {
        console.log(`✅ [${job.name}] Complete in ${formatTime(duration)}`);
      }
    } else {
      results.failed++;
      const errorMsg = `exit code ${code}`;
      failedGames.push({ name: job.name, error: errorMsg });

      // Always show failures
      console.log(`\n❌ [${job.name}] Failed: ${errorMsg}`);
    }

    updateStatus(true); // Force update on completion
    renderNext();
  });

  child.on('error', (err) => {
    activeWorkers.delete(child.pid);
    results.failed++;
    failedGames.push({ name: job.name, error: err.message });

    // Always show errors
    console.log(`\n❌ [${job.name}] Error: ${err.message}`);

    updateStatus(true); // Force update on error
    renderNext();
  });
}

// Start workers
console.log('Starting workers...\n');
for (let i = 0; i < Math.min(workers, jsonFiles.length); i++) {
  renderNext();
}

// Periodic status updates in verbose mode
if (VERBOSE) {
  setInterval(() => {
    if (activeWorkers.size > 0) {
      updateStatus(true);
    }
  }, 30000); // Every 30 seconds
}
