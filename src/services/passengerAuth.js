const { z } = require('zod');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { bad, unauthorized } = require('../utils/httpError');
const { normalizePhone } = require('../utils/validators');
const { nowSql } = require('../utils/time');
const { signUserToken } = require('../middleware/auth');
const { audit } = require('./audit');

// Compared against when the phone is unknown so response time doesn't reveal which phones exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function login(rawPhone, password) {
  const phone = normalizePhone(rawPhone);
  const user = phone
    ? await db.one('SELECT * FROM users WHERE phone = ? AND deleted_at IS NULL', [phone])
    : null;
  const ok = await bcrypt.compare(String(password || ''), user && user.password_hash ? user.password_hash : DUMMY_HASH);
  if (!user || !user.password_hash || !ok) throw unauthorized('Incorrect phone number or password');
  return { token: signUserToken(user.id), verificationStatus: user.verification_status };
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

async function changePassword(user, body) {
  const { currentPassword, newPassword } = changePasswordSchema.parse(body);
  // Accounts created before passwords existed have no hash; they may set one without a current password.
  if (user.password_hash && !(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw bad('Current password is incorrect', 'wrong_password');
  }
  await db.execute('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    [await bcrypt.hash(newPassword, 10), nowSql(), user.id]);
  await audit({ userId: user.id, action: 'user.password_changed', entity: 'user', entityId: user.id });
  return { changed: true };
}

module.exports = { login, changePassword };
