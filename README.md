# Concord Table Tennis Club

Static site for CTTC with parsed round-robin session data.

## Local Development

```sh
npm install
npm run refresh:data
npm start
```

The local server runs at `http://localhost:3000` unless `PORT` is set.

## Session Data Updates

`npm run refresh:data` rebuilds `data/sessions.json`, fetches the linked Google Drive HTML reports, and writes the parsed JSON files used by the archive and leaderboard.

`scripts/build-sessions.js` discovers report files by scraping the public RR Archives page on the old CTTC Google Sites site, then recursively reading the public embedded Drive folder pages found there. No Google Drive API key or folder ID is required. If the old site scrape fails, the script falls back to the curated report list in the script so builds still complete.

The GitHub Actions workflow runs after Monday and Wednesday sessions and also supports manual dispatch.
