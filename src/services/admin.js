const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../db');
const { bad, conflict, notFound } = require('../utils/httpError');
const { isIsoDate } = require('../utils/validators');
const { newId, randomToken } = require('../utils/crypto');
const { nowSql } = require('../utils/time');
const { audit } = require('./audit');
const { isDuplicateError } = require('./registration');

async function insertOrConflict(fn, message) {
  try { return await fn(); } catch (err) {
    if (isDuplicateError(err)) throw conflict(message, 'duplicate');
    throw err;
  }
}

// ----- institutions -----
const institutionSchema = z.object({ name: z.string().trim().min(3).max(255) });

async function createInstitution(admin, body) {
  const { name } = institutionSchema.parse(body);
  const id = newId();
  const code = `ORG-${randomToken(4).toUpperCase()}`;
  await insertOrConflict(() => db.execute(
    'INSERT INTO institutions (id, name, org_auth_code, is_active, registered_at) VALUES (?, ?, ?, 1, ?)',
    [id, name, code, nowSql()]), 'An institution with this name already exists');
  await audit({ staffId: admin.id, action: 'institution.created', entity: 'institution', entityId: id });
  return { id, name, orgAuthCode: code }; // shown to the admin so they can hand it to the institution
}

async function listInstitutions() {
  const rows = await db.query('SELECT id, name, org_auth_code, is_active FROM institutions ORDER BY name');
  return rows.map((r) => ({ id: r.id, name: r.name, orgAuthCode: r.org_auth_code, isActive: !!r.is_active }));
}

// ----- staff -----
const staffSchema = z.object({
  fullName: z.string().trim().min(3).max(255),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(128),
  role: z.enum(['station_staff', 'institution_officer', 'admin']),
  stationId: z.string().optional(),
  institutionId: z.string().optional(),
}).refine((v) => v.role !== 'institution_officer' || v.institutionId,
  { message: 'institutionId is required for institution officers', path: ['institutionId'] });

async function createStaff(admin, body) {
  const d = staffSchema.parse(body);
  if (d.institutionId && !(await db.one('SELECT id FROM institutions WHERE id = ?', [d.institutionId]))) {
    throw notFound('Institution not found');
  }
  if (d.stationId && !(await db.one('SELECT id FROM stations WHERE id = ?', [d.stationId]))) {
    throw notFound('Station not found');
  }
  const id = newId();
  await insertOrConflict(async () => db.execute(
    `INSERT INTO staff_users (id, full_name, email, password_hash, role, station_id, institution_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, d.fullName, d.email, await bcrypt.hash(d.password, 10), d.role,
      d.stationId || null, d.role === 'institution_officer' ? d.institutionId : null, nowSql()]),
  'A staff account with this e-mail already exists');
  await audit({ staffId: admin.id, action: 'staff.created', entity: 'staff', entityId: id, details: { role: d.role } });
  return { id, email: d.email, role: d.role };
}

async function listStaff() {
  const rows = await db.query(
    'SELECT id, full_name, email, role, station_id, institution_id, is_active FROM staff_users ORDER BY created_at');
  return rows.map((r) => ({
    id: r.id, fullName: r.full_name, email: r.email, role: r.role,
    stationId: r.station_id, institutionId: r.institution_id, isActive: !!r.is_active,
  }));
}

// ----- stations & fares -----
const stationSchema = z.object({
  name: z.string().trim().min(2).max(150),
  line: z.string().trim().max(100).optional(),
  hasSeatReservation: z.boolean().optional(),
});

async function createStation(admin, body) {
  const d = stationSchema.parse(body);
  const id = newId();
  await insertOrConflict(() => db.execute(
    'INSERT INTO stations (id, name, line, has_seat_reservation) VALUES (?, ?, ?, ?)',
    [id, d.name, d.line || null, d.hasSeatReservation ? 1 : 0]), 'A station with this name already exists');
  await audit({ staffId: admin.id, action: 'station.created', entity: 'station', entityId: id });
  return { id, name: d.name };
}

const fareSchema = z.object({
  fromStationId: z.string(),
  toStationId: z.string(),
  ticketClass: z.enum(['first', 'second', 'third']),
  period: z.enum(['weekly', 'monthly', 'quarterly']),
  passengerType: z.enum(['government', 'private']).nullable().optional(),
  amountLkr: z.number().nonnegative().max(1000000),
  effectiveFrom: z.string().refine(isIsoDate, 'Use YYYY-MM-DD').optional(),
});

async function createFare(admin, body) {
  const d = fareSchema.parse(body);
  if (d.fromStationId === d.toStationId) throw bad('Choose two different stations', 'same_station');
  const id = newId();
  const effective = d.effectiveFrom || new Date().toISOString().slice(0, 10);
  await insertOrConflict(() => db.execute(
    `INSERT INTO fares (id, from_station_id, to_station_id, ticket_class, period, passenger_type, amount_lkr, effective_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, d.fromStationId, d.toStationId, d.ticketClass, d.period, d.passengerType || null, d.amountLkr, effective]),
  'This fare already exists');
  await audit({ staffId: admin.id, action: 'fare.created', entity: 'fare', entityId: id });
  return { id };
}

// ----- application windows -----
const windowSchema = z.object({
  monthFor: z.string().refine(isIsoDate, 'Use YYYY-MM-01').refine((v) => v.endsWith('-01'), 'Use the first day of the month'),
  opensOn: z.string().refine(isIsoDate),
  closesOn: z.string().refine(isIsoDate),
}).refine((v) => v.closesOn >= v.opensOn, { message: 'closesOn must be on or after opensOn', path: ['closesOn'] });

async function createWindow(admin, body) {
  const d = windowSchema.parse(body);
  const id = newId();
  await db.execute('INSERT INTO application_windows (id, month_for, opens_on, closes_on) VALUES (?, ?, ?, ?)',
    [id, d.monthFor, d.opensOn, d.closesOn]);
  await audit({ staffId: admin.id, action: 'window.created', entity: 'application_window', entityId: id });
  return { id };
}

async function listAudit(limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await db.query(
    `SELECT id, actor_user_id, actor_staff_id, action, entity, entity_id, created_at
       FROM audit_logs ORDER BY id DESC LIMIT ${n}`);
  return rows.map((r) => ({
    id: Number(r.id), userId: r.actor_user_id, staffId: r.actor_staff_id, action: r.action,
    entity: r.entity, entityId: r.entity_id, createdAt: r.created_at,
  }));
}

module.exports = {
  createInstitution, listInstitutions, createStaff, listStaff, createStation, createFare, createWindow, listAudit,
};
