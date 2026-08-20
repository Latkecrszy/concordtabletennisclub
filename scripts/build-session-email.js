// Builds the HTML/text summary email for a single round robin session.
//
// Usage:
//   node scripts/build-session-email.js            # latest session, writes preview HTML
//   node scripts/build-session-email.js 2026-08-17  # specific date
//
// This module has no network or email dependency — it only reads local
// data/*.json and returns { subject, html, text }. scripts/send-session-email.js
// is the thing that actually mails it out.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SITE_URL = 'https://concordtabletennisclub.com';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return DAYS[dt.getDay()] + ', ' + MONTHS[m - 1] + ' ' + d + ', ' + y;
}

function findSession(date) {
  const year = date.slice(0, 4);
  const sessions = loadJson(path.join(DATA_DIR, 'session-details-' + year + '.json'), []);
  return sessions.find(function (s) { return s.date === date; }) || null;
}

function latestSessionDate() {
  const status = loadJson(path.join(DATA_DIR, 'site-status.json'), {});
  return status.latestSessionDate || null;
}

// Winner = top row of each group's players array, which is already sorted
// wins-desc (ties broken by rating) by scripts/fetch-and-parse.js.
function groupWinners(session) {
  return session.groups.map(function (group) {
    const winner = group.players[0];
    return { groupName: group.name, player: winner };
  }).filter(function (entry) { return entry.player; });
}

// Biggest gainers/losers by rating adjustment across the whole session.
function biggestMovers(session, count) {
  const all = [];
  session.groups.forEach(function (group) {
    group.players.forEach(function (player) {
      if (typeof player.ratingAdj === 'number') {
        all.push({ name: player.name, ratingAdj: player.ratingAdj, ratingAfter: player.ratingAfter, group: group.name });
      }
    });
  });
  const gainers = all.filter(function (p) { return p.ratingAdj > 0; })
    .sort(function (a, b) { return b.ratingAdj - a.ratingAdj; })
    .slice(0, count);
  const losers = all.filter(function (p) { return p.ratingAdj < 0; })
    .sort(function (a, b) { return a.ratingAdj - b.ratingAdj; })
    .slice(0, count);
  return { gainers: gainers, losers: losers };
}

function sessionTotals(session) {
  let players = 0, matches = 0, games = 0;
  session.groups.forEach(function (group) {
    players += group.players.length;
    group.players.forEach(function (player) {
      if (!player.matchesUnavailable && player.matches) {
        matches += player.matches.length;
        player.matches.forEach(function (m) { games += (m.gamesWon || 0) + (m.gamesLost || 0); });
      }
    });
  });
  // Each match is counted from both players' perspectives; matches/2 = unique matches played.
  return { players: players, groups: session.groups.length, matches: Math.round(matches / 2), games: Math.round(games / 2) };
}

function signed(n) {
  return n > 0 ? '+' + n : String(n);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function buildHtml(session, winners, movers, totals) {
  const dateLabel = formatDate(session.date);
  const archiveLink = SITE_URL + '/roundrobins.html#s-' + session.date;

  const winnerRows = winners.map(function (w) {
    return '<tr>' +
      '<td style="padding:6px 12px 6px 0;color:#666;">' + escapeHtml(w.groupName) + '</td>' +
      '<td style="padding:6px 12px 6px 0;font-weight:bold;">🏆 ' + escapeHtml(w.player.name) + '</td>' +
      '<td style="padding:6px 0;text-align:right;color:#666;">' + w.player.wins + '-' + w.player.losses + '</td>' +
      '</tr>';
  }).join('');

  function moverRows(list, arrow, color) {
    if (!list.length) return '<tr><td style="padding:4px 0;color:#666;">None</td></tr>';
    return list.map(function (p) {
      return '<tr>' +
        '<td style="padding:4px 12px 4px 0;">' + arrow + ' ' + escapeHtml(p.name) + '</td>' +
        '<td style="padding:4px 0;text-align:right;color:' + color + ';font-weight:bold;">' + signed(p.ratingAdj) + '</td>' +
        '</tr>';
    }).join('');
  }

  return '' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;max-width:560px;margin:0 auto;color:#1a1a1a;">' +
    '<h1 style="color:#8B1A1A;font-size:1.3rem;margin:0 0 4px;">Concord Table Tennis Club</h1>' +
    '<p style="color:#666;margin:0 0 20px;font-size:0.95rem;">' + escapeHtml(dateLabel) + ' Results</p>' +

    '<h2 style="font-size:1.05rem;border-bottom:1px solid #ddd8d0;padding-bottom:4px;">Table Winners</h2>' +
    '<table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin-bottom:20px;">' + winnerRows + '</table>' +

    '<h2 style="font-size:1.05rem;border-bottom:1px solid #ddd8d0;padding-bottom:4px;">Biggest Movers</h2>' +
    '<table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin-bottom:8px;">' +
    moverRows(movers.gainers, '⬆️', '#2a6a2a') +
    '</table>' +
    '<table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin-bottom:20px;">' +
    moverRows(movers.losers, '⬇️', '#8B1A1A') +
    '</table>' +

    '<h2 style="font-size:1.05rem;border-bottom:1px solid #ddd8d0;padding-bottom:4px;">Session Totals</h2>' +
    '<p style="font-size:0.9rem;color:#333;margin-bottom:20px;">' +
    totals.players + ' players &middot; ' + totals.groups + ' tables &middot; ' +
    totals.matches + ' matches &middot; ' + totals.games + ' games played' +
    '</p>' +

    '<p style="font-size:0.85rem;"><a href="' + archiveLink + '" style="color:#8B1A1A;">See full results →</a></p>' +
    '<p style="font-size:0.75rem;color:#999;margin-top:24px;">Concord Table Tennis Club &middot; Walnut Creek, CA</p>' +
    '</div>';
}

function buildText(session, winners, movers, totals) {
  const dateLabel = formatDate(session.date);
  const archiveLink = SITE_URL + '/roundrobins.html#s-' + session.date;
  const lines = [];

  lines.push('Concord Table Tennis Club - ' + dateLabel + ' Results');
  lines.push('');
  lines.push('TABLE WINNERS');
  winners.forEach(function (w) {
    lines.push('  ' + w.groupName + ': ' + w.player.name + ' (' + w.player.wins + '-' + w.player.losses + ')');
  });
  lines.push('');
  lines.push('BIGGEST MOVERS');
  if (movers.gainers.length) {
    movers.gainers.forEach(function (p) { lines.push('  Up   ' + p.name + ' ' + signed(p.ratingAdj)); });
  }
  if (movers.losers.length) {
    movers.losers.forEach(function (p) { lines.push('  Down ' + p.name + ' ' + signed(p.ratingAdj)); });
  }
  lines.push('');
  lines.push('SESSION TOTALS');
  lines.push('  ' + totals.players + ' players, ' + totals.groups + ' tables, ' +
    totals.matches + ' matches, ' + totals.games + ' games played');
  lines.push('');
  lines.push('Full results: ' + archiveLink);

  return lines.join('\n');
}

function buildSessionEmail(date, options) {
  const moverCount = (options && options.moverCount) || 3;
  const session = findSession(date);
  if (!session) throw new Error('No session found for date ' + date);
  if (!session.groups || !session.groups.length) {
    throw new Error('Session ' + date + ' has no parsed groups (error: ' + (session.error || 'unknown') + ')');
  }

  const winners = groupWinners(session);
  const movers = biggestMovers(session, moverCount);
  const totals = sessionTotals(session);

  return {
    subject: 'CTTC Results - ' + formatDate(session.date),
    html: buildHtml(session, winners, movers, totals),
    text: buildText(session, winners, movers, totals)
  };
}

module.exports = { buildSessionEmail, latestSessionDate };

if (require.main === module) {
  const date = process.argv[2] || latestSessionDate();
  if (!date) {
    console.error('No session date given and no latest session found.');
    process.exitCode = 1;
    return;
  }
  const email = buildSessionEmail(date);
  const previewFile = path.join(ROOT, '.cache', 'email-preview.html');
  fs.mkdirSync(path.dirname(previewFile), { recursive: true });
  fs.writeFileSync(previewFile, email.html);
  console.log('Subject:', email.subject);
  console.log('Preview written to', previewFile);
  console.log('\n--- text version ---\n');
  console.log(email.text);
}
