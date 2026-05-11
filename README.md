# chess-video

Render-only chess video builder.

This repo takes either:
- legacy PGN / coordinate input, or
- a plain JSON render payload exported from `chess-db`

and turns it into an MP4.

## Inputs

### Legacy input

```bash
node index.js --legacy "e2e4 e7e5 g1f3" output.mp4
```

### Render payload

```bash
node index.js --payload /path/to/game-payload.json output.mp4
```

### Batch rendering

Place JSON payload files in the `input/` folder, then:

```bash
npm run render
```

This processes all `.json` files in `input/` and saves videos to `output/`.

## Payload shape

The payload is a plain JSON object with these fields:

```json
{
  "sourceName": "db-game-123",
  "gameMeta": {
    "whiteName": "Magnus Carlsen",
    "blackName": "Hikaru Nakamura",
    "whiteTitle": "GM",
    "blackTitle": "GM",
    "whiteRating": "2850",
    "blackRating": "2780",
    "totalTimeSeconds": 300
  },
  "moves": [
    { "san": "e4", "playedAtSeconds": 12 },
    { "san": "e5", "playedAtSeconds": 20 }
  ],
  "evals": [
    { "ply": 1, "evalCp": 18, "mateIn": null },
    { "ply": 2, "evalCp": 4, "mateIn": null }
  ]
}
```

Accepted move keys:
- `san`
- `move`
- `uci`
- `coordinate`
- `playedAtSeconds`
- `playedAt`
- `time`
- `timestamp`

Accepted eval shapes:
- array of `{ ply, evalCp, mateIn }`
- object keyed by ply number
- `Map` when used programmatically

## Notes

- Player metadata and evals are normalized in `src/render/payload.js`.
- The renderer does not talk to Postgres.
- `chess-db` is responsible for exporting the payload JSON.
