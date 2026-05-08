# Direct Ingestion API (No JSON Required)

This API ingests games directly into Postgres from Lichess or PGN files.

## Start

```bash
npm run api:start
```

Default URL: `http://localhost:3001`

## Endpoints

### Health

`GET /health`

Checks API + DB connectivity.

### List games

`GET /games?limit=20&offset=0&q=fischer`

Returns DB games with player/event filters.

### Ingest from Lichess directly to DB

`POST /ingest/lichess`

Body:

```json
{
  "username": "MagnusCarlsen",
  "max": 20,
  "perf": "all"
}
```

Notes:
- `perf` can be `all` or Lichess perf names (`rapid`, `blitz`, etc.)
- No JSON file intermediary is created.

### Ingest from local PGN directly to DB

`POST /ingest/pgn`

Body:

```json
{
  "filePath": "/absolute/path/to/games.pgn",
  "maxGames": 100
}
```

Notes:
- PGN is parsed and inserted directly to DB.
- Move timing is estimated for PGN sources unless clocks are available.

### Render a DB game to video

`POST /render/game/:id`

Renders a game already in Postgres by `games.id`.

Body (optional):

```json
{
  "output": "my-video.mp4"
}
```

Example:

```bash
curl -X POST "http://localhost:3001/render/game/22" \
  -H "Content-Type: application/json" \
  -d '{"output":"game-22.mp4"}'
```

Response includes the generated file path under `output/`.
