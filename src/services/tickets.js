const { z } = require('zod');
const db = require('../db');
const { conflict, notFound, forbidden } = require('../utils/httpError');
const { newId, randomToken } = require('../utils/crypto');
const { nowSql, todayLK, ticketEndDate } = require('../utils/time');
const { signTicket, verifyTicketToken } = require('../utils/ticketToken');
const { audit } = require('./audit');

const paySchema = z.object({
  // Sandbox only. "fail" lets you demo a declined payment (disabled in production).
  simulate: z.enum(['success', 'fail']).optional(),
});

const TICKET_SELECT = `
  SELECT t.*, fs.name AS from_name, ts.name AS to_name
    FROM season_tickets t
    JOIN stations fs ON fs.id = t.from_station_id
    JOIN stations ts ON ts.id = t.to_station_id`;

function effectiveStatus(t) {
  return t.status === 'active' && t.valid_to < todayLK() ? 'expired' : t.status;
}

function formatTicket(t, { withToken = false } = {}) {
  return {
    id: t.id,
    applicationId: t.application_id,
    fromStation: t.from_name,
    toStation: t.to_name,
    ticketClass: t.ticket_class,
    validFrom: t.valid_from,
    validTo: t.valid_to,
    status: effectiveStatus(t),
    issuedAt: t.issued_at,
    ...(withToken ? { qrToken: t.signed_token } : {}),
  };
}

/**
 * Sandbox payment. No card data is accepted or stored. On success the application becomes
 * "paid" and a signed season ticket is issued, all in one transaction.
 */
async function payForApplication(user, applicationId, body, { allowSimulatedFailure }) {
  const { simulate } = paySchema.parse(body || {});
  const now = nowSql();

  return db.transaction(async (tx) => {
    if (user.verification_status !== 'verified') throw forbidden('Your identity is not verified', 'not_verified');
    const app = await db.one('SELECT * FROM applications WHERE id = ? AND user_id = ?', [applicationId, user.id], tx);
    if (!app) throw notFound('Application not found');
    if (app.status === 'paid') throw conflict('This application is already paid', 'already_paid');
    if (app.status !== 'approved_awaiting_payment') {
      throw conflict(`Payment is not available for this application (status: ${app.status})`, 'wrong_status');
    }

    const paymentId = newId();
    if (simulate === 'fail' && allowSimulatedFailure) {
      await tx.execute(
        `INSERT INTO payments (id, application_id, amount_lkr, status, gateway_ref, created_at)
         VALUES (?, ?, ?, 'failed', ?, ?)`, [paymentId, app.id, app.fare_lkr, `SBX-${randomToken(8)}`, now]);
      return { paid: false, paymentId, message: 'Sandbox payment declined. Try again.' };
    }

    const upd = await tx.execute(
      "UPDATE applications SET status = 'paid' WHERE id = ? AND status = 'approved_awaiting_payment'", [app.id]);
    if (upd.affectedRows !== 1) throw conflict('This application was just updated. Reload and try again', 'wrong_status');

    await tx.execute(
      `INSERT INTO payments (id, application_id, amount_lkr, status, gateway_ref, paid_at, created_at)
       VALUES (?, ?, ?, 'success', ?, ?, ?)`, [paymentId, app.id, app.fare_lkr, `SBX-${randomToken(8)}`, now, now]);

    const stations = await tx.query('SELECT id, name FROM stations WHERE id IN (?, ?)',
      [app.from_station_id, app.to_station_id]);
    const nameOf = (id) => (stations.find((s) => s.id === id) || {}).name;

    const ticketId = newId();
    const validTo = ticketEndDate(app.start_date, app.period, app.duration_months);
    const token = signTicket({
      ticketId,
      holderName: user.full_name,
      fromStation: nameOf(app.from_station_id),
      toStation: nameOf(app.to_station_id),
      ticketClass: app.ticket_class,
      validFrom: app.start_date,
      validTo,
    });
    await tx.execute(
      `INSERT INTO season_tickets (id, application_id, user_id, from_station_id, to_station_id, ticket_class,
                                   valid_from, valid_to, signed_token, status, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [ticketId, app.id, user.id, app.from_station_id, app.to_station_id, app.ticket_class,
        app.start_date, validTo, token, now]);
    await audit({ userId: user.id, action: 'payment.success', entity: 'application', entityId: app.id,
      details: { paymentId, ticketId } }, tx);

    return {
      paid: true,
      paymentId,
      ticket: formatTicket(await db.one(`${TICKET_SELECT} WHERE t.id = ?`, [ticketId], tx), { withToken: true }),
    };
  });
}

async function listMine(user) {
  const rows = await db.query(`${TICKET_SELECT} WHERE t.user_id = ? ORDER BY t.issued_at DESC`, [user.id]);
  return rows.map((t) => formatTicket(t, { withToken: true }));
}

async function getMine(user, id) {
  const t = await db.one(`${TICKET_SELECT} WHERE t.id = ? AND t.user_id = ?`, [id, user.id]);
  if (!t) throw notFound('Ticket not found');
  return formatTicket(t, { withToken: true });
}

const scanSchema = z.object({ token: z.string().min(20).max(4096) });

/** Inspector scan: signature + dates + live status (revoked tickets, deleted accounts). */
async function scanTicket(staff, body) {
  const { token } = scanSchema.parse(body);
  const v = verifyTicketToken(token);

  if (!v.ok && v.reason === 'invalid') {
    await audit({ staffId: staff.id, action: 'ticket.scan', entity: 'ticket', details: { result: 'invalid' } });
    return { result: 'invalid', message: 'Not a genuine e_season ticket' };
  }

  const t = await db.one(
    `${TICKET_SELECT.replace('SELECT t.*,', 'SELECT t.*, u.full_name AS holder_name, u.deleted_at AS user_deleted,')}
       JOIN users u ON u.id = t.user_id WHERE t.id = ?`, [v.payload.sub]);
  if (!t) {
    await audit({ staffId: staff.id, action: 'ticket.scan', entity: 'ticket', details: { result: 'invalid' } });
    return { result: 'invalid', message: 'Ticket not found' };
  }

  let result = 'valid';
  const today = todayLK();
  if (t.status === 'revoked' || t.user_deleted) result = 'revoked';
  else if (!v.ok || t.valid_to < today) result = 'expired';
  else if (t.valid_from > today) result = 'invalid';

  await db.execute(
    'INSERT INTO ticket_scans (id, ticket_id, inspector_id, result, scanned_at) VALUES (?, ?, ?, ?, ?)',
    [newId(), t.id, staff.id, result, nowSql()]);

  return {
    result,
    holder: { name: t.holder_name, photoUrl: `/api/staff/users/${t.user_id}/docs/photo` },
    fromStation: t.from_name,
    toStation: t.to_name,
    ticketClass: t.ticket_class,
    validFrom: t.valid_from,
    validTo: t.valid_to,
    message: result === 'valid' ? 'Valid ticket'
      : result === 'expired' ? 'Ticket has expired'
        : result === 'revoked' ? 'Ticket has been revoked' : 'Ticket is not valid yet',
  };
}

module.exports = { payForApplication, listMine, getMine, scanTicket };
