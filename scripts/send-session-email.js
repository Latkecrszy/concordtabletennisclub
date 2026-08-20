// Sends the session summary email built by build-session-email.js via
// Gmail SMTP, to the subscriber list (from a private Google Sheet, or a
// plain env var if the sheet isn't configured).
//
// Subscriber addresses are NOT stored in any committed file. This repo is
// public and data/ is deployed straight to the live site, so real email
// addresses must only ever live in a Google Sheet or a GitHub Actions
// secret, never in git history.
//
// Safe to run any time: it no-ops (exit 0) if subscribers are empty,
// credentials aren't set, or this session's summary was already sent.
//
// Setup (one-time, when ready to go live):
//   1. Enable 2-Step Verification on the sending Gmail account.
//   2. Create an App Password: https://myaccount.google.com/apppasswords
//   3. In repo Settings -> Secrets and variables -> Actions, add:
//        GMAIL_USER            the sending Gmail address
//        GMAIL_APP_PASSWORD    the 16-character app password
//
//   Then pick ONE way to supply the subscriber list:
//
//   Option A - private Google Sheet (recommended, easiest to maintain):
//     a. In Google Cloud Console (same Google account is fine), create a
//        project, enable the "Google Sheets API", then create a Service
//        Account and generate a JSON key for it.
//     b. Open the private subscribers sheet, share it with the service
//        account's email address (looks like xyz@project.iam.gserviceaccount.com)
//        as a Viewer.
//     c. Put one email address per row in a column (a header row is fine,
//        anything that isn't a valid email address is ignored).
//     d. Add repo secrets:
//          GOOGLE_SHEETS_SUBSCRIBERS_ID     the spreadsheet ID from its URL
//          GOOGLE_SERVICE_ACCOUNT_EMAIL     the service account's email
//          GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   the key's "private_key" field
//        (GOOGLE_SHEETS_SUBSCRIBERS_RANGE defaults to "Subscribers!A:A")
//
//   Option B - plain list, no sheet:
//        EMAIL_SUBSCRIBERS     recipient addresses, comma or newline separated
//
// Run: node scripts/send-session-email.js [date]
// (date defaults to the latest session; omit it for normal/scheduled runs)

'use strict';

const fs = require('fs');
const path = require('path');
const { buildSessionEmail, latestSessionDate } = require('./build-session-email');

const ROOT = path.join(__dirname, '..');
const LAST_SENT_FILE = path.join(ROOT, '.cache', 'last-emailed-session.json');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseSubscribers(raw) {
  return String(raw || '')
    .split(/[,\n]/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

async function loadSubscribers() {
  const sheetId = process.env.GOOGLE_SHEETS_SUBSCRIBERS_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (sheetId && clientEmail && rawPrivateKey) {
    const { fetchSheetColumn } = require('./lib/google-sheets');
    const range = process.env.GOOGLE_SHEETS_SUBSCRIBERS_RANGE || 'Subscribers!A:A';
    const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
    const values = await fetchSheetColumn(sheetId, range, clientEmail, privateKey);
    return values
      .map(function (v) { return String(v).trim(); })
      .filter(function (v) { return EMAIL_PATTERN.test(v); });
  }

  return parseSubscribers(process.env.EMAIL_SUBSCRIBERS);
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

async function main() {
  const date = process.argv[2] || latestSessionDate();
  if (!date) {
    console.log('No session date available; nothing to send.');
    return;
  }

  const subscribers = await loadSubscribers();
  if (!subscribers.length) {
    console.log('No subscribers found (checked Google Sheet and EMAIL_SUBSCRIBERS); skipping send.');
    return;
  }

  const lastSent = loadJson(LAST_SENT_FILE, { date: null });
  if (lastSent.date === date) {
    console.log('Session ' + date + ' was already emailed; skipping.');
    return;
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.log('GMAIL_USER / GMAIL_APP_PASSWORD not set; skipping send. (This is expected until credentials are configured.)');
    return;
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (err) {
    console.error('nodemailer is not installed. Run: npm install nodemailer');
    process.exitCode = 1;
    return;
  }

  const email = buildSessionEmail(date);

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass }
  });

  await transporter.sendMail({
    from: 'Concord Table Tennis Club <' + gmailUser + '>',
    to: gmailUser,
    bcc: subscribers,
    subject: email.subject,
    text: email.text,
    html: email.html
  });

  writeJson(LAST_SENT_FILE, { date: date, sentAt: new Date().toISOString() });
  console.log('Sent "' + email.subject + '" to ' + subscribers.length + ' subscriber(s).');
}

main().catch(function (err) {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
