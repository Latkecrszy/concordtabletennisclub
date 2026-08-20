// Sends the session summary email built by build-session-email.js via
// Gmail SMTP, to everyone listed in the EMAIL_SUBSCRIBERS env var.
//
// Subscriber addresses are NOT stored in any committed file. This repo is
// public and data/ is deployed straight to the live site, so real email
// addresses must only ever live in a GitHub Actions secret (or a local
// .env-style export), never in git history.
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

function parseSubscribers(raw) {
  return String(raw || '')
    .split(/[,\n]/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
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

  const subscribers = parseSubscribers(process.env.EMAIL_SUBSCRIBERS);
  if (!subscribers.length) {
    console.log('No subscribers set in EMAIL_SUBSCRIBERS; skipping send.');
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
