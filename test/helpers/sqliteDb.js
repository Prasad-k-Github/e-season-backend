// Test-only database adapter. The workspace used to build this had no MySQL server, so the
// business logic is tested against SQLite using the same db/schema.sql converted to SQLite syntax.
// This does NOT test MySQL-specific behaviour: run the app once against real MySQL before the demo.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function convertSchema(sql) {
  let s = sql;
  s = s.replace(/CREATE DATABASE[^;]*;/g, '').replace(/USE \w+;/g, '').replace(/SET FOREIGN_KEY_CHECKS = \d;/g, '');
  s = s.replace(/--[^\n]*/g, '');
  s = s.replace(/ENUM\([^)]*\)/g, 'TEXT');
  s = s.replace(/DEFAULT \(UUID\(\)\)/g, '');
  s = s.replace(/ON UPDATE CURRENT_TIMESTAMP/g, '');
  s = s.replace(/ENGINE=InnoDB/g, '');
  s = s.replace(/UNIQUE KEY \w+\s*\(/g, 'UNIQUE (');
  s = s.replace(/^\s*KEY\s+\w+\s*\([^)]*\),?[ \t]*$/gm, '');
  s = s.replace(/BIGINT\s+NOT NULL AUTO_INCREMENT/g, 'INTEGER NOT NULL');
  s = s.replace(/CHAR_LENGTH\(/g, 'length(');
  s = s.replace(/,(\s*)\)/g, '$1)'); // trailing commas left by removed KEY lines
  return s;
}

function createSqliteAdapter() {
  const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(convertSchema(schema));

  const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  const runner = {
    async query(sql, params = []) {
      return sqlite.prepare(sql).all(...clean(params)).map((r) => ({ ...r }));
    },
    async execute(sql, params = []) {
      const r = sqlite.prepare(sql).run(...clean(params));
      return { affectedRows: Number(r.changes) };
    },
  };

  let chain = Promise.resolve();
  return {
    ...runner,
    raw: sqlite,
    transaction(fn) {
      const run = chain.then(async () => {
        sqlite.exec('BEGIN');
        try {
          const result = await fn(runner);
          sqlite.exec('COMMIT');
          return result;
        } catch (err) {
          sqlite.exec('ROLLBACK');
          throw err;
        }
      });
      chain = run.catch(() => {});
      return run;
    },
    async close() { sqlite.close(); },
  };
}

module.exports = { createSqliteAdapter, convertSchema };
