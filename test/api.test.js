const { uploadDir } = require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../src/db');
const { createApp } = require('../src/app');
const { createSqliteAdapter } = require('./helpers/sqliteDb');
const { todayLK, addDays, ticketEndDate } = require('../src/utils/time');
const { signTicket } = require('../src/utils/ticketToken');

let server;
let base;
const ids = {};
const state = {};

const PASSWORD = 'Passw0rd#123';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function api(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`${base}/api${path}`, { method, headers, body });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  return { status: res.status, data, res };
}

function regForm(fields, { files = ['photo', 'nicFront', 'nicBack'], jpegAsPng = false } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ password: PASSWORD, ...fields })) form.append(k, v);
  for (const f of files) {
    const bytes = f === 'nicBack' ? PNG : JPEG;
    const mime = f === 'nicBack' && !jpegAsPng ? 'image/png' : 'image/jpeg';
    form.append(f, new Blob([bytes], { type: mime }), `${f}.${mime === 'image/png' ? 'png' : 'jpg'}`);
  }
  return form;
}

async function registrationToken(phone) {
  const r = await api('POST', '/auth/otp/request', { json: { phone } });
  assert.equal(r.status, 200);
  const v = await api('POST', '/auth/otp/verify', { json: { phone, code: r.data.devCode } });
  assert.equal(v.status, 200);
  return v.data;
}

async function registerPrivate({ phone, nic, name = 'Kasun Perera' }) {
  const { registrationToken: token } = await registrationToken(phone);
  return api('POST', '/register', {
    token,
    form: regForm({
      passengerType: 'general', fullName: name, nic, address: '12 Temple Road, Colombo',
      email: `u${phone}@example.com`, consent: 'true',
    }),
  });
}

const login = async (email) =>
  (await api('POST', '/auth/staff/login', { json: { email, password: 'Staff#12345' } })).data.token;
const uploadCount = () => fs.readdirSync(uploadDir).length;

test.before(async () => {
  const adapter = createSqliteAdapter();
  db.setDb(adapter);
  const hash = await bcrypt.hash('Staff#12345', 4);
  const x = (sql, p) => adapter.execute(sql, p);

  ids.fort = 'st-fort'; ids.galle = 'st-galle';
  await x("INSERT INTO stations (id, name, line, has_seat_reservation) VALUES ('st-fort','Colombo Fort','Coastal',1)");
  await x("INSERT INTO stations (id, name, line, has_seat_reservation) VALUES ('st-galle','Galle','Coastal',1)");
  // fares (sample numbers): generic private fares + a cheaper government monthly fare
  const fare = (id, cls, period, ptype, amt) => x(
    `INSERT INTO fares (id, from_station_id, to_station_id, ticket_class, period, passenger_type, amount_lkr, effective_from)
     VALUES (?, 'st-fort', 'st-galle', ?, ?, ?, ?, '2026-01-01')`, [id, cls, period, ptype, amt]);
  await fare('f1', 'second', 'monthly', null, 1000);
  await fare('f2', 'second', 'weekly', null, 400);
  await fare('f3', 'second', 'quarterly', null, 2700);
  await fare('f4', 'second', 'monthly', 'government', 500);

  await x("INSERT INTO institutions (id, name, org_auth_code, is_active, registered_at) VALUES ('inst-edu','Ministry of Education','EDU-CODE-1',1,'2026-01-01 00:00:00')");
  await x("INSERT INTO institutions (id, name, org_auth_code, is_active, registered_at) VALUES ('inst-health','Ministry of Health','HEALTH-CODE-1',1,'2026-01-01 00:00:00')");

  const staff = (id, email, role, stationId, instId) => x(
    `INSERT INTO staff_users (id, full_name, email, password_hash, role, station_id, institution_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, '2026-01-01 00:00:00')`, [id, id, email, hash, role, stationId, instId]);
  await staff('s-admin', 'admin@t.test', 'admin', null, null);
  await staff('s-station', 'station@t.test', 'station_staff', 'st-fort', null);
  await staff('s-edu', 'edu@t.test', 'institution_officer', null, 'inst-edu');
  await staff('s-health', 'health@t.test', 'institution_officer', null, 'inst-health');

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  state.admin = await login('admin@t.test');
  state.station = await login('station@t.test');
  state.edu = await login('edu@t.test');
  state.health = await login('health@t.test');
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
});

test('health and auth guards', async () => {
  assert.equal((await api('GET', '/health')).status, 200);
  assert.equal((await api('GET', '/me')).status, 401);
  assert.equal((await api('GET', '/staff/users/pending')).status, 401);
  assert.equal((await api('GET', '/me', { token: 'junk' })).status, 401);
  assert.equal((await api('GET', '/nope')).status, 404);
  const stations = await api('GET', '/stations');
  assert.equal(stations.data.length, 2);
  const inst = await api('GET', '/institutions');
  assert.equal(inst.data.length, 2);
  assert.equal(JSON.stringify(inst.data).includes('CODE'), false, 'org codes must never be public');
});

test('OTP: validation, wrong code, then success', async () => {
  assert.equal((await api('POST', '/auth/otp/request', { json: { phone: '12345' } })).status, 400);
  const r = await api('POST', '/auth/otp/request', { json: { phone: '0771110000' } });
  assert.equal(r.status, 200);
  assert.match(r.data.devCode, /^\d{6}$/);
  const wrong = r.data.devCode === '000000' ? '111111' : '000000';
  const bad = await api('POST', '/auth/otp/verify', { json: { phone: '0771110000', code: wrong } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'otp_incorrect');
  const ok = await api('POST', '/auth/otp/verify', { json: { phone: '0771110000', code: r.data.devCode } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.registered, false);
  assert.ok(ok.data.registrationToken);
  // a used code cannot be used again
  const again = await api('POST', '/auth/otp/verify', { json: { phone: '0771110000', code: r.data.devCode } });
  assert.equal(again.status, 400);
});

test('registration: validation errors leave no files behind', async () => {
  const { registrationToken: token } = await registrationToken('0772220000');
  const before = uploadCount();

  const badNic = await api('POST', '/register', {
    token, form: regForm({ passengerType: 'general', fullName: 'Kasun Perera', nic: '123', address: 'Colombo', consent: 'true' }),
  });
  assert.equal(badNic.status, 400);
  assert.equal(badNic.data.error.code, 'validation_error');
  assert.ok(badNic.data.error.details.some((d) => d.field === 'nic'));

  const noConsent = await api('POST', '/register', {
    token, form: regForm({ passengerType: 'general', fullName: 'Kasun Perera', nic: '912345678V', address: 'Colombo' }),
  });
  assert.equal(noConsent.status, 400);

  const noDoc = await api('POST', '/register', {
    token, form: regForm({ passengerType: 'general', fullName: 'Kasun Perera', nic: '912345678V', address: 'Colombo', consent: 'true' },
      { files: ['photo', 'nicFront'] }),
  });
  assert.equal(noDoc.status, 400);
  assert.equal(noDoc.data.error.code, 'missing_document');

  // a text file pretending to be a JPEG is rejected by signature check
  const fake = new FormData();
  Object.entries({ password: PASSWORD, passengerType: 'general', fullName: 'Kasun Perera', nic: '912345678V', address: 'Colombo', consent: 'true' })
    .forEach(([k, v]) => fake.append(k, v));
  for (const f of ['photo', 'nicFront', 'nicBack']) {
    fake.append(f, new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }), `${f}.jpg`);
  }
  const spoof = await api('POST', '/register', { token, form: fake });
  assert.equal(spoof.status, 400);
  assert.equal(spoof.data.error.code, 'bad_file_type');

  assert.equal(uploadCount(), before, 'failed registrations must not keep uploaded files');
  assert.equal((await api('POST', '/register', { form: regForm({}) })).status, 401);
});

test('registration: private passenger, then duplicate NIC is blocked', async () => {
  const r = await registerPrivate({ phone: '0773330001', nic: '912345678V' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.verificationStatus, 'pending_verification');
  assert.match(r.data.referenceNumber, /^ES-[0-9A-F]{8}$/);
  state.priv = r.data;

  const me = await api('GET', '/me', { token: r.data.token });
  assert.equal(me.data.passengerType, 'private');
  assert.equal(me.data.nicLast4, '678V'); // last four characters only, never the full NIC
  assert.equal(JSON.stringify(me.data).includes('912345678'), false);

  const row = await db.one('SELECT nic_hash FROM users WHERE id = ?', [r.data.userId]);
  assert.equal(row.nic_hash.includes('912345678'), false, 'raw NIC must not be stored');

  const dup = await registerPrivate({ phone: '0773330002', nic: '912345678v' }); // same NIC, other case
  assert.equal(dup.status, 409);
  // A phone that already has an account signs in instead of getting a registration token.
  const existing = await registrationToken('0773330001');
  assert.equal(existing.registered, true);
  assert.ok(existing.token);
  assert.equal(existing.registrationToken, undefined);
});

test('registration: government needs the right organisation code', async () => {
  const { registrationToken: token } = await registrationToken('0774440001');
  const fields = {
    passengerType: 'government', fullName: 'Nimali Silva', nic: '199512345678', address: 'Kandy',
    institution: 'Ministry of Education', employeeNo: 'E-1001', designation: 'Teacher', consent: 'true',
  };
  const before = uploadCount();
  const wrong = await api('POST', '/register', { token, form: regForm({ ...fields, orgAuthCode: 'WRONG' }) });
  assert.equal(wrong.status, 403);
  const otherInst = await api('POST', '/register', { token, form: regForm({ ...fields, orgAuthCode: 'HEALTH-CODE-1' }) });
  assert.equal(otherInst.status, 403, "another institution's code must not work");
  assert.equal(uploadCount(), before);

  const ok = await api('POST', '/register', { token, form: regForm({ ...fields, orgAuthCode: 'EDU-CODE-1' }) });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.verificationStatus, 'pending_institution_approval');
  state.gov = ok.data;
});

test('role scoping of the staff work queues', async () => {
  const station = await api('GET', '/staff/users/pending', { token: state.station });
  assert.deepEqual(station.data.map((u) => u.id), [state.priv.userId], 'station staff only see identity checks');

  const edu = await api('GET', '/staff/users/pending', { token: state.edu });
  assert.deepEqual(edu.data.map((u) => u.id), [state.gov.userId]);
  assert.equal(edu.data[0].institution, 'Ministry of Education');

  const health = await api('GET', '/staff/users/pending', { token: state.health });
  assert.deepEqual(health.data, [], 'other institutions see nothing');
  assert.equal((await api('GET', `/staff/users/${state.gov.userId}`, { token: state.health })).status, 403);
  assert.equal((await api('GET', `/staff/users/${state.gov.userId}/docs/photo`, { token: state.health })).status, 403);

  // wrong roles
  assert.equal((await api('POST', `/staff/users/${state.gov.userId}/institution-decision`,
    { token: state.station, json: { decision: 'approved' } })).status, 403);
  assert.equal((await api('POST', `/staff/users/${state.priv.userId}/verification-decision`,
    { token: state.admin, json: { decision: 'approved' } })).status, 403, 'admins manage the system, they do not approve people');
  assert.equal((await api('GET', '/admin/staff', { token: state.station })).status, 403);
  assert.equal((await api('GET', '/staff/users/pending', { token: state.priv.token })).status, 401, 'passenger token is not a staff token');
});

test('unverified passengers cannot apply', async () => {
  const r = await api('POST', '/applications', {
    token: state.priv.token,
    json: { fromStationId: ids.fort, toStationId: ids.galle, ticketClass: 'second', period: 'monthly', startDate: todayLK() },
  });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'not_verified');
});

test('government flow: institution approves, then station staff verifies', async () => {
  const gid = state.gov.userId;
  // must be approved by the institution first
  assert.equal((await api('POST', `/staff/users/${gid}/verification-decision`,
    { token: state.station, json: { decision: 'approved' } })).status, 409);

  const noReason = await api('POST', `/staff/users/${gid}/institution-decision`,
    { token: state.edu, json: { decision: 'rejected' } });
  assert.equal(noReason.status, 400);

  const approved = await api('POST', `/staff/users/${gid}/institution-decision`,
    { token: state.edu, json: { decision: 'approved' } });
  assert.equal(approved.data.status, 'pending_verification');
  assert.equal((await api('POST', `/staff/users/${gid}/institution-decision`,
    { token: state.edu, json: { decision: 'approved' } })).status, 409, 'cannot decide twice');

  const queue = await api('GET', '/staff/users/pending', { token: state.station });
  assert.equal(queue.data.length, 2);
});

test('station staff can view documents; approval deletes the NIC images', async () => {
  const pid = state.priv.userId;
  const detail = await api('GET', `/staff/users/${pid}`, { token: state.station });
  assert.deepEqual(detail.data.documents.map((d) => d.type).sort(), ['nic_back', 'nic_front', 'photo']);

  const img = await fetch(`${base}/api/staff/users/${pid}/docs/nic_front`, { headers: { authorization: `Bearer ${state.station}` } });
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/jpeg/);
  assert.equal(img.headers.get('cache-control'), 'no-store');
  assert.equal((await api('GET', `/staff/users/${pid}/docs/passport`, { token: state.station })).status, 400);

  const before = uploadCount();
  for (const id of [pid, state.gov.userId]) {
    const r = await api('POST', `/staff/users/${id}/verification-decision`, { token: state.station, json: { decision: 'approved' } });
    assert.equal(r.data.status, 'verified');
  }
  assert.equal(uploadCount(), before - 4, 'two NIC images per passenger are deleted on approval');
  assert.equal((await api('GET', `/staff/users/${pid}/docs/nic_front`, { token: state.station })).status, 404);
  assert.equal((await api('GET', `/staff/users/${pid}/docs/photo`, { token: state.station })).status, 200, 'photo is kept for inspectors');
  assert.equal((await api('GET', '/me', { token: state.priv.token })).data.verificationStatus, 'verified');
});

test('private passenger: quote, apply, overlap block, failed then successful payment', async () => {
  const tok = state.priv.token;
  const body = { fromStationId: ids.fort, toStationId: ids.galle, ticketClass: 'second', period: 'monthly' };

  const q = await api('POST', '/fares/quote', { token: tok, json: body });
  assert.equal(q.data.fareLkr, 1000);
  const reverse = await api('POST', '/fares/quote', { token: tok, json: { ...body, fromStationId: ids.galle, toStationId: ids.fort } });
  assert.equal(reverse.data.fareLkr, 1000, 'fares work in both directions');
  assert.equal((await api('POST', '/fares/quote', { token: tok, json: { ...body, ticketClass: 'first' } })).status, 404);
  assert.equal((await api('POST', '/fares/quote', { token: tok, json: { ...body, toStationId: ids.fort } })).status, 400);

  const start = todayLK();
  assert.equal((await api('POST', '/applications', { token: tok, json: { ...body, startDate: addDays(start, -1) } })).status, 400);
  assert.equal((await api('POST', '/applications', { token: tok, json: { ...body, startDate: addDays(start, 90) } })).status, 400);

  const app = await api('POST', '/applications', { token: tok, json: { ...body, startDate: start } });
  assert.equal(app.status, 201, JSON.stringify(app.data));
  assert.equal(app.data.status, 'approved_awaiting_payment');
  assert.equal(app.data.fareLkr, 1000);
  assert.equal(app.data.endDate, ticketEndDate(start, 'monthly', 1));
  state.privApp = app.data;

  const overlap = await api('POST', '/applications', { token: tok, json: { ...body, period: 'weekly', startDate: start } });
  assert.equal(overlap.status, 409);

  const failed = await api('POST', `/applications/${app.data.id}/pay`, { token: tok, json: { simulate: 'fail' } });
  assert.equal(failed.status, 402);
  assert.equal((await api('GET', `/applications/${app.data.id}`, { token: tok })).data.status, 'approved_awaiting_payment');
  assert.equal((await api('GET', '/tickets', { token: tok })).data.length, 0);

  const paid = await api('POST', `/applications/${app.data.id}/pay`, { token: tok, json: {} });
  assert.equal(paid.status, 201, JSON.stringify(paid.data));
  assert.equal(paid.data.paid, true);
  assert.equal(paid.data.ticket.status, 'active');
  assert.equal(paid.data.ticket.validTo, ticketEndDate(start, 'monthly', 1));
  state.privTicket = paid.data.ticket;

  const again = await api('POST', `/applications/${app.data.id}/pay`, { token: tok, json: {} });
  assert.equal(again.status, 409);
  assert.equal((await api('GET', `/applications/${app.data.id}`, { token: tok })).data.status, 'paid');
  assert.equal((await api('POST', `/applications/${app.data.id}/cancel`, { token: tok })).status, 409);

  const pays = await db.query("SELECT status FROM payments WHERE application_id = ? ORDER BY created_at", [app.data.id]);
  assert.deepEqual(pays.map((p) => p.status).sort(), ['failed', 'success']);
});

test('ownership: nobody else can see or pay for my application or ticket', async () => {
  const other = state.gov.token;
  assert.equal((await api('GET', `/applications/${state.privApp.id}`, { token: other })).status, 404);
  assert.equal((await api('POST', `/applications/${state.privApp.id}/pay`, { token: other, json: {} })).status, 404);
  assert.equal((await api('GET', `/tickets/${state.privTicket.id}`, { token: other })).status, 404);
  assert.equal((await api('GET', '/tickets', { token: other })).data.length, 0);
});

test('QR token verifies offline with the public key, and the inspector endpoint agrees', async () => {
  const mine = await api('GET', `/tickets/${state.privTicket.id}`, { token: state.priv.token });
  const token = mine.data.qrToken;
  const pem = await (await fetch(`${base}/api/ticket-public-key`)).text();
  const payload = jwt.verify(token, pem, { algorithms: ['ES256'] });
  assert.equal(payload.sub, state.privTicket.id);
  assert.equal(payload.nm, 'Kasun Perera');
  assert.equal(JSON.stringify(payload).includes('912345678'), false);

  const scan = await api('POST', '/staff/tickets/scan', { token: state.station, json: { token } });
  assert.equal(scan.data.result, 'valid');
  assert.equal(scan.data.holder.name, 'Kasun Perera');
  assert.equal(scan.data.fromStation, 'Colombo Fort');

  const [h, p, s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...payload, vt: '2099-12-31' })).toString('base64url');
  const bad = await api('POST', '/staff/tickets/scan', { token: state.station, json: { token: `${h}.${forged}.${s}` } });
  assert.equal(bad.data.result, 'invalid');

  const expired = signTicket({
    ticketId: state.privTicket.id, holderName: 'Kasun Perera', fromStation: 'Colombo Fort', toStation: 'Galle',
    ticketClass: 'second', validFrom: '2020-01-01', validTo: '2020-01-31',
  });
  const exp = await api('POST', '/staff/tickets/scan', { token: state.station, json: { token: expired } });
  assert.equal(exp.data.result, 'expired');

  assert.equal((await api('POST', '/staff/tickets/scan', { token: state.edu, json: { token } })).status, 403);
  assert.equal((await api('POST', '/staff/tickets/scan', { token: state.priv.token, json: { token } })).status, 401);

  const scans = await db.query('SELECT result FROM ticket_scans');
  assert.ok(scans.length >= 2);
});

test('government applications: monthly only, institution must approve before payment', async () => {
  const tok = state.gov.token;
  const body = { fromStationId: ids.fort, toStationId: ids.galle, ticketClass: 'second', startDate: todayLK() };

  assert.equal((await api('POST', '/applications', { token: tok, json: { ...body, period: 'weekly' } })).status, 400);
  assert.equal((await api('POST', '/applications', { token: tok, json: { ...body, period: 'monthly', durationMonths: 4 } })).status, 400);

  const app = await api('POST', '/applications', { token: tok, json: { ...body, period: 'monthly', durationMonths: 2 } });
  assert.equal(app.status, 201, JSON.stringify(app.data));
  assert.equal(app.data.status, 'pending_institution_approval');
  assert.equal(app.data.fareLkr, 1000, 'government fare 500 x 2 months');
  assert.equal(app.data.endDate, ticketEndDate(todayLK(), 'monthly', 2));

  const early = await api('POST', `/applications/${app.data.id}/pay`, { token: tok, json: {} });
  assert.equal(early.status, 409, 'cannot pay before the institution approves');

  assert.equal((await api('GET', '/staff/applications/pending', { token: state.health })).data.length, 0);
  const queue = await api('GET', '/staff/applications/pending', { token: state.edu });
  assert.equal(queue.data.length, 1);
  assert.equal(queue.data[0].holderName, 'Nimali Silva');
  assert.equal((await api('POST', `/staff/applications/${app.data.id}/decision`,
    { token: state.health, json: { decision: 'approved' } })).status, 403);

  const ok = await api('POST', `/staff/applications/${app.data.id}/decision`, { token: state.edu, json: { decision: 'approved' } });
  assert.equal(ok.data.status, 'approved_awaiting_payment');
  const paid = await api('POST', `/applications/${app.data.id}/pay`, { token: tok, json: {} });
  assert.equal(paid.status, 201);
  assert.equal(paid.data.ticket.validTo, ticketEndDate(todayLK(), 'monthly', 2));
});

test('rejection with a reason, then resubmission', async () => {
  const r = await registerPrivate({ phone: '0775550001', nic: '931234567V', name: 'Amal Fernando' });
  assert.equal(r.status, 201);
  const id = r.data.userId;
  const noReason = await api('POST', `/staff/users/${id}/verification-decision`, { token: state.station, json: { decision: 'rejected' } });
  assert.equal(noReason.status, 400);
  const rej = await api('POST', `/staff/users/${id}/verification-decision`,
    { token: state.station, json: { decision: 'rejected', reason: 'NIC photo is blurry' } });
  assert.equal(rej.data.status, 'rejected');

  const me = await api('GET', '/me', { token: r.data.token });
  assert.equal(me.data.rejectionReason, 'NIC photo is blurry');
  assert.equal((await api('POST', '/me/resubmit', { token: r.data.token, form: new FormData() })).status, 400);

  const form = new FormData();
  form.append('nicFront', new Blob([JPEG], { type: 'image/jpeg' }), 'front.jpg');
  const re = await api('POST', '/me/resubmit', { token: r.data.token, form });
  assert.equal(re.status, 200, JSON.stringify(re.data));
  assert.equal(re.data.verificationStatus, 'pending_verification');
  assert.equal((await api('GET', '/me', { token: r.data.token })).data.rejectionReason, null);

  // a verified user cannot "resubmit"
  assert.equal((await api('POST', '/me/resubmit', { token: state.priv.token, form: new FormData() })).status, 409);
});

test('admin: manage institutions and staff', async () => {
  const inst = await api('POST', '/admin/institutions', { token: state.admin, json: { name: 'Ministry of Finance' } });
  assert.equal(inst.status, 201);
  assert.match(inst.data.orgAuthCode, /^ORG-[0-9A-F]{8}$/);
  assert.equal((await api('POST', '/admin/institutions', { token: state.admin, json: { name: 'Ministry of Finance' } })).status, 409);

  const noInst = await api('POST', '/admin/staff', {
    token: state.admin, json: { fullName: 'New Officer', email: 'new@t.test', password: 'Password#123', role: 'institution_officer' },
  });
  assert.equal(noInst.status, 400);
  const officer = await api('POST', '/admin/staff', {
    token: state.admin,
    json: { fullName: 'New Officer', email: 'NEW@t.test', password: 'Password#123', role: 'institution_officer', institutionId: inst.data.id },
  });
  assert.equal(officer.status, 201);
  assert.equal(officer.data.email, 'new@t.test');
  assert.equal(JSON.stringify(await api('GET', '/admin/staff', { token: state.admin }).then((r) => r.data)).includes('password'), false);

  const bad = await api('POST', '/auth/staff/login', { json: { email: 'new@t.test', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const good = await api('POST', '/auth/staff/login', { json: { email: 'new@t.test', password: 'Password#123' } });
  assert.equal(good.status, 200);

  const audit = await api('GET', '/admin/audit?limit=500', { token: state.admin });
  assert.ok(audit.data.length > 5);
  assert.equal(JSON.stringify(audit.data).includes('912345678'), false, 'audit log must not hold NIC numbers');
  assert.ok(audit.data.some((a) => a.action === 'verification.approved'));
});

test('account deletion anonymises the person, removes images and revokes tickets', async () => {
  const id = state.priv.userId;
  const mine = await api('GET', `/tickets/${state.privTicket.id}`, { token: state.priv.token });
  const before = uploadCount();

  assert.equal((await api('DELETE', '/me', { token: state.priv.token })).status, 204);
  assert.equal(uploadCount(), before - 1, 'the remaining profile photo is deleted');
  assert.equal((await api('GET', '/me', { token: state.priv.token })).status, 401);

  const row = await db.one('SELECT full_name, phone, email, address, nic_last4, deleted_at FROM users WHERE id = ?', [id]);
  assert.equal(row.full_name, 'Deleted user');
  assert.equal(row.email, null);
  assert.equal(row.address, null);
  assert.equal(row.nic_last4, null);
  assert.ok(row.deleted_at);
  assert.equal((await db.query('SELECT id FROM verification_docs WHERE user_id = ?', [id])).length, 0);

  const scan = await api('POST', '/staff/tickets/scan', { token: state.station, json: { token: mine.data.qrToken } });
  assert.equal(scan.data.result, 'revoked');

  // the phone number and NIC can be used to register again
  const again = await registerPrivate({ phone: '0773330001', nic: '912345678V' });
  assert.equal(again.status, 201, JSON.stringify(again.data));
});

test('passenger password: required at registration, login, change password', async () => {
  const { registrationToken: token } = await registrationToken('0776660001');
  const form = regForm({ passengerType: 'general', fullName: 'Saman Kumara', nic: '881234567V', address: 'Galle', consent: 'true' });
  form.set('password', 'short');
  const weak = await api('POST', '/register', { token, form });
  assert.equal(weak.status, 400);
  assert.ok(weak.data.error.details.some((d) => d.field === 'password'));

  const ok = await api('POST', '/register', {
    token, form: regForm({ passengerType: 'general', fullName: 'Saman Kumara', nic: '881234567V', address: 'Galle', consent: 'true' }),
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const row = await db.one('SELECT password_hash FROM users WHERE id = ?', [ok.data.userId]);
  assert.ok(row.password_hash && !row.password_hash.includes(PASSWORD), 'password must be stored hashed');

  // login with phone in any accepted format
  const good = await api('POST', '/auth/login', { json: { phone: '+94776660001', password: PASSWORD } });
  assert.equal(good.status, 200, JSON.stringify(good.data));
  assert.ok(good.data.token);
  assert.equal((await api('GET', '/me', { token: good.data.token })).status, 200);

  const wrong = await api('POST', '/auth/login', { json: { phone: '0776660001', password: 'nope-nope' } });
  const unknown = await api('POST', '/auth/login', { json: { phone: '0779999999', password: PASSWORD } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.data.error.message, unknown.data.error.message);

  // change password
  const bad = await api('PUT', '/me/password', { token: good.data.token, json: { currentPassword: 'wrong-pass', newPassword: 'NewPassw0rd#1' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'wrong_password');
  const changed = await api('PUT', '/me/password', { token: good.data.token, json: { currentPassword: PASSWORD, newPassword: 'NewPassw0rd#1' } });
  assert.equal(changed.status, 200);
  assert.equal((await api('POST', '/auth/login', { json: { phone: '0776660001', password: PASSWORD } })).status, 401);
  assert.equal((await api('POST', '/auth/login', { json: { phone: '0776660001', password: 'NewPassw0rd#1' } })).status, 200);
  assert.equal((await api('PUT', '/me/password', { json: {} })).status, 401);
});
