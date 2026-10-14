const db = require('../db');
const { nowSql } = require('../utils/time');

/**
 * Append an audit record. Never put NIC numbers, OTP codes, tokens or image paths in `details`.
 * `runner` is a transaction handle (tx) or omitted to use the shared pool.
 */
async function audit({ userId = null, staffId = null, action, entity, entityId = null, details = null }, runner) {
  const exec = runner ? runner.execute.bind(runner) : db.execute;
  await exec(
    `INSERT INTO audit_logs (actor_user_id, actor_staff_id, action, entity, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, staffId, action, entity, entityId, details ? JSON.stringify(details) : null, nowSql()],
  );
}

module.exports = { audit };
