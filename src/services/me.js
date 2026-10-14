const db = require('../db');
const { newId } = require('../utils/crypto');
const { nowSql } = require('../utils/time');
const { conflict } = require('../utils/httpError');
const { removeFile } = require('../middleware/upload');
const { checkDocs, DOC_TYPES, DOC_DB_TYPE } = require('./registration');
const { audit } = require('./audit');

function publicUser(u, extra = {}) {
  return {
    id: u.id,
    passengerType: u.passenger_type,
    fullName: u.full_name,
    phone: u.phone,
    email: u.email,
    nicLast4: u.nic_last4,
    address: u.address,
    preferredLanguage: u.preferred_language,
    verificationStatus: u.verification_status,
    rejectionReason: u.rejection_reason,
    createdAt: u.created_at,
    ...extra,
  };
}

async function getMe(user) {
  let extra = {};
  if (user.passenger_type === 'government') {
    const g = await db.one(
      `SELECT g.employee_no, g.designation, i.name AS institution
         FROM gov_profiles g JOIN institutions i ON i.id = g.institution_id WHERE g.user_id = ?`, [user.id]);
    if (g) extra = { institution: g.institution, employeeNo: g.employee_no, designation: g.designation };
  } else {
    const p = await db.one('SELECT employer_name FROM private_profiles WHERE user_id = ?', [user.id]);
    if (p) extra = { employerName: p.employer_name };
  }
  return publicUser(user, extra);
}

/** Replace documents after a rejection and send the account back into review. */
async function resubmit(user, docs) {
  if (user.verification_status !== 'rejected') {
    throw conflict('Only rejected accounts can be resubmitted', 'not_rejected');
  }
  checkDocs(docs, { requireAll: false });
  if (!Object.values(docs).some(Boolean)) {
    const { bad } = require('../utils/httpError');
    throw bad('Upload at least one corrected document', 'missing_document');
  }

  const now = nowSql();
  const oldFiles = [];
  let nextStatus = 'pending_verification';

  await db.transaction(async (tx) => {
    for (const [key] of DOC_TYPES) {
      if (!docs[key]) continue;
      const type = DOC_DB_TYPE[key];
      const old = await db.one('SELECT file_url FROM verification_docs WHERE user_id = ? AND doc_type = ?',
        [user.id, type], tx);
      if (old) {
        oldFiles.push(old.file_url);
        await tx.execute('DELETE FROM verification_docs WHERE user_id = ? AND doc_type = ?', [user.id, type]);
      }
      await tx.execute(
        'INSERT INTO verification_docs (id, user_id, doc_type, file_url, uploaded_at) VALUES (?, ?, ?, ?, ?)',
        [newId(), user.id, type, docs[key].filename, now]);
    }

    if (user.passenger_type === 'government') {
      const g = await db.one('SELECT approved_at FROM gov_profiles WHERE user_id = ?', [user.id], tx);
      if (!g || !g.approved_at) nextStatus = 'pending_institution_approval';
    }

    await tx.execute(
      'UPDATE users SET verification_status = ?, rejection_reason = NULL, updated_at = ? WHERE id = ?',
      [nextStatus, now, user.id]);
    await audit({ userId: user.id, action: 'user.resubmitted', entity: 'user', entityId: user.id }, tx);
  });

  oldFiles.forEach(removeFile);
  return { verificationStatus: nextStatus };
}

/**
 * Account deletion (PDPA-style): remove documents, anonymise the record, revoke tickets.
 * The row stays so payment and audit history keep their references.
 */
async function deleteAccount(user) {
  const now = nowSql();
  const files = [];
  await db.transaction(async (tx) => {
    const docs = await tx.query('SELECT file_url FROM verification_docs WHERE user_id = ?', [user.id]);
    docs.forEach((d) => files.push(d.file_url));
    await tx.execute('DELETE FROM verification_docs WHERE user_id = ?', [user.id]);
    await tx.execute("UPDATE season_tickets SET status = 'revoked' WHERE user_id = ? AND status = 'active'", [user.id]);
    await tx.execute(
      "UPDATE applications SET status = 'cancelled' WHERE user_id = ? AND status IN ('draft','pending_institution_approval','approved_awaiting_payment')",
      [user.id]);
    const stub = newId().replace(/-/g, '');
    await tx.execute(
      `UPDATE users SET full_name = 'Deleted user', nic_hash = ?, nic_last4 = NULL, phone = ?, email = NULL,
              date_of_birth = NULL, address = NULL, rejection_reason = NULL, deleted_at = ?, updated_at = ?
       WHERE id = ?`,
      [`deleted-${stub}`, `del${stub.slice(0, 12)}`, now, now, user.id]);
    await tx.execute('DELETE FROM gov_profiles WHERE user_id = ?', [user.id]);
    await tx.execute('DELETE FROM private_profiles WHERE user_id = ?', [user.id]);
    await audit({ userId: user.id, action: 'user.deleted', entity: 'user', entityId: user.id }, tx);
  });
  files.forEach(removeFile);
}

module.exports = { getMe, resubmit, deleteAccount, publicUser };
