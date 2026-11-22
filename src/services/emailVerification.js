// E-mail verification during registration.
//
//   1. POST /auth/email/request  { email }        -> a 6-digit code is e-mailed
//   2. POST /auth/email/verify   { email, code }  -> { emailToken }
//   3. POST /register  (…, email, emailToken)     -> account is created with email_verified_at set
//
// Both calls need the registration token from the phone OTP step. The code is bound to that
// phone number and the emailToken is bound to the (email, phone) pair, so a token cannot be
// reused for another address or another person.
const db = require('../db');
const config = require('../config');
const { bad, conflict, HttpError } = require('../utils/httpError');
const { normalizeEmail } = require('../utils/validators');
const { newId, randomOtp, hmac, safeEqual } = require('../utils/crypto');
const { nowSql } = require('../utils/time');
const { signEmailToken } = require('../middleware/auth');
const { sendVerificationEmail } = require('./email');

const cooldownSeconds = () => Number(process.env.EMAIL_COOLDOWN_SECONDS ?? 60);
const sqlToMs = (s) => Date.parse(`${s.replace(' ', 'T')}Z`);
const maskEmail = (e) => e.replace(/^(.{2}).*(@.*)$/, '$1***$2');

async function requestEmailCode(phone, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw bad('Enter a valid e-mail address', 'bad_email');

  // Prototype trade-off: this reveals that an address is registered. It saves the person from
  // filling in the whole form only to be refused at the end.
  const taken = await db.one('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
  if (taken) throw conflict('An account with this e-mail already exists', 'email_in_use');

  // The cooldown is per address, so one mailbox cannot be flooded from many phone numbers.
  const last = await db.one(
    'SELECT created_at FROM email_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1', [email]);
  if (last && Date.now() - sqlToMs(last.created_at) < cooldownSeconds() * 1000) {
    throw new HttpError(429, 'Please wait a moment before requesting another code', 'email_cooldown');
  }

  const mock = config.email.provider === 'mock';
  if (mock && config.isProd) {
    throw new Error('EMAIL_PROVIDER=mock cannot be used in production. Set EMAIL_PROVIDER=smtp');
  }

  const code = randomOtp();
  const id = newId();
  const now = nowSql();
  const expires = new Date(Date.now() + config.email.ttlMinutes * 60 * 1000);

  // Tidy up this pair's used or expired codes.
  await db.execute(
    'DELETE FROM email_verifications WHERE email = ? AND phone = ? AND (consumed_at IS NOT NULL OR expires_at < ?)',
    [email, phone, now]);
  await db.execute(
    `INSERT INTO email_verifications (id, email, phone, code_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [id, email, phone, hmac(`${id}:${code}`), nowSql(expires), now]);

  if (mock) {
    console.log(`[mock e-mail] code for ${maskEmail(email)}: ${code}`);
  } else {
    try {
      await sendVerificationEmail(email, code, config.email.ttlMinutes);
    } catch (err) {
      // Drop the unusable code so the cooldown does not block an immediate retry.
      await db.execute('DELETE FROM email_verifications WHERE id = ?', [id]);
      throw err;
    }
  }

  return {
    expiresInSeconds: config.email.ttlMinutes * 60,
    ...(mock ? { devCode: code } : {}),
  };
}

async function verifyEmailCode(phone, rawEmail, rawCode) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw bad('Enter a valid e-mail address', 'bad_email');
  const code = String(rawCode || '').trim();
  if (!/^\d{6}$/.test(code)) throw bad('The code must be 6 digits', 'bad_code');

  const row = await db.one(
    `SELECT * FROM email_verifications
      WHERE email = ? AND phone = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [email, phone]);
  if (!row) throw bad('No active code for this e-mail. Request a new one', 'email_code_missing');
  if (row.expires_at < nowSql()) throw bad('The code has expired. Request a new one', 'email_code_expired');
  if (row.attempts >= config.email.maxAttempts) {
    throw new HttpError(429, 'Too many wrong attempts. Request a new code', 'email_code_locked');
  }

  if (!safeEqual(hmac(`${row.id}:${code}`), row.code_hash)) {
    await db.execute('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    throw bad('Incorrect code', 'email_code_incorrect');
  }

  // Single use, even if two requests race.
  const used = await db.execute(
    'UPDATE email_verifications SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', [nowSql(), row.id]);
  if (used.affectedRows !== 1) throw bad('This code was already used', 'email_code_used');

  return { email, emailToken: signEmailToken(email, phone), expiresInSeconds: 30 * 60 };
}

module.exports = { requestEmailCode, verifyEmailCode };
