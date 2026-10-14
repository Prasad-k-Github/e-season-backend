// Upgrades an existing e_season database: adds users.password_hash. Safe to run twice.
const mysql = require('mysql2/promise');
const config = require('../src/config');

(async () => {
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.database,
  });
  try {
    const [rows] = await conn.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'password_hash'");
    if (rows.length) return console.log('users.password_hash already exists.');
    await conn.query('ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER phone');
    console.log('Added users.password_hash. Existing passengers can set a password with PUT /api/me/password.');
  } finally {
    await conn.end();
  }
})().catch((err) => { console.error('migration failed:', err.message); process.exit(1); });
