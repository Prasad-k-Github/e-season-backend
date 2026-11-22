const { uploadDir } = require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const jwt = require('jsonwebtoken');

const db = require('../src/db');
const config = require('../src/config');
const { createApp } = require('../src/app');
const { createSqliteAdapter } = require('./helpers/sqliteDb');
const { setTransport } = require('../src/services/email');
const { signEmailToken, signRegistrationToken } = require('../src/middleware/auth');
const { normalizeEmail } = require('../src/utils/validators');

let server;
let base;

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
  return { status: res.status, data: ct.includes('json') ? await res.json() : null };
}

function regForm(fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ password: PASSWORD, ...fields })) form.append(k, v);
  form.append('photo', new Blob([JPEG], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('nicFront', new Blob([JPEG], { type: 'image/jpeg' }), 'front.jpg');
  form.append('nicBack', new Blob([PNG], { type: 'image/png' }), 'back.png');
  return form;
}

let n = 0;
/** A new person: unique phone and NIC. */
function person() {
  n += 1;
  return { phone: `0771${String(100000 + n)}`, nic: `${900000000 + n}V` };
}

const fields = (p, extra = {}) => ({
  passengerType: 'general', fullName: 'Kasun Perera', nic: p.nic, address: '12 Temple Road, Colombo',
  consent: 'true', ...extra,
});

async function registrationToken(phone) {
  const r = await api('POST', '/auth/otp/request', { json: { phone } });
  const v = await api('POST', '/auth/otp/verify', { json: { phone, code: r.data.devCode } });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return v.data.registrationToken;
}

/** Runs the whole e-mail check and returns the emailToken. */
async function verifiedEmail(regToken, email) {
  const r = await api('POST', '/auth/email/request', { token: regToken, json: { email } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const v = await api('POST', '/auth/email/verify', { token: regToken, json: { email, code: r.data.devCode } });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return v.data.emailToken;
}

const uploadCount = () => fs.readdirSync(uploadDir).length;
const wrongCodeFor = (code) => (code === '000000' ? '111111' : '000000');

async function withEnv(name, value, fn) {
  const old = process.env[name];
  process.env[name] = value;
  try { return await fn(); } finally {
    if (old === undefined) delete process.env[name]; else process.env[name] = old;
  }
}

test.before(async () => {
  db.setDb(createSqliteAdapter());
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
});

test('normalizeEmail trims, lower-cases and rejects bad addresses', () => {
  assert.equal(normalizeEmail('  Kasun.Perera@Example.COM '), 'kasun.perera@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail('a@b'), null);
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail(undefined), null);
});

test('request: needs the registration token, validates the address, mock mode returns the code', async () => {
  const p = person();
  const reg = await registrationToken(p.phone);

  assert.equal((await api('POST', '/auth/email/request', { json: { email: 'a@example.com' } })).status, 401);
  assert.equal((await api('POST', '/auth/email/request', { token: 'junk', json: { email: 'a@example.com' } })).status, 401);
  assert.equal((await api('POST', '/auth/email/verify', { json: { email: 'a@example.com', code: '123456' } })).status, 401);

  const bad = await api('POST', '/auth/email/request', { token: reg, json: { email: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'bad_email');

  const ok = await api('POST', '/auth/email/request', { token: reg, json: { email: 'Req.Test@Example.com' } });
  assert.equal(ok.status, 200);
  assert.match(ok.data.devCode, /^\d{6}$/);
  assert.equal(ok.data.expiresInSeconds, 600);

  const row = await db.one('SELECT * FROM email_verifications WHERE email = ?', ['req.test@example.com']);
  assert.ok(row, 'the address is stored lower-cased');
  assert.equal(row.phone, `+94${p.phone.slice(1)}`);
  assert.equal(JSON.stringify(row).includes(ok.data.devCode), false, 'the code itself is never stored');
});

test('verify: wrong codes are counted and the code locks after 5 attempts', async () => {
  const reg = await registrationToken(person().phone);
  const email = 'lock.test@example.com';
  const r = await api('POST', '/auth/email/request', { token: reg, json: { email } });
  const wrong = wrongCodeFor(r.data.devCode);

  assert.equal((await api('POST', '/auth/email/verify', { token: reg, json: { email, code: 'abc' } })).data.error.code, 'bad_code');
  for (let i = 0; i < 5; i += 1) {
    const x = await api('POST', '/auth/email/verify', { token: reg, json: { email, code: wrong } });
    assert.equal(x.status, 400);
    assert.equal(x.data.error.code, 'email_code_incorrect');
  }
  const locked = await api('POST', '/auth/email/verify', { token: reg, json: { email, code: r.data.devCode } });
  assert.equal(locked.status, 429, 'even the right code is refused after 5 wrong attempts');
  assert.equal(locked.data.error.code, 'email_code_locked');
});

test('verify: success gives an emailToken, the code is single use, other phones and expiry are refused', async () => {
  const regA = await registrationToken(person().phone);
  const regB = await registrationToken(person().phone);
  const email = 'verify.test@example.com';

  const r = await api('POST', '/auth/email/request', { token: regA, json: { email } });
  // somebody else cannot use the code that was sent for A's registration
  const stolen = await api('POST', '/auth/email/verify', { token: regB, json: { email, code: r.data.devCode } });
  assert.equal(stolen.status, 400);
  assert.equal(stolen.data.error.code, 'email_code_missing');

  const ok = await api('POST', '/auth/email/verify', { token: regA, json: { email: 'VERIFY.test@example.com', code: r.data.devCode } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.email, email);
  assert.ok(ok.data.emailToken);

  const again = await api('POST', '/auth/email/verify', { token: regA, json: { email, code: r.data.devCode } });
  assert.equal(again.status, 400, 'a code can be used once');

  // expired code
  const r2 = await api('POST', '/auth/email/request', { token: regA, json: { email } });
  await db.execute('UPDATE email_verifications SET expires_at = ? WHERE email = ? AND consumed_at IS NULL',
    ['2020-01-01 00:00:00', email]);
  const expired = await api('POST', '/auth/email/verify', { token: regA, json: { email, code: r2.data.devCode } });
  assert.equal(expired.status, 400);
  assert.equal(expired.data.error.code, 'email_code_expired');
});

test('request: a cooldown applies per address, even across phone numbers', async () => {
  await withEnv('EMAIL_COOLDOWN_SECONDS', '1000', async () => {
    const regA = await registrationToken(person().phone);
    const regB = await registrationToken(person().phone);
    const email = 'cooldown.test@example.com';
    assert.equal((await api('POST', '/auth/email/request', { token: regA, json: { email } })).status, 200);
    const again = await api('POST', '/auth/email/request', { token: regA, json: { email } });
    assert.equal(again.status, 429);
    assert.equal(again.data.error.code, 'email_cooldown');
    assert.equal((await api('POST', '/auth/email/request', { token: regB, json: { email } })).status, 429);
    assert.equal((await api('POST', '/auth/email/request', { token: regA, json: { email: 'other.addr@example.com' } })).status, 200);
  });
});

test('registration with a verified e-mail stores it lower-cased and marks it verified', async () => {
  const p = person();
  const reg = await registrationToken(p.phone);
  const emailToken = await verifiedEmail(reg, 'Kasun.Verified@Example.com');

  const r = await api('POST', '/register', {
    token: reg, form: regForm(fields(p, { email: 'KASUN.Verified@example.com', emailToken })),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const row = await db.one('SELECT email, email_verified_at FROM users WHERE id = ?', [r.data.userId]);
  assert.equal(row.email, 'kasun.verified@example.com');
  assert.ok(row.email_verified_at);

  const me = await api('GET', '/me', { token: r.data.token });
  assert.equal(me.data.email, 'kasun.verified@example.com');
  assert.equal(me.data.emailVerified, true);

  // the address is now taken
  const other = await registrationToken(person().phone);
  const taken = await api('POST', '/auth/email/request', { token: other, json: { email: 'kasun.verified@example.com' } });
  assert.equal(taken.status, 409);
  assert.equal(taken.data.error.code, 'email_in_use');
});

test('flag off (default): registering without a token still works and the e-mail is unverified', async () => {
  assert.equal(config.email.requireVerification, false);
  const p = person();
  const reg = await registrationToken(p.phone);
  const withMail = await api('POST', '/register', { token: reg, form: regForm(fields(p, { email: 'plain.user@example.com' })) });
  assert.equal(withMail.status, 201, JSON.stringify(withMail.data));
  assert.equal((await api('GET', '/me', { token: withMail.data.token })).data.emailVerified, false);

  const p2 = person();
  const noMail = await api('POST', '/register', { token: await registrationToken(p2.phone), form: regForm(fields(p2)) });
  assert.equal(noMail.status, 201, 'the e-mail stays optional while the flag is off');

  // a token that does not match is still refused, flag or not
  const p3 = person();
  const reg3 = await registrationToken(p3.phone);
  const tok = await verifiedEmail(reg3, 'a.one@example.com');
  const mismatch = await api('POST', '/register', { token: reg3, form: regForm(fields(p3, { email: 'b.two@example.com', emailToken: tok })) });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.data.error.code, 'email_token_mismatch');
});

test('flag on: registration needs proof that the e-mail was verified', async () => {
  config.email.requireVerification = true;
  try {
    const p = person();
    const reg = await registrationToken(p.phone);
    const good = await verifiedEmail(reg, 'strict.user@example.com');
    const before = uploadCount();
    const attempt = async (extra) => api('POST', '/register', { token: reg, form: regForm(fields(p, extra)) });
    const code = async (extra) => (await attempt(extra)).data.error.code;

    assert.equal(await code({}), 'email_not_verified', 'no e-mail at all');
    assert.equal(await code({ email: 'strict.user@example.com' }), 'email_not_verified', 'e-mail without a token');
    assert.equal(await code({ email: 'other@example.com', emailToken: good }), 'email_token_mismatch', 'e-mail changed after verifying');
    assert.equal(await code({ emailToken: good }), 'email_token_mismatch', 'token but no e-mail');

    const otherPhone = signEmailToken('strict.user@example.com', '+94779999999');
    assert.equal(await code({ email: 'strict.user@example.com', emailToken: otherPhone }), 'email_token_mismatch', "someone else's proof");

    assert.equal(await code({ email: 'strict.user@example.com', emailToken: 'garbage' }), 'email_token_invalid');
    const wrongType = signRegistrationToken(`+94${p.phone.slice(1)}`);
    assert.equal(await code({ email: 'strict.user@example.com', emailToken: wrongType }), 'email_token_invalid', 'a registration token is not an e-mail token');
    const expired = jwt.sign({ typ: 'email', email: 'strict.user@example.com', phone: `+94${p.phone.slice(1)}` },
      config.jwtSecret, { algorithm: 'HS256', expiresIn: -10 });
    assert.equal(await code({ email: 'strict.user@example.com', emailToken: expired }), 'email_token_invalid', 'expired proof');

    assert.equal(uploadCount(), before, 'refused registrations leave no uploaded files behind');

    const ok = await attempt({ email: 'strict.user@example.com', emailToken: good });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal((await api('GET', '/me', { token: ok.data.token })).data.emailVerified, true);
  } finally {
    config.email.requireVerification = false;
  }
});

test('smtp mode: the code is e-mailed (never returned), and a failed send can be retried at once', async () => {
  const sent = [];
  config.email.provider = 'smtp';
  setTransport({ sendMail: async (mail) => { sent.push(mail); } });
  try {
    const p = person();
    const reg = await registrationToken(p.phone);
    const email = 'smtp.user@example.com';

    const r = await api('POST', '/auth/email/request', { token: reg, json: { email } });
    assert.equal(r.status, 200);
    assert.equal(r.data.devCode, undefined, 'the code is only in the e-mail');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, email);
    assert.equal(sent[0].from, config.email.from);
    assert.match(sent[0].subject, /E-Season/);
    const code = /(\d{6})/.exec(sent[0].text)[1];
    assert.equal(JSON.stringify(r.data).includes(code), false);

    // the e-mailed code really verifies
    const v = await api('POST', '/auth/email/verify', { token: reg, json: { email, code } });
    assert.equal(v.status, 200);

    // failing mail server
    await withEnv('EMAIL_COOLDOWN_SECONDS', '1000', async () => {
      const reg2 = await registrationToken(person().phone);
      const email2 = 'smtp.fail@example.com';
      setTransport({ sendMail: async () => { throw new Error('SMTP down'); } });
      const originalError = console.error;
      console.error = () => {}; // the failure is logged on purpose
      let failed;
      try { failed = await api('POST', '/auth/email/request', { token: reg2, json: { email: email2 } }); } finally { console.error = originalError; }
      assert.equal(failed.status, 502);
      assert.equal(failed.data.error.code, 'email_failed');
      assert.equal((await db.query('SELECT id FROM email_verifications WHERE email = ?', [email2])).length, 0);

      setTransport({ sendMail: async (mail) => { sent.push(mail); } });
      const retry = await api('POST', '/auth/email/request', { token: reg2, json: { email: email2 } });
      assert.equal(retry.status, 200, 'the failed code did not start a cooldown');
    });
  } finally {
    config.email.provider = 'mock';
    setTransport(null);
  }
});

test('production refuses the mock e-mail provider instead of silently not sending', async () => {
  config.isProd = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    // the OTP mock stops returning codes in production too, so mint the registration token directly
    const token = signRegistrationToken('+94771000000');
    const r = await api('POST', '/auth/email/request', { token, json: { email: 'prod.test@example.com' } });
    assert.equal(r.status, 500);
    assert.equal((await db.query('SELECT id FROM email_verifications WHERE email = ?', ['prod.test@example.com'])).length, 0);
  } finally {
    config.isProd = false;
    console.error = originalError;
  }
});

test('deleting the account clears the e-mail and its verification, and frees the address', async () => {
  const p = person();
  const reg = await registrationToken(p.phone);
  const emailToken = await verifiedEmail(reg, 'delete.me@example.com');
  const r = await api('POST', '/register', { token: reg, form: regForm(fields(p, { email: 'delete.me@example.com', emailToken })) });
  assert.equal(r.status, 201);

  assert.equal((await api('DELETE', '/me', { token: r.data.token })).status, 204);
  const row = await db.one('SELECT email, email_verified_at FROM users WHERE id = ?', [r.data.userId]);
  assert.equal(row.email, null);
  assert.equal(row.email_verified_at, null);

  const again = await registrationToken(person().phone);
  assert.equal((await api('POST', '/auth/email/request', { token: again, json: { email: 'delete.me@example.com' } })).status, 200);
});
