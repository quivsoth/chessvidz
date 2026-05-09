# Database Setup (Postgres + MinIO)

This project uses Postgres as the primary game store.
MinIO is available for raw-source/object-storage expansion later.

## 1) Start services

```bash
npm run db:up
```

Postgres:
- Host: `localhost`
- Port: `5432`
- DB: `chess_video`
- User: `postgres`
- Password: `postgres`

MinIO:
- API: `http://localhost:9000`
- Console: `http://localhost:9001`
- User: `minio`
- Password: `minio123`

## 2) Run migrations

```bash
npm run db:migrate
```

## 3) Start API for direct ingestion/render

```bash
npm run api:start
```

Use the API endpoints documented in `API.md`:
- ingest from Lichess directly into Postgres
- ingest from PGN directly into Postgres
- render DB games to MP4

## Schema overview

- `sources`: source system records (Lichess, PGN, etc.)
- `players`: normalized player dimension with optional title
- `games`: per-game metadata + dedupe hash
- `game_moves`: one row per ply
- `game_evals`: stored Stockfish evals per ply
- `ingest_runs`: ingestion run tracking
- `schema_migrations`: migration tracking

`game_evals.depth` is part of the analysis state:
- same depth: resume or skip
- different depth: recompute for that game
