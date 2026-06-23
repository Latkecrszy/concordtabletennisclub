// Run: npm run check:data
// Reads existing session-details JSON files and writes data/parse-report.json.
// Does NOT make network requests — safe to run any time.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function tryLoadJson(file, fallback) {
  try { return loadJson(file); } catch (_) { return fallback; }
}

function loadAllSessionDetails() {
  const all = [];
  ['2024', '2025', '2026'].forEach(function (year) {
    const file = path.join(DATA_DIR, 'session-details-' + year + '.json');
    const sessions = tryLoadJson(file, []);
    sessions.forEach(function (s) { all.push(s); });
  });
  return all.sort(function (a, b) { return a.date.localeCompare(b.date); });
}

function main() {
  const sessions = loadAllSessionDetails();
  const playersData = tryLoadJson(path.join(DATA_DIR, 'players.json'), { players: [], generatedAt: null });

  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    dataBuiltAt: playersData.generatedAt || null,
    latestSessionDate: playersData.latestSessionDate || null,
    sessionsTotal: sessions.length,
    sessionsParsed: 0,
    sessionsFailed: 0,
    sessionsNoGroups: 0,
    groupsTotal: 0,
    uniquePlayers: playersData.players.length,
    matchesUnavailableCount: 0,
    suspiciousRatings: [],
    failedSessions: []
  };

  sessions.forEach(function (session) {
    if (session.error) {
      report.sessionsFailed += 1;
      report.failedSessions.push({ date: session.date, error: session.error });
      return;
    }
    if (!session.groups || session.groups.length === 0) {
      report.sessionsNoGroups += 1;
      report.failedSessions.push({ date: session.date, error: 'No groups found after fetch' });
      return;
    }

    report.sessionsParsed += 1;
    report.groupsTotal += session.groups.length;

    session.groups.forEach(function (group) {
      group.players.forEach(function (player) {
        if (player.matchesUnavailable) {
          report.matchesUnavailableCount += 1;
        }

        if (player.ratingAfter === null || player.ratingAfter === undefined) {
          report.suspiciousRatings.push({
            date: session.date,
            group: group.name,
            player: player.name,
            issue: 'ratingAfter is null (could not parse final rating)'
          });
        } else if (player.ratingAfter <= 0 || player.ratingAfter > 4000) {
          report.suspiciousRatings.push({
            date: session.date,
            group: group.name,
            player: player.name,
            issue: 'rating out of range: ' + player.ratingAfter
          });
        } else if (Math.abs(player.ratingAdj || 0) > 400) {
          report.suspiciousRatings.push({
            date: session.date,
            group: group.name,
            player: player.name,
            issue: 'large single-session adjustment: ' + (player.ratingAdj > 0 ? '+' : '') + player.ratingAdj
          });
        }
      });
    });
  });

  // Build session-summaries.json for archive teasers
  const summaries = {};
  sessions.forEach(function (session) {
    if (!session.groups || !session.groups.length) return;
    var playerCount = 0;
    var topGain = 0;
    var topLoss = 0;
    session.groups.forEach(function (group) {
      group.players.forEach(function (player) {
        playerCount++;
        var adj = player.ratingAdj || 0;
        if (adj > topGain) topGain = adj;
        if (adj < topLoss) topLoss = adj;
      });
    });
    summaries[session.date] = { players: playerCount, topGain: topGain, topLoss: topLoss };
  });
  fs.writeFileSync(path.join(DATA_DIR, 'session-summaries.json'), JSON.stringify(summaries) + '\n');
  console.log('Session summaries written for', Object.keys(summaries).length, 'sessions.');

  const outFile = path.join(DATA_DIR, 'parse-report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');

  // Print summary to stdout
  console.log('=== Data health check ===');
  console.log('Data built at:         ', report.dataBuiltAt || '(unknown)');
  console.log('Latest session:        ', report.latestSessionDate || '(unknown)');
  console.log('Sessions total:        ', report.sessionsTotal);
  console.log('  Parsed successfully: ', report.sessionsParsed);
  console.log('  Failed (error):      ', report.sessionsFailed);
  console.log('  No groups found:     ', report.sessionsNoGroups);
  console.log('Groups total:          ', report.groupsTotal);
  console.log('Unique players:        ', report.uniquePlayers);
  console.log('Match detail missing:  ', report.matchesUnavailableCount, 'player-sessions');
  console.log('Suspicious ratings:    ', report.suspiciousRatings.length);

  if (report.suspiciousRatings.length) {
    console.log('\nSuspicious rating entries:');
    report.suspiciousRatings.forEach(function (r) {
      console.log(' ', r.date, r.group, '-', r.player + ':', r.issue);
    });
  }

  if (report.failedSessions.length) {
    console.log('\nFailed/empty sessions:');
    report.failedSessions.forEach(function (s) {
      console.log(' ', s.date + ':', s.error);
    });
  }

  if (report.sessionsFailed + report.sessionsNoGroups > 0) {
    console.log('\nWARNING:', report.sessionsFailed + report.sessionsNoGroups, 'session(s) have no usable data.');
    process.exitCode = 1;
  } else {
    console.log('\nAll sessions parsed successfully.');
  }

  console.log('\nFull report written to', path.relative(process.cwd(), outFile));
}

main();
