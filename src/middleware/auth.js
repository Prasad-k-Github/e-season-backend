const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden } = require('../utils/httpError');

function sign(payload, expiresIn) {
  return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn });
}

const signUserToken = (userId) => sign({ typ: 'user', sub: userId }, '7d');
const signStaffToken = (staffId) => sign({ typ: 'staff', sub: staffId }, '8h');
const signRegistrationToken = (phone) => sign({ typ: 'register', phone }, '30m');

function readBearer(req, expectedType) {
  const header = req.headers.authorization || '';
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) throw unauthorized('Missing bearer token');
  let payload;
  try {
    payload = jwt.verify(m[1], config.jwtSecret, { algorithms: ['HS256'] });
  } catch (_) {
    throw unauthorized('Invalid or expired token');
  }
  if (payload.typ !== expectedType) throw unauthorized('Wrong token type');
  return payload;
}

const wrap = (fn) => (req, res, next) => fn(req, res).then(() => next(), next);

/** Logged-in passenger. Sets req.user. */
const requireUser = wrap(async (req) => {
  const p = readBearer(req, 'user');
  const user = await db.one('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [p.sub]);
  if (!user) throw unauthorized('Account not found');
  req.user = user;
});

/** Phone-verified person who has not registered yet. Sets req.registration = { phone }. */
const requireRegistration = wrap(async (req) => {
  const p = readBearer(req, 'register');
  req.registration = { phone: p.phone };
});

/** Staff member with one of the given roles. Sets req.staff. */
const requireStaff = (...roles) => wrap(async (req) => {
  const p = readBearer(req, 'staff');
  const staff = await db.one('SELECT * FROM staff_users WHERE id = ? AND is_active = 1', [p.sub]);
  if (!staff) throw unauthorized('Staff account not found or disabled');
  if (roles.length && !roles.includes(staff.role)) throw forbidden('Your role cannot do this');
  req.staff = staff;
});

module.exports = {
  signUserToken,
  signStaffToken,
  signRegistrationToken,
  requireUser,
  requireRegistration,
  requireStaff,
};
