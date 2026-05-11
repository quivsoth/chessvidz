# Chess Video Renderer - Setup Guide

## Prerequisites

- **Node.js** (v18+): `node --version`
- **FFmpeg**: `ffmpeg -version`
- **Git**: `git --version`

### Install FFmpeg if needed:
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

---

## First-Time Setup

### 1. Clone the repository
```bash
git clone https://github.com/quivsoth/chessvidz
cd chessvidz
```

### 2. Install dependencies
```bash
npm install
```

### 3. Add input files
Place your JSON payload files in the `input/` folder:

```bash
# Example: Copy from chess-db
cp /path/to/chess-db/game-*.json input/

# Or manually
mkdir -p input
# Then copy your .json files into input/
```

### 4. Verify setup
```bash
# Check you have JSON files
ls input/*.json

# Should show: game-1.json, game-2.json, etc.
```

---

## Running the Renderer

### Sequential Mode (one at a time)
```bash
npm run render
```
- Uses 1 CPU core
- Good for: testing, low memory systems

### Parallel Mode (recommended)
```bash
npm run render:parallel
```
- Auto-detects CPU cores
- Uses 75% of available cores
- **Much faster** for batch rendering

**Example output:**
```
🚀 Parallel Renderer (48 workers on 64 cores)

Found 29 games to render

✓ 15  ✗ 0  ⚙ 48/48  ⏱ 5m 23s  ETA: 2m 15s  (15/29)
```

Legend:
- `✓` Completed successfully
- `✗` Failed
- `⚙` Active workers
- `⏱` Elapsed time
- `ETA` Estimated time remaining

### Custom Worker Count
```bash
node parallel-render.js 32   # Use exactly 32 workers
node parallel-render.js 16   # Use 16 workers
```

**Finding optimal worker count:**
- Check cores: `node -e "console.log(require('os').cpus().length)"`
- Use 75-90% of core count
- 64 cores → 48-58 workers
- 32 cores → 24-28 workers
- 16 cores → 12-14 workers

---

## Performance Estimates

| Machine      | Cores | Workers | Time (29 videos) |
|--------------|-------|---------|------------------|
| Laptop       | 12    | 9       | ~45-60 min       |
| Workstation  | 32    | 24      | ~15-20 min       |
| Server       | 64    | 48      | ~10-15 min       |

*Assuming ~10 min per video on single core*

---

## Output

Videos are saved to `output/` folder:
```bash
ls -lh output/*.mp4          # List rendered videos
du -sh output/               # Check total size
```

Each video is H.264 encoded at 24 FPS (740x712).

---

## Monitoring & Control

### Check progress
```bash
# In another terminal
watch -n 5 'ls output/*.mp4 | wc -l'   # Count completed videos
htop                                    # Monitor CPU usage
```

### Stop rendering
```bash
Ctrl+C   # Kills parent process + all child workers
```

### Resume after stopping
Currently renders all files - will re-process existing videos.
*TODO: Add skip-existing feature*

---

## Troubleshooting

### "ENOTEMPTY: directory not empty"
The frames cleanup has issues on some systems. Ignore this - videos still render successfully.

### FFmpeg errors (exit code 187, 254)
- Check: `ffmpeg -version` works
- Ensure canvas dimensions are even numbers (code handles this automatically)

### Out of memory
Reduce worker count:
```bash
node parallel-render.js 8   # Use fewer workers
```

### Slow rendering
- Check disk I/O: `iostat -x 1`
- Try fewer workers if disk is bottleneck
- Check FFmpeg isn't CPU-limited: `top`

### No videos in output/
- Check input files exist: `ls input/*.json`
- Check for errors in terminal output
- Try sequential mode first: `npm run render`

---

## Quick Reference

```bash
# First time
git clone https://github.com/quivsoth/chessvidz
cd chessvidz
npm install

# Add input files
cp /path/to/games/*.json input/

# Render (auto mode)
npm run render:parallel

# Render (custom workers)
node parallel-render.js 48

# Check output
ls output/*.mp4
```

---

## Project Structure

```
chessvidz/
├── input/              # Place .json payloads here
├── output/             # Rendered .mp4 videos
├── assets/             # Sound effects
├── src/render/
│   ├── cli.js         # CLI argument parsing
│   ├── draw.js        # Canvas rendering
│   ├── shared.js      # Constants & utilities
│   ├── video.js       # Frame generation & FFmpeg
│   └── payload.js     # JSON normalization
├── index.js           # Single video entry point
├── render-batch.js    # Sequential batch renderer
└── parallel-render.js # Parallel batch renderer
```

---

## Next Steps

1. Pull latest code: `git pull`
2. Install deps: `npm install`
3. Add JSON files to `input/`
4. Run: `npm run render:parallel`
5. Check `output/` for videos

Need help? Check the main [README.md](README.md) for payload format and features.
