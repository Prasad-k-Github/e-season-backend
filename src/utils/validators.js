// Pure validation / normalisation helpers (unit-tested).

// \p{M} = combining marks (Tamil/Sinhala vowel signs); \u200d = zero-width joiner used in Sinhala conjuncts
const NAME_RE = /^[\p{L}][\p{L}\p{M}\u200d\s.'-]*$/u;
const OLD_NIC_RE = /^\d{9}[VvXx]$/;
const NEW_NIC_RE = /^\d{12}$/;

function isValidFullName(name) {
  if (typeof name !== 'string') return false;
  const t = name.trim();
  return t.length >= 3 && t.length <= 255 && NAME_RE.test(t);
}

/** Returns the canonical NIC (upper-case) or null if the format is invalid. */
function normalizeNic(nic) {
  if (typeof nic !== 'string') return null;
  const t = nic.trim();
  if (OLD_NIC_RE.test(t)) return t.toUpperCase();
  if (NEW_NIC_RE.test(t)) return t;
  return null;
}

/** Accepts 07XXXXXXXX, 7XXXXXXXX, +947XXXXXXXX, 947XXXXXXXX. Returns +947XXXXXXXX or null. */
function normalizePhone(phone) {
  if (typeof phone !== 'string') return null;
  const t = phone.replace(/[\s-]/g, '');
  let m;
  if ((m = /^\+94(7\d{8})$/.exec(t))) return `+94${m[1]}`;
  if ((m = /^94(7\d{8})$/.exec(t))) return `+94${m[1]}`;
  if ((m = /^0(7\d{8})$/.exec(t))) return `+94${m[1]}`;
  return null;
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Maps the Flutter app's "general" to the DB's "private". */
function normalizePassengerType(t) {
  if (t === 'government') return 'government';
  if (t === 'private' || t === 'general') return 'private';
  return null;
}

const isIsoDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

module.exports = {
  isValidFullName,
  normalizeNic,
  normalizePhone,
  isValidEmail,
  normalizePassengerType,
  isIsoDate,
};
