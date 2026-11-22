// Upgrades an existing e_season database for e-mail verification:
//   - adds users.email_verified_at
//   - creates the email_verifications table
// Safe to run twice. A fresh `npm run db:init` already includes both.
const mysql = require('mysql2/promise');
const config = require('../src/config');

(async () => {
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.database,
  });
  try {
    const [col] = await conn.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email_verified_at'");
    if (col.length) {
      console.log('users.email_verified_at already exists.');
    } else {
      await conn.query('ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER email');
      console.log('Added users.email_verified_at (existing passengers show emailVerified: false).');
    }

    await conn.query(`CREATE TABLE IF NOT EXISTS email_verifications (
      id          CHAR(36)     NOT NULL,
      email       VARCHAR(255) NOT NULL,
      phone       VARCHAR(15)  NOT NULL,
      code_hash   VARCHAR(255) NOT NULL,
      expires_at  DATETIME     NOT NULL,
      attempts    TINYINT      NOT NULL DEFAULT 0,
      consumed_at DATETIME     NULL,
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_email_ver (email, phone, created_at)
    ) ENGINE=InnoDB`);
    console.log('email_verifications table is ready.');
  } finally {
    await conn.end();
  }
})().catch((err) => { console.error('migration failed:', err.message); process.exit(1); });
