const { z } = require('zod');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { bad, conflict, forbidden } = require('../utils/httpError');
const config = require('../config');
const {
  isValidFullName, normalizeNic, isValidEmail, normalizeEmail, normalizePassengerType, isIsoDate,
} = require('../utils/validators');
const { hashNic, newId, safeEqual } = require('../utils/crypto');
const { nowSql } = require('../utils/time');
const { looksLikeImage } = require('../middleware/upload');
const { audit } = require('./audit');
const { signUserToken, verifyEmailToken } = require('../middleware/auth');

const optionalText = (max) => z.string().trim().max(max).optional().transform((v) => v || undefined);

const registrationSchema = z.object({
  passengerType: z.string().refine((v) => normalizePassengerType(v), 'Must be "government" or "private" (or "general")'),
  fullName: z.string().refine(isValidFullName, 'Enter your full name (letters only, at least 3 characters)'),
  nic: z.string().refine((v) => normalizeNic(v), 'Invalid NIC. Use 9 digits + V/X, or 12 digits'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  address: z.string().trim().min(3, 'Address is required').max(500),
  email: z.string().trim().optional().refine((v) => !v || isValidEmail(v), 'Invalid email address'),
  emailToken: z.string().trim().optional(), // from POST /auth/email/verify
  dateOfBirth: z.string().optional().refine((v) => !v || isIsoDate(v), 'Use YYYY-MM-DD'),
  preferredLanguage: z.enum(['en', 'si', 'ta']).optional(),
  consent: z.union([z.boolean(), z.string()]).refine((v) => v === true || v === 'true',
    'You must agree to the data collection notice'),
  // government only
  institutionId: optionalText(36),
  institution: optionalText(255),
  orgAuthCode: optionalText(100),
  employeeNo: optionalText(100),
  designation: optionalText(150),
  // private only
  employerName: optionalText(255),
});

const DOC_TYPES = [
  ['photo', 'Profile photo'],
  ['nicFront', 'NIC front image'],
  ['nicBack', 'NIC back image'],
];
const DOC_DB_TYPE = { photo: 'photo', nicFront: 'nic_front', nicBack: 'nic_back' };

function isDuplicateError(err) {
  return err && (err.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(err.message || ''));
}

function checkDocs(docs, { requireAll }) {
  for (const [key, label] of DOC_TYPES) {
    const f = docs[key];
    if (!f) {
      if (requireAll) throw bad(`${label} is required`, 'missing_document');
      continue;
    }
    if (!looksLikeImage(f.path)) throw bad(`${label} is not a valid JPEG or PNG image`, 'bad_file_type');
  }
}

async function findInstitution(data, runner) {
  let inst = null;
  if (data.institutionId) {
    inst = await db.one('SELECT * FROM institutions WHERE id = ? AND is_active = 1', [data.institutionId], runner);
  } else if (data.institution) {
    inst = await db.one('SELECT * FROM institutions WHERE LOWER(name) = LOWER(?) AND is_active = 1',
      [data.institution], runner);
  }
  // One generic message so the API doesn't reveal which part was wrong.
  const fail = () => forbidden('Institution or organisation authentication code is incorrect');
  if (!inst || !data.orgAuthCode || !safeEqual(data.orgAuthCode, inst.org_auth_code)) throw fail();
  return inst;
}

/**
 * Decides whether the e-mail in the form counts as verified.
 * Returns { email, verified }. Throws 400 when REQUIRE_EMAIL_VERIFICATION is on and proof is missing,
 * or when the proof was issued for a different address or phone number.
 */
function checkEmailProof({ phone, email: rawEmail, emailToken }) {
  const email = rawEmail ? normalizeEmail(rawEmail) : undefined;

  if (emailToken) {
    const proof = verifyEmailToken(emailToken);
    if (!proof) throw bad('The e-mail verification has expired. Verify your e-mail again', 'email_token_invalid');
    if (proof.phone !== phone) {
      throw bad('This e-mail was verified for a different phone number', 'email_token_mismatch');
    }
    if (!email || proof.email !== email) {
      throw bad('The e-mail was changed after it was verified. Verify it again', 'email_token_mismatch');
    }
    return { email, verified: true };
  }

  if (config.email.requireVerification) {
    throw bad(email ? 'Verify your e-mail address before registering' : 'An e-mail address is required',
      'email_not_verified');
  }
  return { email, verified: false };
}

/**
 * Creates the passenger account. `phone` comes from the verified OTP token, never from the body.
 * `docs` = { photo, nicFront, nicBack } multer file objects.
 */
async function registerPassenger({ phone, body, docs }) {
  const data = registrationSchema.parse(body);
  checkDocs(docs, { requireAll: true });
  const { email, verified: emailVerified } = checkEmailProof({ phone, email: data.email, emailToken: data.emailToken });

  const type = normalizePassengerType(data.passengerType);
  const nic = normalizeNic(data.nic);
  const nicHash = hashNic(nic);
  const passwordHash = await bcrypt.hash(data.password, 10);
  const userId = newId();
  const now = nowSql();
  const status = type === 'government' ? 'pending_institution_approval' : 'pending_verification';

  try {
    await db.transaction(async (tx) => {
      const dup = await db.one(
        'SELECT id FROM users WHERE phone = ? OR nic_hash = ? OR (email IS NOT NULL AND email = ?)',
        [phone, nicHash, email || null], tx);
      if (dup) throw conflict('An account with this phone, NIC or email already exists', 'already_registered');

      let institution = null;
      if (type === 'government') institution = await findInstitution(data, tx);

      await tx.execute(
        `INSERT INTO users (id, passenger_type, full_name, nic_hash, nic_last4, phone, password_hash, email,
                            email_verified_at, date_of_birth, address, preferred_language, verification_status,
                            consent_given_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, type, data.fullName.trim(), nicHash, nic.slice(-4), phone, passwordHash, email || null,
          emailVerified ? now : null, data.dateOfBirth || null, data.address, data.preferredLanguage || 'en',
          status, now, now, now]);

      if (type === 'government') {
        await tx.execute(
          'INSERT INTO gov_profiles (user_id, institution_id, employee_no, designation) VALUES (?, ?, ?, ?)',
          [userId, institution.id, data.employeeNo || null, data.designation || null]);
      } else {
        await tx.execute('INSERT INTO private_profiles (user_id, employer_name) VALUES (?, ?)',
          [userId, data.employerName || null]);
      }

      for (const [key] of DOC_TYPES) {
        await tx.execute(
          'INSERT INTO verification_docs (id, user_id, doc_type, file_url, uploaded_at) VALUES (?, ?, ?, ?, ?)',
          [newId(), userId, DOC_DB_TYPE[key], docs[key].filename, now]);
      }

      await audit({ userId, action: 'user.registered', entity: 'user', entityId: userId,
        details: { passengerType: type } }, tx);
    });
  } catch (err) {
    if (isDuplicateError(err)) {
      throw conflict('An account with this phone, NIC or email already exists', 'already_registered');
    }
    throw err;
  }

  return {
    userId,
    referenceNumber: `ES-${userId.slice(0, 8).toUpperCase()}`,
    verificationStatus: status,
    token: signUserToken(userId),
  };
}

module.exports = { registerPassenger, checkDocs, DOC_TYPES, DOC_DB_TYPE, isDuplicateError };
