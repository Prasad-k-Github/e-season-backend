const path = require('path');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { bad, conflict, forbidden, notFound, unauthorized } = require('../utils/httpError');
const { nowSql } = require('../utils/time');
const { newId } = require('../utils/crypto');
const { removeFile } = require('../middleware/upload');
const { signStaffToken } = require('../middleware/auth');
const { audit } = require('./audit');

// Compared against when the e-mail is unknown, so response time doesn't reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function login(email, password) {
  const staff = await db.one('SELECT * FROM staff_users WHERE email = ? AND is_active = 1',
    [String(email || '').trim().toLowerCase()]);
  const ok = await bcrypt.compare(String(password || ''), staff ? staff.password_hash : DUMMY_HASH);
  if (!staff || !ok) throw unauthorized('Incorrect e-mail or password');
  return {
    token: signStaffToken(staff.id),
    staff: { id: staff.id, fullName: staff.full_name, role: staff.role },
  };
}

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(500).optional(),
}).refine((v) => v.decision === 'approved' || (v.reason && v.reason.length >= 3),
  { message: 'A reason is required when rejecting', path: ['reason'] });

const userRow = (r) => ({
  id: r.id,
  fullName: r.full_name,
  passengerType: r.passenger_type,
  phone: r.phone,
  nicLast4: r.nic_last4,
  verificationStatus: r.verification_status,
  institution: r.institution || null,
  employeeNo: r.employee_no || null,
  designation: r.designation || null,
  submittedAt: r.created_at,
});

const USER_SELECT = `
  SELECT u.id, u.full_name, u.passenger_type, u.phone, u.nic_last4, u.verification_status, u.created_at,
         g.employee_no, g.designation, g.institution_id, i.name AS institution
    FROM users u
    LEFT JOIN gov_profiles g ON g.user_id = u.id
    LEFT JOIN institutions i ON i.id = g.institution_id`;

/** Work queue: officers see their institution's employees; station staff / admins see identity checks. */
async function listPendingUsers(staff) {
  if (staff.role === 'institution_officer') {
    const rows = await db.query(
      `${USER_SELECT} WHERE g.institution_id = ? AND u.verification_status = 'pending_institution_approval'
         AND u.deleted_at IS NULL ORDER BY u.created_at`, [staff.institution_id]);
    return rows.map(userRow);
  }
  const rows = await db.query(
    `${USER_SELECT} WHERE u.verification_status = 'pending_verification' AND u.deleted_at IS NULL
      ORDER BY u.created_at`);
  return rows.map(userRow);
}

async function loadUserForStaff(staff, userId, runner) {
  const u = await db.one(`${USER_SELECT} WHERE u.id = ? AND u.deleted_at IS NULL`, [userId], runner);
  if (!u) throw notFound('Passenger not found');
  if (staff.role === 'institution_officer' && u.institution_id !== staff.institution_id) {
    throw forbidden('This passenger belongs to a different institution');
  }
  return u;
}

async function getUserDetail(staff, userId) {
  const u = await loadUserForStaff(staff, userId);
  const docs = await db.query('SELECT doc_type, uploaded_at FROM verification_docs WHERE user_id = ?', [userId]);
  return {
    ...userRow(u),
    documents: docs.map((d) => ({
      type: d.doc_type,
      uploadedAt: d.uploaded_at,
      url: `/api/staff/users/${userId}/docs/${d.doc_type}`,
    })),
  };
}

/** Returns the absolute path of a stored document (access-checked). */
async function getDocumentPath(staff, userId, docType) {
  await loadUserForStaff(staff, userId);
  const doc = await db.one('SELECT file_url FROM verification_docs WHERE user_id = ? AND doc_type = ?',
    [userId, docType]);
  if (!doc) throw notFound('Document not found (NIC images are deleted once a passenger is verified)');
  await audit({ staffId: staff.id, action: 'document.viewed', entity: 'user', entityId: userId,
    details: { docType } });
  return path.join(config.uploadDir, path.basename(doc.file_url));
}

/** Institution officer: confirm that the person works at the institution. */
async function decideInstitution(officer, userId, body) {
  const { decision, reason } = decisionSchema.parse(body);
  const now = nowSql();
  await db.transaction(async (tx) => {
    const u = await loadUserForStaff(officer, userId, tx);
    if (u.verification_status !== 'pending_institution_approval') {
      throw conflict(`Passenger is not waiting for institution approval (status: ${u.verification_status})`,
        'wrong_status');
    }
    const next = decision === 'approved' ? 'pending_verification' : 'rejected';
    const upd = await tx.execute(
      `UPDATE users SET verification_status = ?, rejection_reason = ?, updated_at = ?
        WHERE id = ? AND verification_status = 'pending_institution_approval'`,
      [next, decision === 'rejected' ? reason : null, now, userId]);
    if (upd.affectedRows !== 1) throw conflict('Passenger was already reviewed', 'wrong_status');
    if (decision === 'approved') {
      await tx.execute('UPDATE gov_profiles SET approved_by = ?, approved_at = ? WHERE user_id = ?',
        [officer.id, now, userId]);
    }
    await tx.execute(
      'INSERT INTO verification_reviews (id, user_id, reviewer_id, decision, reason, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [newId(), userId, officer.id, decision, reason || null, now]);
    await audit({ staffId: officer.id, action: `institution.${decision}`, entity: 'user', entityId: userId }, tx);
  });
  return { status: decision === 'approved' ? 'pending_verification' : 'rejected' };
}

/** Admin: final identity check of NIC + photo. Approval deletes the NIC images (data minimisation). */
async function decideVerification(staff, userId, body) {
  const { decision, reason } = decisionSchema.parse(body);
  const now = nowSql();
  const filesToDelete = [];
  await db.transaction(async (tx) => {
    const u = await loadUserForStaff(staff, userId, tx);
    if (u.verification_status !== 'pending_verification') {
      throw conflict(`Passenger is not waiting for identity verification (status: ${u.verification_status})`,
        'wrong_status');
    }
    const next = decision === 'approved' ? 'verified' : 'rejected';
    const upd = await tx.execute(
      `UPDATE users SET verification_status = ?, rejection_reason = ?, updated_at = ?
        WHERE id = ? AND verification_status = 'pending_verification'`,
      [next, decision === 'rejected' ? reason : null, now, userId]);
    if (upd.affectedRows !== 1) throw conflict('Passenger was already reviewed', 'wrong_status');

    if (decision === 'approved') {
      const nicDocs = await tx.query(
        "SELECT file_url FROM verification_docs WHERE user_id = ? AND doc_type IN ('nic_front','nic_back')", [userId]);
      nicDocs.forEach((d) => filesToDelete.push(d.file_url));
      await tx.execute("DELETE FROM verification_docs WHERE user_id = ? AND doc_type IN ('nic_front','nic_back')",
        [userId]);
    }
    await tx.execute(
      'INSERT INTO verification_reviews (id, user_id, reviewer_id, decision, reason, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [newId(), userId, staff.id, decision, reason || null, now]);
    await audit({ staffId: staff.id, action: `verification.${decision}`, entity: 'user', entityId: userId }, tx);
  });
  filesToDelete.forEach(removeFile);
  return { status: decision === 'approved' ? 'verified' : 'rejected' };
}

module.exports = {
  login, listPendingUsers, getUserDetail, getDocumentPath, decideInstitution, decideVerification, decisionSchema,
};
