# Adding Chess Titles to Players

This is now implemented for the Titled Tuesday ingestion path:
- titles are stored in `players.title`
- Titled Tuesday imports resolve titles from the local `sources/titled-tuesday-data/ranks/*.json` files
- the renderer still falls back to parsing `GM/IM/FM/...` prefixes from `display_name` for legacy data

The notes below describe the original approach and remain useful if you want to extend titles to other sources.

## Option 1: Fetch from Chess.com Player API

Chess.com provides player profile data at:
```
GET https://api.chess.com/pub/player/{username}
```

Example response:
```json
{
  "username": "Hikaru",
  "title": "GM",
  "name": "Hikaru Nakamura",
  ...
}
```

### Implementation Steps:

1. **Add title column to players table:**
```sql
ALTER TABLE players ADD COLUMN title VARCHAR(10);
```

2. **Update fetch-titled-tuesday.js to fetch player titles:**
```javascript
async function fetchPlayerTitle(username) {
  try {
    const response = await fetch(`https://api.chess.com/pub/player/${username}`);
    if (response.ok) {
      const data = await response.json();
      return data.title || null;
    }
  } catch (err) {
    console.warn(`Could not fetch title for ${username}`);
  }
  return null;
}
```

3. **Store titles when upserting players:**
```javascript
async function upsertPlayer(client, displayName, title = null) {
  const normalizedName = normalizeName(displayName);
  const { rows } = await client.query(
    `INSERT INTO players(normalized_name, display_name, title)
     VALUES ($1, $2, $3)
     ON CONFLICT (normalized_name) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           title = EXCLUDED.title
     RETURNING id`,
    [normalizedName, displayName, title],
  );
  return rows[0].id;
}
```

4. **Update game fetching to include titles:**
```sql
SELECT 
  g.id,
  wp.display_name AS white_name,
  wp.title AS white_title,
  bp.display_name AS black_name,
  bp.title AS black_title,
  ...
FROM games g
JOIN players wp ON wp.id = g.white_player_id
JOIN players bp ON bp.id = g.black_player_id
WHERE g.id = $1
```

5. **Pass titles to rendering code:**
```javascript
const jsonData = {
  whitePlayer: gameRow.white_name,
  whiteTitle: gameRow.white_title,
  blackPlayer: gameRow.black_name,
  blackTitle: gameRow.black_title,
  ...
};
```

## Option 2: Manual Title Mapping

For well-known players, you can maintain a static mapping:

```javascript
const KNOWN_TITLES = {
  'Hikaru': 'GM',
  'MagnusCarlsen': 'GM',
  'nihalsarin': 'GM',
  'FairChess_on_YouTube': 'IM',
  // ... add more
};

function getPlayerTitle(username) {
  return KNOWN_TITLES[username] || null;
}
```

## Current Implementation

The rendering code already supports displaying titles with the correct colors:
- **GM** (orange): Grandmaster
- **IM** (teal): International Master  
- **FM** (purple): FIDE Master
- **NM** (yellow): National Master
- **CM/WCM** (white): Candidate Master / Woman Candidate Master
- **WGM** (orange): Woman Grandmaster
- **WIM** (teal): Woman International Master
- **WFM** (purple): Woman FIDE Master

Titles are parsed from the display name in the format "TITLE Name" (e.g., "GM Magnus Carlsen"). If no title is found, the name is displayed without a colored title prefix.
