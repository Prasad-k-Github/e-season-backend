const db = require('../db');
const config = require('../config');
const { bad, HttpError } = require('../utils/httpError');
const { normalizePhone } = require('../utils/validators');
const { newId, randomOtp, hmac, safeEqual } = require('../utils/crypto');
const { nowSql } = require('../utils/time');
const { sendOtpSms } = require('./sms');
const { signUserToken, signRegistrationToken } = require('../middleware/auth');

const cooldownSeconds = () => Number(process.env.OTP_COOLDOWN_SECONDS ?? 60);

function sqlToMs(s) { return Date.parse(`${s.replace(' ', 'T')}Z`); }

async function requestOtp(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw bad('Enter a valid Sri Lankan mobile number (07XXXXXXXX)', 'bad_phone');

  const last = await db.one(
    'SELECT created_at FROM otp_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1', [phone]);
  if (last && Date.now() - sqlToMs(last.created_at) < cooldownSeconds() * 1000) {
    throw new HttpError(429, 'Please wait a moment before requesting another code', 'otp_cooldown');
  }

  const code = randomOtp();
  const id = newId();
  const expires = new Date(Date.now() + config.otp.ttlMinutes * 60 * 1000);
  await db.execute(
    'INSERT INTO otp_codes (id, phone, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    [id, phone, hmac(`${id}:${code}`), nowSql(expires), nowSql()],
  );

  const devMode = config.otp.provider === 'mock' && !config.isProd;
  if (devMode) {
    console.log(`[mock OTP] code for ${phone.slice(0, 6)}****${phone.slice(-2)}: ${code}`);
  } else if (config.otp.provider !== 'mock') {
    try {
      await sendOtpSms(phone, code, config.otp.ttlMinutes);
    } catch (err) {
      // Drop the unusable code so the cooldown doesn't block an immediate retry.
      await db.execute('DELETE FROM otp_codes WHERE id = ?', [id]);
      throw err;
    }
  }

  return {
    expiresInSeconds: config.otp.ttlMinutes * 60,
    ...(devMode ? { devCode: code } : {}),
  };
}

async function verifyOtp(rawPhone, rawCode) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw bad('Enter a valid Sri Lankan mobile number', 'bad_phone');
  const code = String(rawCode || '').trim();
  if (!/^\d{6}$/.test(code)) throw bad('The code must be 6 digits', 'bad_code');

  const row = await db.one(
    'SELECT * FROM otp_codes WHERE phone = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1', [phone]);
  if (!row) throw bad('No active code. Request a new one', 'otp_missing');
  if (row.expires_at < nowSql()) throw bad('The code has expired. Request a new one', 'otp_expired');
  if (row.attempts >= config.otp.maxAttempts) {
    throw new HttpError(429, 'Too many wrong attempts. Request a new code', 'otp_locked');
  }

  if (!safeEqual(hmac(`${row.id}:${code}`), row.code_hash)) {
    await db.execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    throw bad('Incorrect code', 'otp_incorrect');
  }

  const used = await db.execute(
    'UPDATE otp_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', [nowSql(), row.id]);
  if (used.affectedRows !== 1) throw bad('This code was already used', 'otp_used');

  const user = await db.one('SELECT id, verification_status FROM users WHERE phone = ? AND deleted_at IS NULL', [phone]);
  if (user) {
    return { registered: true, token: signUserToken(user.id), verificationStatus: user.verification_status };
  }
  return { registered: false, registrationToken: signRegistrationToken(phone) };
}

module.exports = { requestOtp, verifyOtp };
