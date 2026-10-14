const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { bad, conflict, forbidden, notFound } = require('../utils/httpError');
const { isIsoDate } = require('../utils/validators');
const { newId } = require('../utils/crypto');
const { nowSql, todayLK, addDays, ticketEndDate } = require('../utils/time');
const { audit } = require('./audit');
const { decisionSchema } = require('./staff');

const CLASSES = ['first', 'second', 'third'];
const PERIODS = ['weekly', 'monthly', 'quarterly'];
const OPEN_STATUSES = ['draft', 'pending_institution_approval', 'approved_awaiting_payment', 'paid'];

const applicationSchema = z.object({
  fromStationId: z.string().min(1),
  toStationId: z.string().min(1),
  ticketClass: z.enum(CLASSES),
  period: z.enum(PERIODS),
  startDate: z.string().refine(isIsoDate, 'Use YYYY-MM-DD'),
  durationMonths: z.coerce.number().int().min(1).max(3).optional(),
});

const quoteSchema = applicationSchema.omit({ startDate: true });

/** Cheapest-specific fare: a row for this passenger type beats a generic one; newest effective date wins. */
async function findFare({ fromId, toId, ticketClass, period, passengerType, today }, runner) {
  const q = runner ? runner.query.bind(runner) : db.query;
  const rows = await q(
    `SELECT * FROM fares
      WHERE ticket_class = ? AND period = ? AND effective_from <= ?
        AND ((from_station_id = ? AND to_station_id = ?) OR (from_station_id = ? AND to_station_id = ?))
        AND (passenger_type = ? OR passenger_type IS NULL)`,
    [ticketClass, period, today, fromId, toId, toId, fromId, passengerType]);
  rows.sort((a, b) => (a.passenger_type ? 0 : 1) - (b.passenger_type ? 0 : 1)
    || String(b.effective_from).localeCompare(String(a.effective_from)));
  return rows[0] || null;
}

/** Applies the rules from the circular: government = monthly, 1-3 months; private = weekly/monthly/quarterly. */
function resolveTerm(passengerType, period, durationMonths) {
  if (passengerType === 'government') {
    if (period !== 'monthly') {
      throw bad('Government concessionary tickets are monthly (1 to 3 months)', 'bad_period');
    }
    return { fareMonths: durationMonths || 1, duration: durationMonths || 1 };
  }
  if (period === 'monthly' && durationMonths && durationMonths !== 1) {
    throw bad('Use the quarterly period for 3 months', 'bad_period');
  }
  return { fareMonths: 1, duration: period === 'quarterly' ? 3 : period === 'monthly' ? 1 : null };
}

async function stationsExist(ids, runner) {
  const q = runner ? runner.query.bind(runner) : db.query;
  const rows = await q(`SELECT id FROM stations WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  return rows.length === new Set(ids).size;
}

async function quote(user, body) {
  const d = quoteSchema.parse(body);
  if (d.fromStationId === d.toStationId) throw bad('Choose two different stations', 'same_station');
  if (!(await stationsExist([d.fromStationId, d.toStationId]))) throw notFound('Station not found');
  const { fareMonths, duration } = resolveTerm(user.passenger_type, d.period, d.durationMonths);
  const fare = await findFare({
    fromId: d.fromStationId, toId: d.toStationId, ticketClass: d.ticketClass,
    period: d.period, passengerType: user.passenger_type, today: todayLK(),
  });
  if (!fare) throw notFound('No fare is defined for this route, class and period', 'no_fare');
  return { fareLkr: Number(fare.amount_lkr) * fareMonths, durationMonths: duration };
}

const APP_SELECT = `
  SELECT a.*, fs.name AS from_name, ts.name AS to_name
    FROM applications a
    JOIN stations fs ON fs.id = a.from_station_id
    JOIN stations ts ON ts.id = a.to_station_id`;

function formatApplication(a) {
  return {
    id: a.id,
    fromStationId: a.from_station_id,
    toStationId: a.to_station_id,
    fromStation: a.from_name,
    toStation: a.to_name,
    ticketClass: a.ticket_class,
    period: a.period,
    durationMonths: a.duration_months,
    startDate: a.start_date,
    endDate: ticketEndDate(a.start_date, a.period, a.duration_months),
    fareLkr: Number(a.fare_lkr),
    status: a.status,
    rejectionReason: a.rejection_reason,
    createdAt: a.created_at,
    ...(a.holder_name ? { holderName: a.holder_name } : {}),
  };
}

async function checkWindow(startDate, today, runner) {
  if (!config.enforceWindows) return;
  const monthFor = `${startDate.slice(0, 7)}-01`;
  const w = await db.one(
    'SELECT id FROM application_windows WHERE month_for = ? AND opens_on <= ? AND closes_on >= ?',
    [monthFor, today, today], runner);
  if (!w) throw forbidden('Applications for that month are not open right now', 'window_closed');
}

async function createApplication(user, body) {
  if (user.verification_status !== 'verified') {
    throw forbidden('Your identity must be verified before you can apply', 'not_verified');
  }
  const d = applicationSchema.parse(body);
  if (d.fromStationId === d.toStationId) throw bad('Choose two different stations', 'same_station');

  const today = todayLK();
  if (d.startDate < today) throw bad('Start date cannot be in the past', 'bad_start_date');
  if (d.startDate > addDays(today, 60)) throw bad('Start date is too far ahead (max 60 days)', 'bad_start_date');

  const { fareMonths, duration } = resolveTerm(user.passenger_type, d.period, d.durationMonths);
  const newEnd = ticketEndDate(d.startDate, d.period, duration);
  const status = user.passenger_type === 'government' ? 'pending_institution_approval' : 'approved_awaiting_payment';

  return db.transaction(async (tx) => {
    if (!(await stationsExist([d.fromStationId, d.toStationId], tx))) throw notFound('Station not found');
    await checkWindow(d.startDate, today, tx);

    const fare = await findFare({
      fromId: d.fromStationId, toId: d.toStationId, ticketClass: d.ticketClass,
      period: d.period, passengerType: user.passenger_type, today,
    }, tx);
    if (!fare) throw notFound('No fare is defined for this route, class and period', 'no_fare');

    // No overlapping season for the same person.
    const open = await tx.query(
      `SELECT start_date, period, duration_months FROM applications
        WHERE user_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`,
      [user.id, ...OPEN_STATUSES]);
    const overlaps = open.some((o) =>
      o.start_date <= newEnd && ticketEndDate(o.start_date, o.period, o.duration_months) >= d.startDate);
    if (overlaps) throw conflict('You already have a season ticket application for these dates', 'overlap');

    const id = newId();
    const now = nowSql();
    await tx.execute(
      `INSERT INTO applications (id, user_id, from_station_id, to_station_id, ticket_class, period, duration_months,
                                 start_date, fare_lkr, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, user.id, d.fromStationId, d.toStationId, d.ticketClass, d.period, duration, d.startDate,
        Number(fare.amount_lkr) * fareMonths, status, now]);
    await audit({ userId: user.id, action: 'application.created', entity: 'application', entityId: id }, tx);
    return formatApplication(await db.one(`${APP_SELECT} WHERE a.id = ?`, [id], tx));
  });
}

async function listMine(user) {
  const rows = await db.query(`${APP_SELECT} WHERE a.user_id = ? ORDER BY a.created_at DESC`, [user.id]);
  return rows.map(formatApplication);
}

async function getMine(user, id) {
  const a = await db.one(`${APP_SELECT} WHERE a.id = ? AND a.user_id = ?`, [id, user.id]);
  if (!a) throw notFound('Application not found');
  return formatApplication(a);
}

async function cancelMine(user, id) {
  const a = await db.one('SELECT status FROM applications WHERE id = ? AND user_id = ?', [id, user.id]);
  if (!a) throw notFound('Application not found');
  const upd = await db.execute(
    `UPDATE applications SET status = 'cancelled'
      WHERE id = ? AND user_id = ? AND status IN ('draft','pending_institution_approval','approved_awaiting_payment')`,
    [id, user.id]);
  if (upd.affectedRows !== 1) throw conflict('This application can no longer be cancelled', 'wrong_status');
  await audit({ userId: user.id, action: 'application.cancelled', entity: 'application', entityId: id });
  return { status: 'cancelled' };
}

// ---------- Institution officer ----------

async function listForOfficer(officer) {
  const rows = await db.query(
    `${APP_SELECT.replace('SELECT a.*,', 'SELECT a.*, u.full_name AS holder_name,')}
       JOIN users u ON u.id = a.user_id
       JOIN gov_profiles g ON g.user_id = u.id
      WHERE g.institution_id = ? AND a.status = 'pending_institution_approval'
      ORDER BY a.created_at`, [officer.institution_id]);
  return rows.map(formatApplication);
}

async function decideApplication(officer, applicationId, body) {
  const { decision, reason } = decisionSchema.parse(body);
  const now = nowSql();
  await db.transaction(async (tx) => {
    const a = await db.one(
      `SELECT a.id, a.status, g.institution_id FROM applications a
         JOIN gov_profiles g ON g.user_id = a.user_id WHERE a.id = ?`, [applicationId], tx);
    if (!a) throw notFound('Application not found');
    if (a.institution_id !== officer.institution_id) throw forbidden('This application belongs to a different institution');
    if (a.status !== 'pending_institution_approval') {
      throw conflict(`Application is not waiting for approval (status: ${a.status})`, 'wrong_status');
    }
    const next = decision === 'approved' ? 'approved_awaiting_payment' : 'rejected';
    const upd = await tx.execute(
      `UPDATE applications SET status = ?, rejection_reason = ?, institution_approved_by = ?, institution_approved_at = ?
        WHERE id = ? AND status = 'pending_institution_approval'`,
      [next, decision === 'rejected' ? reason : null, officer.id, now, applicationId]);
    if (upd.affectedRows !== 1) throw conflict('Application was already reviewed', 'wrong_status');
    await audit({ staffId: officer.id, action: `application.${decision}`, entity: 'application',
      entityId: applicationId }, tx);
  });
  return { status: decision === 'approved' ? 'approved_awaiting_payment' : 'rejected' };
}

module.exports = {
  quote, createApplication, listMine, getMine, cancelMine, listForOfficer, decideApplication,
  findFare, formatApplication,
};
