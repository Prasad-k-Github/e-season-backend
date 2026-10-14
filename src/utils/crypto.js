const crypto = require('crypto');
const config = require('../config');

/** Keyed hash of the NIC. The raw NIC is never stored. */
function hashNic(nic) {
  return crypto.createHmac('sha256', config.nicPepper).update(nic).digest('hex');
}

function randomOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function newId() {
  return crypto.randomUUID();
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Constant-time string comparison. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function hmac(value) {
  return crypto.createHmac('sha256', config.jwtSecret).update(value).digest('hex');
}

module.exports = { hashNic, randomOtp, newId, randomToken, safeEqual, hmac };
