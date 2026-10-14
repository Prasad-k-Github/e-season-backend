// Demo data for the prototype. EVERYTHING HERE IS SAMPLE DATA: the fares are invented and are not
// Sri Lanka Railways' real fares, the institutions are examples, and the passwords are demo passwords.
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const { newId } = require('../src/utils/crypto');
const { nowSql } = require('../src/utils/time');

const LINES = {
  Coastal: ['Colombo Fort', 'Bambalapitiya', 'Wellawatte', 'Dehiwala', 'Mount Lavinia', 'Moratuwa',
    'Panadura', 'Kalutara South', 'Aluthgama', 'Hikkaduwa', 'Galle'],
  Main: ['Colombo Fort', 'Maradana', 'Ragama', 'Gampaha', 'Veyangoda', 'Polgahawela', 'Peradeniya', 'Kandy'],
};
const SEAT_RESERVATION = new Set(['Colombo Fort', 'Maradana', 'Ragama', 'Gampaha', 'Kandy', 'Galle', 'Panadura']);

const INSTITUTIONS = [
  ['Ministry of Education (demo)', 'DEMO-EDU-2026'],
  ['Ministry of Health (demo)', 'DEMO-HEALTH-2026'],
  ['Department of Railways (demo)', 'DEMO-RAIL-2026'],
  ['Provincial Council Western (demo)', 'DEMO-WPC-2026'],
];

const DEMO_PASSWORD = process.env.SEED_STAFF_PASSWORD || 'ChangeMe#2026';

async function main() {
  const now = nowSql();

  // stations
  const stationIds = {};
  for (const [line, names] of Object.entries(LINES)) {
    for (const name of names) {
      if (!stationIds[name]) {
        stationIds[name] = newId();
        await db.execute(
          'INSERT IGNORE INTO stations (id, name, line, has_seat_reservation) VALUES (?, ?, ?, ?)',
          [stationIds[name], name, line, SEAT_RESERVATION.has(name) ? 1 : 0]);
      }
    }
  }
  // IDs may already exist from an earlier run: read them back.
  for (const s of await db.query('SELECT id, name FROM stations')) stationIds[s.name] = s.id;

  // fares: base + per-stop, invented numbers. Government concessions = 50% (monthly only).
  const classMul = { first: 2.0, second: 1.4, third: 1.0 };
  const periodMul = { weekly: 0.3, monthly: 1.0, quarterly: 2.7 };
  const done = new Set();
  for (const names of Object.values(LINES)) {
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = [names[i], names[j]].sort().join('|');
        if (done.has(key)) continue;
        done.add(key);
        const stops = j - i;
        const monthlyThird = 400 + stops * 120;
        for (const [cls, cm] of Object.entries(classMul)) {
          for (const [period, pm] of Object.entries(periodMul)) {
            const amount = Math.round((monthlyThird * cm * pm) / 10) * 10;
            const rows = [[null, amount]];
            if (period === 'monthly') rows.push(['government', Math.round(amount * 0.5 / 10) * 10]);
            for (const [ptype, amt] of rows) {
              await db.execute(
                `INSERT IGNORE INTO fares (id, from_station_id, to_station_id, ticket_class, period, passenger_type,
                                           amount_lkr, effective_from) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01')`,
                [newId(), stationIds[names[i]], stationIds[names[j]], cls, period, ptype, amt]);
            }
          }
        }
      }
    }
  }

  // institutions
  const institutionIds = {};
  for (const [name, code] of INSTITUTIONS) {
    await db.execute(
      'INSERT IGNORE INTO institutions (id, name, org_auth_code, is_active, registered_at) VALUES (?, ?, ?, 1, ?)',
      [newId(), name, code, now]);
  }
  for (const i of await db.query('SELECT id, name FROM institutions')) institutionIds[i.name] = i.id;

  // staff
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const staff = [
    ['Demo Admin', 'admin@eseason.test', 'admin', null, null],
    ['Demo Station Staff (Colombo Fort)', 'station@eseason.test', 'station_staff', stationIds['Colombo Fort'], null],
    ['Demo Officer (Education)', 'officer.edu@eseason.test', 'institution_officer', null,
      institutionIds['Ministry of Education (demo)']],
    ['Demo Officer (Health)', 'officer.health@eseason.test', 'institution_officer', null,
      institutionIds['Ministry of Health (demo)']],
  ];
  for (const [fullName, email, role, stationId, institutionId] of staff) {
    await db.execute(
      `INSERT IGNORE INTO staff_users (id, full_name, email, password_hash, role, station_id, institution_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [newId(), fullName, email, hash, role, stationId, institutionId, now]);
  }

  console.log('Seeded stations, sample fares, institutions and demo staff.');
  console.log(`Demo staff password: ${DEMO_PASSWORD}  (change it for anything beyond a demo)`);
  console.log('Demo org codes:', INSTITUTIONS.map(([n, c]) => `${n}: ${c}`).join(' | '));
}

main()
  .then(() => db.close())
  .catch(async (err) => {
    console.error('db:seed failed:', err.message);
    await db.close();
    process.exit(1);
  });
