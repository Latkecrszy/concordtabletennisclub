// Run: node scripts/fetch-and-parse.js
// Fetches CTTC session report HTML from Drive and writes parsed JSON data.

const fs = require('fs/promises');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ALIASES_FILE = path.join(DATA_DIR, 'player-aliases.json');
const REQUEST_DELAY_MS = Number(process.env.CTTC_FETCH_DELAY_MS || 1000);
const IGNORED_PLAYER_KEYS = new Set([
  'do-not-use do-not-use'
]);

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  const text = cleanText(value);
  if (!text || text === '_') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function normalizeNameKey(name) {
  return cleanText(name).toLowerCase();
}

function isIgnoredPlayer(name) {
  return IGNORED_PLAYER_KEYS.has(normalizeNameKey(name));
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function driveDownloadUrl(fileId) {
  return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fileId);
}

async function fetchSessionHtml(session) {
  const response = await fetch(driveDownloadUrl(session.fileId), {
    redirect: 'follow',
    headers: { 'User-Agent': 'cttc-session-parser/1.0' }
  });

  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' fetching ' + session.date);
  }

  const html = await response.text();
  if (!/Group\s+\d+/i.test(html)) {
    throw new Error('Downloaded file for ' + session.date + ' does not look like a session report');
  }
  return html;
}

function mode(values) {
  const counts = new Map();
  values.forEach(function (value) {
    if (Number.isInteger(value) && value >= 0) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  });

  let best = null;
  let bestCount = -1;
  counts.forEach(function (count, value) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  });
  return best;
}

function nextTableForHeading($, heading) {
  const $heading = $(heading);
  const $container = $heading.parent().is('p') ? $heading.parent() : $heading;
  const $table = $container.nextAll('table').first();
  return $table.length ? $table : $heading.nextAll('table').first();
}

function readRows($, table) {
  const rows = [];
  const seenRows = new Set();
  $(table).find('tr').each(function (_idx, tr) {
    const cells = $(tr).children('td,th').map(function (_cellIdx, cell) {
      return cleanText($(cell).text());
    }).get();
    const rawName = cleanText(cells[0]);
    const rowKey = cells.join('\u0000');

    if (!rawName || cells.length < 5) return;
    if (seenRows.has(rowKey)) return;
    seenRows.add(rowKey);
    rows.push({ rawName: rawName, cells: cells });
  });
  return rows;
}

function parseSummaryOnlyGroup(name, rows) {
  return {
    name: name,
    players: rows.map(function (row) {
      const trailingOffset = cleanText(row.cells[row.cells.length - 1]) === '' ? 1 : 0;
      const ratingAfter = parseNumber(row.cells[row.cells.length - 1 - trailingOffset]);
      const ratingAdj = parseNumber(row.cells[row.cells.length - 2 - trailingOffset]) || 0;

      return {
        name: row.rawName,
        wins: null,
        losses: null,
        gamesWon: parseNumber(row.cells[1]) || 0,
        gamesLost: parseNumber(row.cells[2]) || 0,
        ratingBefore: ratingAfter === null ? null : ratingAfter - ratingAdj,
        ratingAfter: ratingAfter,
        ratingAdj: ratingAdj,
        matches: [],
        matchesUnavailable: true
      };
    })
  };
}

function trailingRatingColumns(cells) {
  let ratingIndex = cells.length - 1;
  while (ratingIndex >= 0 && cleanText(cells[ratingIndex]) === '') {
    ratingIndex -= 1;
  }
  return {
    ratingAdjIndex: ratingIndex - 1,
    ratingAfterIndex: ratingIndex
  };
}

function parseGroup($, heading) {
  const name = cleanText($(heading).text());
  const rows = readRows($, nextTableForHeading($, heading));
  const groupSize = rows.length;
  if (!groupSize) return null;

  if (rows.some(function (row) { return row.cells.indexOf('_') === -1; })) {
    return parseSummaryOnlyGroup(name, rows);
  }

  const matchStart = mode(rows.map(function (row, rowIndex) {
    return row.cells.indexOf('_') - rowIndex;
  }));
  const adjStart = mode(rows.map(function (row, rowIndex) {
    return row.cells.lastIndexOf('_') - rowIndex;
  }));

  if (matchStart === null || adjStart === null) return null;

  const players = rows.map(function (row, rowIndex) {
    const matches = [];
    const ratingColumns = trailingRatingColumns(row.cells);

    rows.forEach(function (opponentRow, opponentIndex) {
      if (opponentIndex === rowIndex) return;

      const gamesWon = parseNumber(row.cells[matchStart + opponentIndex]);
      const gamesLost = parseNumber(opponentRow.cells[matchStart + rowIndex]);
      const adj = parseNumber(row.cells[adjStart + opponentIndex]);

      matches.push({
        opponent: opponentRow.rawName,
        gamesWon: gamesWon || 0,
        gamesLost: gamesLost || 0,
        adj: adj || 0
      });
    });

    const ratingAdj = parseNumber(row.cells[ratingColumns.ratingAdjIndex]) || 0;
    const ratingAfter = parseNumber(row.cells[ratingColumns.ratingAfterIndex]);
    const wins = matches.filter(function (match) {
      return match.gamesWon > match.gamesLost;
    }).length;
    const losses = matches.filter(function (match) {
      return match.gamesLost > match.gamesWon;
    }).length;
    const gamesWon = matches.reduce(function (total, match) {
      return total + match.gamesWon;
    }, 0);
    const gamesLost = matches.reduce(function (total, match) {
      return total + match.gamesLost;
    }, 0);

    return {
      name: row.rawName,
      wins: wins,
      losses: losses,
      gamesWon: gamesWon,
      gamesLost: gamesLost,
      ratingBefore: ratingAfter === null ? null : ratingAfter - ratingAdj,
      ratingAfter: ratingAfter,
      ratingAdj: ratingAdj,
      matches: matches
    };
  });

  return { name: name, players: players };
}

function parseSessionHtml(html, session) {
  const $ = cheerio.load(html);
  const groups = [];

  $('h2,h3,h4').each(function (_idx, heading) {
    if (!/^Group\s+\d+$/i.test(cleanText($(heading).text()))) return;
    const group = parseGroup($, heading);
    if (group) groups.push(group);
  });

  return {
    date: session.date,
    fileId: session.fileId,
    groups: groups
  };
}

function buildCanonicalizer(sessions, aliases) {
  const aliasByKey = new Map();
  Object.entries(aliases || {}).forEach(function ([from, to]) {
    aliasByKey.set(normalizeNameKey(from), cleanText(to));
  });

  const variantsByKey = new Map();
  sessions.forEach(function (session) {
    session.groups.forEach(function (group) {
      group.players.forEach(function (player) {
        const name = cleanText(player.name);
        const key = normalizeNameKey(name);
        if (!variantsByKey.has(key)) variantsByKey.set(key, new Map());
        const variants = variantsByKey.get(key);
        variants.set(name, (variants.get(name) || 0) + 1);
      });
    });
  });

  const canonicalByKey = new Map();
  variantsByKey.forEach(function (variants, key) {
    let bestName = null;
    let bestCount = -1;
    variants.forEach(function (count, name) {
      if (count > bestCount || (count === bestCount && name.localeCompare(bestName || '') < 0)) {
        bestName = name;
        bestCount = count;
      }
    });
    canonicalByKey.set(key, bestName);
  });

  return function canonicalName(name) {
    const cleaned = cleanText(name);
    const key = normalizeNameKey(cleaned);
    return aliasByKey.get(key) || canonicalByKey.get(key) || cleaned;
  };
}

function groupPlayerNames(group, canonicalName) {
  const baseNames = group.players.map(function (player) {
    return canonicalName(player.name);
  });
  const counts = new Map();

  baseNames.forEach(function (name) {
    if (isIgnoredPlayer(name)) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });

  const seen = new Map();
  return baseNames.map(function (name) {
    const count = counts.get(name) || 0;
    if (count <= 1) return name;

    const index = (seen.get(name) || 0) + 1;
    seen.set(name, index);
    return index === 1 ? name : name + ' (' + index + ')';
  });
}

function applyCanonicalNames(sessions, canonicalName) {
  return sessions.map(function (session) {
    const canonicalSession = {
      date: session.date,
      fileId: session.fileId,
      groups: session.groups.map(function (group) {
        const names = groupPlayerNames(group, canonicalName);
        return {
          name: group.name,
          players: group.players.map(function (player, playerIndex) {
            const name = names[playerIndex];
            if (isIgnoredPlayer(name)) return null;
            const matchesUnavailable = Boolean(player.matchesUnavailable);
            const opponentIndexes = group.players.map(function (_opponent, opponentIndex) {
              return opponentIndex;
            }).filter(function (opponentIndex) {
              return opponentIndex !== playerIndex;
            });
            const matches = player.matches.map(function (match, matchIndex) {
              const opponentIndex = opponentIndexes[matchIndex];
              return {
                opponent: names[opponentIndex] || canonicalName(match.opponent),
                gamesWon: match.gamesWon,
                gamesLost: match.gamesLost,
                adj: match.adj
              };
            }).filter(function (match) {
              return !isIgnoredPlayer(match.opponent);
            });

            return {
              name: name,
              wins: matchesUnavailable ? null : matches.filter(function (match) { return match.gamesWon > match.gamesLost; }).length,
              losses: matchesUnavailable ? null : matches.filter(function (match) { return match.gamesLost > match.gamesWon; }).length,
              gamesWon: player.gamesWon,
              gamesLost: player.gamesLost,
              ratingBefore: player.ratingBefore,
              ratingAfter: player.ratingAfter,
              ratingAdj: player.ratingAdj,
              matches: matches,
              matchesUnavailable: matchesUnavailable
            };
          }).filter(Boolean)
        };
      }).filter(function (group) {
        return group.players.length > 0;
      })
    };
    if (session.error) canonicalSession.error = session.error;
    return canonicalSession;
  });
}

function ensurePlayer(playersByName, name) {
  if (!playersByName.has(name)) {
    playersByName.set(name, {
      name: name,
      currentRating: null,
      peakRating: null,
      sessionsPlayed: 0,
      totalWins: 0,
      totalLosses: 0,
      ratingHistory: [],
      headToHead: {}
    });
  }
  return playersByName.get(name);
}

function recordHeadToHead(player, opponentName, won, lost) {
  if (won === lost) return;
  if (!player.headToHead[opponentName]) {
    player.headToHead[opponentName] = { wins: 0, losses: 0 };
  }
  if (won > lost) player.headToHead[opponentName].wins += 1;
  if (lost > won) player.headToHead[opponentName].losses += 1;
}

function buildPlayers(sessions) {
  const playersByName = new Map();

  sessions.slice().sort(function (a, b) {
    return a.date.localeCompare(b.date);
  }).forEach(function (session) {
    session.groups.forEach(function (group) {
      group.players.forEach(function (playerResult) {
        const player = ensurePlayer(playersByName, playerResult.name);
        player.sessionsPlayed += 1;
        player.totalWins += playerResult.wins;
        player.totalLosses += playerResult.losses;

        if (Number.isFinite(playerResult.ratingAfter)) {
          player.currentRating = playerResult.ratingAfter;
          player.peakRating = Math.max(player.peakRating || playerResult.ratingAfter, playerResult.ratingAfter);
          player.ratingHistory.push({ date: session.date, rating: playerResult.ratingAfter });
        }

        playerResult.matches.forEach(function (match) {
          recordHeadToHead(player, match.opponent, match.gamesWon, match.gamesLost);
        });
      });
    });
  });

  return Array.from(playersByName.values()).sort(function (a, b) {
    if ((b.currentRating || 0) !== (a.currentRating || 0)) {
      return (b.currentRating || 0) - (a.currentRating || 0);
    }
    return a.name.localeCompare(b.name);
  });
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

async function main() {
  const sessions = await readJson(SESSIONS_FILE, []);
  const aliases = await readJson(ALIASES_FILE, {});
  const parsed = [];
  const failures = [];

  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    process.stdout.write('Fetching ' + session.date + ' (' + (i + 1) + '/' + sessions.length + ')\n');
    try {
      const html = await fetchSessionHtml(session);
      parsed.push(parseSessionHtml(html, session));
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      failures.push({ date: session.date, fileId: session.fileId, error: message });
      parsed.push({
        date: session.date,
        fileId: session.fileId,
        groups: [],
        error: message
      });
      process.stderr.write('Warning: ' + session.date + ' skipped: ' + message + '\n');
    }
    if (REQUEST_DELAY_MS > 0 && i < sessions.length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  if (sessions.length && parsed.every(function (session) { return session.groups.length === 0; })) {
    throw new Error('No session reports were parsed');
  }

  const canonicalName = buildCanonicalizer(parsed, aliases);
  const details = applyCanonicalNames(parsed, canonicalName).sort(function (a, b) {
    return b.date.localeCompare(a.date);
  });

  const years = new Map();
  details.forEach(function (session) {
    const year = session.date.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(session);
  });

  for (const [year, yearSessions] of years.entries()) {
    await writeJson(path.join(DATA_DIR, 'session-details-' + year + '.json'), yearSessions);
  }

  const latestSessionDate = details.length > 0 ? details[0].date : null;
  const generatedAt = new Date().toISOString().slice(0, 10);

  await writeJson(path.join(DATA_DIR, 'players.json'), {
    generatedAt,
    latestSessionDate,
    players: buildPlayers(details)
  });

  await writeJson(path.join(DATA_DIR, 'site-status.json'), { generatedAt, latestSessionDate });

  if (failures.length) {
    process.stderr.write('Completed with ' + failures.length + ' unavailable session report(s).\n');
  }
}

if (require.main === module) {
  main().catch(function (err) {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseSessionHtml,
  buildCanonicalizer,
  applyCanonicalNames,
  buildPlayers
};
