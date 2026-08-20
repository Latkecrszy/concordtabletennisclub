// Minimal read-only Google Sheets client using a service account.
// No googleapis/google-auth-library dependency: signs the JWT with Node's
// built-in crypto module and calls the Sheets REST API directly with fetch.

'use strict';

const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(clientEmail, privateKey, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    scope: scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claimSet));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const jwt = unsigned + '.' + signature;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!response.ok) {
    throw new Error('Google token exchange failed: HTTP ' + response.status + ' ' + await response.text());
  }
  const data = await response.json();
  return data.access_token;
}

// range e.g. "Subscribers!A:A". Returns a flat array of cell values.
async function fetchSheetColumn(spreadsheetId, range, clientEmail, privateKey) {
  const token = await getAccessToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(spreadsheetId) + '/values/' + encodeURIComponent(range);

  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) {
    throw new Error('Sheets API request failed: HTTP ' + response.status + ' ' + await response.text());
  }
  const data = await response.json();
  return (data.values || []).flat();
}

module.exports = { fetchSheetColumn };
