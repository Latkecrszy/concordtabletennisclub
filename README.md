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

`scripts/build-sessions.js` discovers report files from the public Google Drive folder, with the old CTTC Google Sites RR Archives page and a curated list as fallbacks. No Google Drive credentials are required. Networked build scripts use Node's system certificate store so they work with locally trusted TLS-inspection certificates.

Session-list updates are atomic and reject missing existing dates by default, preventing a stale fallback from replacing newer data. Set `CTTC_ALLOW_SESSION_REMOVALS=true` only when intentionally removing sessions from the archive.

## Organizer Backups

The organizer saves each date's roster, groups, promotions, and match scores in that browser's local storage. Use **Export backup** on the organizer or scorebook to download a versioned JSON backup, and **Import backup** to validate and restore it. Imports restore the date embedded in the file and ask before replacing data already saved for that date.

Players added manually in the organizer are also saved in that browser and remain available in the member list for future sessions. Session backups include those player records so importing on another browser or device makes them available there too.

Backup files are the portable path between browsers or devices until shared storage is configured. Keep them private because they contain the session roster and results.

The GitHub Actions workflow runs after Monday and Wednesday sessions and also supports manual dispatch.
