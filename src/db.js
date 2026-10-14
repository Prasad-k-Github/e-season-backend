// Thin database layer. Services only use: query(), one(), execute(), transaction().
// The default adapter is MySQL (mysql2). Tests inject a SQLite adapter with setDb().
const config = require('./config');

let adapter = null;

function createMysqlAdapter() {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    ...config.db,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z',
    dateStrings: ['DATE', 'DATETIME', 'TIMESTAMP'], // keep dates as plain strings
    charset: 'utf8mb4',
  });

  const wrap = (runner) => ({
    async query(sql, params = []) {
      const [rows] = await runner.query(sql, params);
      return rows;
    },
    async execute(sql, params = []) {
      const [res] = await runner.query(sql, params);
      return { affectedRows: res.affectedRows };
    },
  });

  return {
    ...wrap(pool),
    async transaction(fn) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await fn(wrap(conn));
        await conn.commit();
        return result;
      } catch (err) {
        try { await conn.rollback(); } catch (_) { /* ignore */ }
        throw err;
      } finally {
        conn.release();
      }
    },
    async close() { await pool.end(); },
  };
}

function db() {
  if (!adapter) adapter = createMysqlAdapter();
  return adapter;
}

/** Replace the adapter (used by tests). */
function setDb(custom) { adapter = custom; }

const query = (sql, params) => db().query(sql, params);
const execute = (sql, params) => db().execute(sql, params);
const transaction = (fn) => db().transaction(fn);
async function one(sql, params, runner = db()) {
  const rows = await runner.query(sql, params);
  return rows[0] || null;
}
async function close() { if (adapter && adapter.close) await adapter.close(); adapter = null; }

module.exports = { query, execute, transaction, one, setDb, close };
