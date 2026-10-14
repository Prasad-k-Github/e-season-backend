// Signed season-ticket tokens (ES256 JWT). The token is what the QR code carries.
// An inspector app can verify it offline using only the public key.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const ISSUER = 'e-season';
let keys = null;

function loadKeys() {
  if (keys) return keys;
  const { privatePath, publicPath } = config.ticketKeys;
  if (!fs.existsSync(privatePath) || !fs.existsSync(publicPath)) {
    if (config.isProd) throw new Error('Ticket signing keys not found. Run `npm run keys`.');
    generateKeyFiles(privatePath, publicPath);
  }
  keys = {
    privateKey: fs.readFileSync(privatePath, 'utf8'),
    publicKey: fs.readFileSync(publicPath, 'utf8'),
  };
  return keys;
}

function generateKeyFiles(privatePath, publicPath) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  fs.mkdirSync(path.dirname(privatePath), { recursive: true });
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
}

/** Unix seconds for the end of `dateStr` (YYYY-MM-DD) in Sri Lanka time (UTC+05:30). */
function endOfDayLK(dateStr) {
  return Math.floor(Date.parse(`${dateStr}T00:00:00+05:30`) / 1000) + 86400;
}

function signTicket(t) {
  const { privateKey } = loadKeys();
  const payload = {
    nm: t.holderName,
    fr: t.fromStation,
    to: t.toStation,
    cls: t.ticketClass,
    vf: t.validFrom,
    vt: t.validTo,
    exp: endOfDayLK(t.validTo),
  };
  return jwt.sign(payload, privateKey, {
    algorithm: 'ES256',
    issuer: ISSUER,
    subject: t.ticketId,
    noTimestamp: false,
  });
}

/**
 * Verifies the signature and expiry.
 * Returns { ok: true, payload } | { ok: false, reason: 'expired', payload } | { ok: false, reason: 'invalid' }.
 */
function verifyTicketToken(token) {
  let payload;
  try {
    const { publicKey } = loadKeys();
    payload = jwt.verify(token, publicKey, {
      algorithms: ['ES256'],
      issuer: ISSUER,
      ignoreExpiration: true, // checked below so the payload is still available for "expired"
    });
  } catch (_) {
    return { ok: false, reason: 'invalid' };
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: 'expired', payload };
  }
  return { ok: true, payload };
}

function getPublicKeyPem() { return loadKeys().publicKey; }

module.exports = { signTicket, verifyTicketToken, getPublicKeyPem, generateKeyFiles };
