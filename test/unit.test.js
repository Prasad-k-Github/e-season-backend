require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const v = require('../src/utils/validators');
const { ticketEndDate, addMonths, addDays } = require('../src/utils/time');
const { signTicket, verifyTicketToken, getPublicKeyPem } = require('../src/utils/ticketToken');
const { hashNic } = require('../src/utils/crypto');

test('full name validator', () => {
  assert.equal(v.isValidFullName('Kasun Perera'), true);
  assert.equal(v.isValidFullName("Nimal D'Silva"), true);
  assert.equal(v.isValidFullName('சுரேஷ் குமார்'), true); // Tamil
  assert.equal(v.isValidFullName('කසුන් පෙරේරා'), true); // Sinhala
  assert.equal(v.isValidFullName('Al'), false);
  assert.equal(v.isValidFullName('John123'), false);
  assert.equal(v.isValidFullName(''), false);
  assert.equal(v.isValidFullName(null), false);
});

test('NIC validator accepts old and new formats only', () => {
  assert.equal(v.normalizeNic('912345678v'), '912345678V');
  assert.equal(v.normalizeNic('912345678X'), '912345678X');
  assert.equal(v.normalizeNic(' 199123456789 '), '199123456789');
  assert.equal(v.normalizeNic('91234567V'), null);
  assert.equal(v.normalizeNic('9123456789V'), null);
  assert.equal(v.normalizeNic('19912345678'), null);
  assert.equal(v.normalizeNic('abcdefghijkl'), null);
  assert.equal(v.normalizeNic(undefined), null);
});

test('phone normalisation', () => {
  assert.equal(v.normalizePhone('0771234567'), '+94771234567');
  assert.equal(v.normalizePhone('+94 77 123 4567'), '+94771234567');
  assert.equal(v.normalizePhone('94771234567'), '+94771234567');
  assert.equal(v.normalizePhone('0112345678'), null); // landline
  assert.equal(v.normalizePhone('077123456'), null);
  assert.equal(v.normalizePhone('+9477123456789'), null);
});

test('passenger type: the app says "general", the DB says "private"', () => {
  assert.equal(v.normalizePassengerType('general'), 'private');
  assert.equal(v.normalizePassengerType('private'), 'private');
  assert.equal(v.normalizePassengerType('government'), 'government');
  assert.equal(v.normalizePassengerType('student'), null);
});

test('ticket end dates', () => {
  assert.equal(ticketEndDate('2026-11-01', 'weekly'), '2026-11-07');
  assert.equal(ticketEndDate('2026-11-01', 'monthly', 1), '2026-11-30');
  assert.equal(ticketEndDate('2026-11-15', 'monthly', 1), '2026-12-14');
  assert.equal(ticketEndDate('2026-11-01', 'monthly', 3), '2027-01-31');
  assert.equal(ticketEndDate('2026-11-01', 'quarterly'), '2027-01-31');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('NIC hash is stable, keyed and never the raw NIC', () => {
  const h = hashNic('912345678V');
  assert.equal(h, hashNic('912345678V'));
  assert.notEqual(h, hashNic('912345679V'));
  assert.equal(h.includes('912345678'), false);
  assert.equal(h.length, 64);
});

const sample = (over = {}) => ({
  ticketId: '11111111-1111-1111-1111-111111111111',
  holderName: 'Kasun Perera', fromStation: 'Colombo Fort', toStation: 'Galle',
  ticketClass: 'second', validFrom: '2026-11-01', validTo: '2026-11-30', ...over,
});

test('ticket token: signs, verifies, and carries no NIC', () => {
  const token = signTicket(sample());
  const r = verifyTicketToken(token);
  assert.equal(r.ok, true);
  assert.equal(r.payload.sub, sample().ticketId);
  assert.equal(r.payload.nm, 'Kasun Perera');
  assert.equal(Object.keys(r.payload).some((k) => /nic/i.test(k)), false);
  // an inspector app can verify offline with only the public key
  assert.doesNotThrow(() => jwt.verify(token, getPublicKeyPem(), { algorithms: ['ES256'] }));
});

test('ticket token: tampering and wrong keys are rejected', () => {
  const token = signTicket(sample());
  const [h, p, s] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({
    ...JSON.parse(Buffer.from(p, 'base64url').toString()), vt: '2099-01-01',
  })).toString('base64url');
  assert.deepEqual(verifyTicketToken(`${h}.${forgedPayload}.${s}`), { ok: false, reason: 'invalid' });
  assert.deepEqual(verifyTicketToken('garbage'), { ok: false, reason: 'invalid' });

  const { generateKeyPairSync } = require('node:crypto');
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const foreign = jwt.sign({ sub: sample().ticketId, exp: 4102444800 }, other, { algorithm: 'ES256', issuer: 'e-season' });
  assert.equal(verifyTicketToken(foreign).ok, false);
  // alg=none must never be accepted
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
  assert.equal(verifyTicketToken(none).ok, false);
});

test('ticket token: expired tickets report "expired" but keep the payload', () => {
  const r = verifyTicketToken(signTicket(sample({ validFrom: '2020-01-01', validTo: '2020-01-31' })));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
  assert.equal(r.payload.sub, sample().ticketId);
});
