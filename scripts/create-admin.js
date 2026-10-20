// Usage: node scripts/create-admin.js <email> [password] [full name]
// Creates an admin staff account. If no password is given, a random one is generated and printed once.
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const { newId, randomToken } = require('../src/utils/crypto');
const { nowSql } = require('../src/utils/time');

async function main() {
  const [email, passwordArg, ...nameParts] = process.argv.slice(2);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('Usage: node scripts/create-admin.js <email> [password] [full name]');
  }
  const password = passwordArg || `${randomToken(9)}#A1`;
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const fullName = nameParts.join(' ') || 'System Admin';
  const normalized = email.trim().toLowerCase();

  if (await db.one('SELECT id FROM staff_users WHERE email = ?', [normalized])) {
    throw new Error(`A staff account with ${normalized} already exists`);
  }
  await db.execute(
    `INSERT INTO staff_users (id, full_name, email, password_hash, role, station_id, institution_id, is_active, created_at)
     VALUES (?, ?, ?, ?, 'admin', NULL, NULL, 1, ?)`,
    [newId(), fullName, normalized, await bcrypt.hash(password, 10), nowSql()]);

  console.log(`Admin created: ${normalized}`);
  if (!passwordArg) console.log(`Password: ${password}`);
}

main()
  .then(() => db.close())
  .catch(async (err) => {
    console.error('create-admin failed:', err.message);
    await db.close();
    process.exit(1);
  });
