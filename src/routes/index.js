const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const db = require('../db');
const config = require('../config');
const { bad } = require('../utils/httpError');
const { normalizePhone } = require('../utils/validators');
const { getPublicKeyPem } = require('../utils/ticketToken');
const {
  requireUser, requireRegistration, requireStaff,
} = require('../middleware/auth');
const { registrationFiles, pickDocs, removeUploaded } = require('../middleware/upload');

const otp = require('../services/otp');
const passengerAuth = require('../services/passengerAuth');
const registration = require('../services/registration');
const me = require('../services/me');
const staffSvc = require('../services/staff');
const applications = require('../services/applications');
const tickets = require('../services/tickets');
const admin = require('../services/admin');

const router = express.Router();
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const inTest = process.env.NODE_ENV === 'test';
const limiter = (windowMinutes, limit) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => inTest,
  message: { error: { code: 'rate_limited', message: 'Too many requests. Try again later.' } },
});

/** multer wrapper that deletes already-saved files if the upload itself fails. */
function withUploads(req, res, next) {
  registrationFiles(req, res, (err) => {
    if (err) { removeUploaded(req); return next(err); }
    next();
  });
}

// ---------------------------------------------------------------- public
router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.get('/stations', h(async (req, res) => {
  const rows = await db.query('SELECT id, name, line, has_seat_reservation FROM stations ORDER BY name');
  res.json(rows.map((s) => ({ id: s.id, name: s.name, line: s.line, hasSeatReservation: !!s.has_seat_reservation })));
}));

// Names only. The organisation code stays secret, so this is safe to show in the sign-up dropdown.
router.get('/institutions', h(async (req, res) => {
  const rows = await db.query('SELECT id, name FROM institutions WHERE is_active = 1 ORDER BY name');
  res.json(rows);
}));

// Lets the inspector app verify QR tickets offline.
router.get('/ticket-public-key', (req, res) => res.type('text/plain').send(getPublicKeyPem()));

// ---------------------------------------------------------------- auth
router.post('/auth/otp/request', limiter(60, 10), h(async (req, res) => {
  res.json(await otp.requestOtp(req.body.phone));
}));

router.post('/auth/otp/verify', limiter(15, 20), h(async (req, res) => {
  res.json(await otp.verifyOtp(req.body.phone, req.body.code));
}));

router.post('/auth/login', limiter(15, 20), h(async (req, res) => {
  res.json(await passengerAuth.login(req.body.phone, req.body.password));
}));

router.post('/auth/staff/login', limiter(15, 20), h(async (req, res) => {
  res.json(await staffSvc.login(req.body.email, req.body.password));
}));

// ---------------------------------------------------------------- registration
router.post('/register', requireRegistration, withUploads, h(async (req, res) => {
  try {
    if (req.body.phone && normalizePhone(req.body.phone) !== req.registration.phone) {
      throw bad('Phone number does not match the verified number', 'phone_mismatch');
    }
    const result = await registration.registerPassenger({
      phone: req.registration.phone, body: req.body, docs: pickDocs(req),
    });
    res.status(201).json(result);
  } catch (err) {
    removeUploaded(req); // never keep ID images for a failed registration
    throw err;
  }
}));

// ---------------------------------------------------------------- passenger
router.get('/me', requireUser, h(async (req, res) => res.json(await me.getMe(req.user))));

router.put('/me/password', requireUser, h(async (req, res) => {
  res.json(await passengerAuth.changePassword(req.user, req.body));
}));

router.delete('/me', requireUser, h(async (req, res) => {
  await me.deleteAccount(req.user);
  res.status(204).end();
}));

router.post('/me/resubmit', requireUser, withUploads, h(async (req, res) => {
  try {
    res.json(await me.resubmit(req.user, pickDocs(req)));
  } catch (err) {
    removeUploaded(req);
    throw err;
  }
}));

router.post('/fares/quote', requireUser, h(async (req, res) => res.json(await applications.quote(req.user, req.body))));

router.post('/applications', requireUser, h(async (req, res) => {
  res.status(201).json(await applications.createApplication(req.user, req.body));
}));
router.get('/applications', requireUser, h(async (req, res) => res.json(await applications.listMine(req.user))));
router.get('/applications/:id', requireUser, h(async (req, res) => {
  res.json(await applications.getMine(req.user, req.params.id));
}));
router.post('/applications/:id/cancel', requireUser, h(async (req, res) => {
  res.json(await applications.cancelMine(req.user, req.params.id));
}));
router.post('/applications/:id/pay', requireUser, h(async (req, res) => {
  const result = await tickets.payForApplication(req.user, req.params.id, req.body, {
    allowSimulatedFailure: !config.isProd,
  });
  res.status(result.paid ? 201 : 402).json(result);
}));

router.get('/tickets', requireUser, h(async (req, res) => res.json(await tickets.listMine(req.user))));
router.get('/tickets/:id', requireUser, h(async (req, res) => res.json(await tickets.getMine(req.user, req.params.id))));

// ---------------------------------------------------------------- staff
const anyStaff = requireStaff('station_staff', 'institution_officer', 'admin');
const docTypeSchema = z.enum(['photo', 'nic_front', 'nic_back']);

router.get('/staff/users/pending', anyStaff, h(async (req, res) => {
  res.json(await staffSvc.listPendingUsers(req.staff));
}));
router.get('/staff/users/:id', anyStaff, h(async (req, res) => {
  res.json(await staffSvc.getUserDetail(req.staff, req.params.id));
}));
router.get('/staff/users/:id/docs/:type', anyStaff, h(async (req, res) => {
  const type = docTypeSchema.parse(req.params.type);
  const file = await staffSvc.getDocumentPath(req.staff, req.params.id, type);
  res.set('Cache-Control', 'no-store');
  res.sendFile(file);
}));

router.post('/staff/users/:id/institution-decision', requireStaff('institution_officer'), h(async (req, res) => {
  res.json(await staffSvc.decideInstitution(req.staff, req.params.id, req.body));
}));
router.post('/staff/users/:id/verification-decision', requireStaff('admin'), h(async (req, res) => {
  res.json(await staffSvc.decideVerification(req.staff, req.params.id, req.body));
}));

router.get('/staff/applications/pending', requireStaff('institution_officer'), h(async (req, res) => {
  res.json(await applications.listForOfficer(req.staff));
}));
router.post('/staff/applications/:id/decision', requireStaff('institution_officer'), h(async (req, res) => {
  res.json(await applications.decideApplication(req.staff, req.params.id, req.body));
}));

router.post('/staff/tickets/scan', requireStaff('station_staff', 'admin'), h(async (req, res) => {
  res.json(await tickets.scanTicket(req.staff, req.body));
}));

// ---------------------------------------------------------------- admin (system management only)
const adminOnly = requireStaff('admin');
router.get('/admin/institutions', adminOnly, h(async (req, res) => res.json(await admin.listInstitutions())));
router.post('/admin/institutions', adminOnly, h(async (req, res) => {
  res.status(201).json(await admin.createInstitution(req.staff, req.body));
}));
router.get('/admin/staff', adminOnly, h(async (req, res) => res.json(await admin.listStaff())));
router.post('/admin/staff', adminOnly, h(async (req, res) => {
  res.status(201).json(await admin.createStaff(req.staff, req.body));
}));
router.post('/admin/stations', adminOnly, h(async (req, res) => {
  res.status(201).json(await admin.createStation(req.staff, req.body));
}));
router.post('/admin/fares', adminOnly, h(async (req, res) => {
  res.status(201).json(await admin.createFare(req.staff, req.body));
}));
router.post('/admin/application-windows', adminOnly, h(async (req, res) => {
  res.status(201).json(await admin.createWindow(req.staff, req.body));
}));
router.get('/admin/audit', adminOnly, h(async (req, res) => res.json(await admin.listAudit(req.query.limit))));

module.exports = router;
