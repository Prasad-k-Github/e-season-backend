// Creates the e_season database and tables from db/schema.sql (MySQL 8.0.16+).
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    console.log('Database schema created.');
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('db:init failed:', err.message);
  process.exit(1);
});
