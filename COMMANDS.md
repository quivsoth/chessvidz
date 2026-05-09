# Quick Commands

Common commands for this repo.

## Setup

```bash
npm install
npm run db:up
npm run db:migrate
```

## Start the API

```bash
npm run api:start
```

With live reload:

```bash
npm run dev
```

API docs:

- `http://localhost:3001/api-docs`
- `http://localhost:3001/openapi.json`

## Database

Start Postgres and MinIO:

```bash
npm run db:up
```

Stop services:

```bash
npm run db:down
```

Run migrations:

```bash
npm run db:migrate
```

## Ingest Games

Ingest from Lichess:

```bash
curl -X POST "http://localhost:3001/ingest/lichess" \
  -H "Content-Type: application/json" \
  -d '{"username":"MagnusCarlsen","max":20,"perf":"blitz"}'
```

Ingest from a local PGN file:

```bash
curl -X POST "http://localhost:3001/ingest/pgn" \
  -H "Content-Type: application/json" \
  -d '{"filePath":"/absolute/path/to/games.pgn","maxGames":100}'
```

## Render Video

Render a DB game:

```bash
curl -X POST "http://localhost:3001/render/game/123" \
  -H "Content-Type: application/json" \
  -d '{"output":"game-123.mp4"}'
```

Render directly from the CLI:

```bash
node index.js --game-id 123 output.mp4
```

Legacy input mode:

```bash
node index.js --legacy "e2e4 e7e5 g1f3" output.mp4
```

## Titled Tuesday Import

```bash
npm run fetch:titled-tuesday
node scripts/fetch-titled-tuesday.js 100
```

## Stockfish Analysis

Run the local worker:

```bash
npm run analyze:stockfish
```

Use a different depth:

```bash
STOCKFISH_DEPTH=10 npm run analyze:stockfish
```

Run the analyzer container:

```bash
docker compose --profile analysis run --rm analyzer
```

Run the analyzer container at a custom depth:

```bash
docker compose --profile analysis run --rm -e STOCKFISH_DEPTH=10 analyzer
```

Run all games in the background at a deeper depth:

```bash
ANALYZE_GAME_LIMIT=100000 STOCKFISH_DEPTH=20 docker compose --profile analysis up -d analyzer
```

## Useful Environment Variables

- `DATABASE_URL`
- `PORT`
- `STOCKFISH_PATH`
- `STOCKFISH_DEPTH`
- `ANALYZE_GAME_LIMIT`
