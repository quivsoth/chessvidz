# Titled Tuesday Ingestion

This script fetches Chess.com Titled Tuesday tournament games via the Chess.com API and ingests them into your database.

## What is Titled Tuesday?

Titled Tuesday is a weekly blitz tournament on Chess.com featuring titled players (GMs, IMs, FMs, etc.). It runs every Tuesday with thousands of high-level games.

## Quick Start

```bash
# Fetch first 50 games from each tournament (default)
npm run fetch:titled-tuesday

# Fetch first 100 games from each tournament
node scripts/fetch-titled-tuesday.js 100
```

## What It Does

1. **Fetches** games from Chess.com Titled Tuesday tournaments via their public API
2. **Parses** PGN data (moves, players, metadata, ratings)
3. **Ingests** games into your Postgres database
4. **Handles** duplicates automatically
5. **Rate-limits** requests to avoid API throttling (600ms delay between requests)

## Data Source

- **API**: Chess.com Published Data API
- **Tournaments**: 18 recent tournaments from Jan-May 2026
- **Format**: PGN fetched on-demand from Chess.com
- **Players**: Top GMs including Carlsen, Nakamura, Caruana, and hundreds more

## Database Storage

Games are stored with:
- **Provider**: `titled-tuesday`
- **Source tracking**: Each file creates a batch ingestion run
- **Deduplication**: Automatically skips duplicate games
- **Move timing**: Estimated based on typical blitz time controls

## Output Example

```
🏆 Chess.com Titled Tuesday Fetcher

Settings:
  - Max games per tournament: 50
  - Rate limit delay: 600ms
  - Tournaments to process: 18

============================================================
📋 Tournament: titled-tuesday-blitz-may-05-2026-6412037
============================================================
  Fetching round 1...
  Found 343 games, fetching first 50...

  ✅ Progress: 10/50 games imported
  ✅ Progress: 20/50 games imported
  ✅ Progress: 30/50 games imported
  ✅ Progress: 40/50 games imported
  ✅ Progress: 50/50 games imported

  📊 Tournament Summary:
     Imported: 50
     Skipped:  0 (duplicates)
     Errors:   0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 FINAL SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tournaments processed: 18
Games imported:        900
Games skipped:         0 (duplicates)
Errors:                0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Done!
```

## Subsequent Runs

The script automatically:
- **Skips** already-imported games (duplicate detection via hash)
- Safely re-run to fetch new tournaments

## Rate Limits

Chess.com API limits:
- Max 2 simultaneous requests
- Script includes 600ms delay between requests
- Fetching 50 games per tournament takes ~30-40 seconds

## Adding More Tournaments

Edit `TOURNAMENT_IDS` in `scripts/fetch-titled-tuesday.js` to add tournament IDs.

Find tournaments at: https://www.chess.com/tournament/live/titled-tuesdays

## Querying Titled Tuesday Games

```bash
# Via API
curl "http://localhost:3001/games?q=carlsen&limit=50"

# Via Database
docker exec chess_video_postgres psql -U postgres -d chess_video -c "
  SELECT 
    wp.display_name as white, 
    bp.display_name as black, 
    g.event, 
    g.result 
  FROM games g 
  JOIN players wp ON g.white_player_id = wp.id 
  JOIN players bp ON g.black_player_id = bp.id 
  JOIN sources s ON g.source_id = s.id 
  WHERE s.provider = 'titled-tuesday'
  LIMIT 10;
"
```

## Rendering Titled Tuesday Games

Once imported, you can render any game to video:

```bash
# Find a game ID
curl "http://localhost:3001/games?q=nakamura"

# Render it
curl -X POST "http://localhost:3001/render/game/123" \
  -H "Content-Type: application/json" \
  -d '{"output":"titled-tuesday-nakamura.mp4"}'
```
