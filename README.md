# e_season backend

REST API (Node.js, Express, MySQL) for the e_season Sri Lanka Railways season-ticket **prototype**.
It uses mock data and a sandbox payment. It is not connected to Sri Lanka Railways, Pravesha or any real payment gateway.

## Quick start

Requirements: Node 20+ (Node 22.13+ to run the tests) and MySQL 8.0.16+.

```bash
npm install
cp .env.example .env        # then edit the DB_* values and set JWT_SECRET / NIC_PEPPER
npm run db:init             # creates the e_season database from db/schema.sql
npm run keys                # creates the ticket-signing key pair in ./keys
npm run db:seed             # sample stations, SAMPLE fares, demo institutions and demo staff
npm start                   # http://localhost:3000
```

**Before you deploy or demo on a shared network, set `NODE_ENV=production`.** In any other mode the mock OTP code is
returned in the API response (so the app can be tested without an SMS gateway), which would let anyone log in as anyone.

### Demo accounts (from `npm run db:seed`)

| Role | E-mail | Password |
|---|---|---|
| Admin | admin@eseason.test | `ChangeMe#2026` |
| Station staff | station@eseason.test | `ChangeMe#2026` |
| Institution officer (Education) | officer.edu@eseason.test | `ChangeMe#2026` |
| Institution officer (Health) | officer.health@eseason.test | `ChangeMe#2026` |

Demo organisation codes: `DEMO-EDU-2026`, `DEMO-HEALTH-2026`, `DEMO-RAIL-2026`, `DEMO-WPC-2026`.
Set `SEED_STAFF_PASSWORD` to choose another password. The fares in the seed are invented numbers, not real railway fares.

**Upgrading an existing database:** run `npm run db:add-passenger-password` once. It adds `users.password_hash`.
Passengers created before that have no password; they sign in with the OTP and set one via `PUT /me/password`.

### Real SMS OTP (Text.lk)

Set `OTP_PROVIDER=textlk`, `TEXTLK_API_TOKEN` (from your Text.lk dashboard) and `TEXTLK_SENDER_ID`
(an approved sender ID; `TextLKDemo` works for testing), then restart the server.
With `OTP_PROVIDER=mock` no SMS is sent and the code is returned in the response (development only).

If Text.lk rejects the message, the API returns `502 sms_failed` and the reason is logged on the server.

## How the flow works

```
Passenger app                                        Staff / officers
─────────────                                        ────────────────
POST /auth/otp/request  ─► code (mock)
POST /auth/otp/verify   ─► registrationToken (new)  or  token (existing account)
POST /register (multipart: details + 3 images)
   private    ─► pending_verification ───────────► station staff: verification-decision ─► verified
   government ─► pending_institution_approval ───► officer: institution-decision ─► pending_verification ─► (station staff) ─► verified
POST /fares/quote, POST /applications
   private    ─► approved_awaiting_payment
   government ─► pending_institution_approval ───► officer: applications/:id/decision ─► approved_awaiting_payment
POST /applications/:id/pay (sandbox) ─► paid + signed season ticket (qrToken)
Inspector app: POST /staff/tickets/scan {token}  ─►  valid | expired | revoked | invalid
```

Admins manage institutions, staff, stations, fares and application windows. They do **not** approve individual passengers.

## Endpoints

All paths are under `/api`. Errors look like `{ "error": { "code", "message", "details?" } }`.

**Public**: `GET /health`, `GET /stations`, `GET /institutions` (names only), `GET /ticket-public-key`

**Auth**: `POST /auth/otp/request {phone}`, `POST /auth/otp/verify {phone, code}`, `POST /auth/login {phone, password}` (passenger), `POST /auth/staff/login {email, password}`

**Registration** (`Authorization: Bearer <registrationToken>`): `POST /register` as `multipart/form-data`

| Field | Notes |
|---|---|
| `passengerType` | `government`, `private` or `general` (the Flutter app's name for private) |
| `password` | required, 8 to 128 characters (stored as a bcrypt hash) |
| `fullName`, `nic`, `address` | required. NIC: 9 digits + V/X, or 12 digits |
| `email`, `dateOfBirth`, `preferredLanguage` | optional (`en`, `si`, `ta`) |
| `consent` | must be `true` |
| `photo` (or `profilePhoto`), `nicFront`, `nicBack` | JPEG/PNG files, max 5 MB each |
| government only | `institutionId` or `institution` (name), `orgAuthCode`, optional `employeeNo`, `designation` |
| private only | optional `employerName` |

The phone number comes from the verified OTP, not from the form.

**Passenger** (`Bearer <user token>`): `GET /me`, `DELETE /me`, `POST /me/resubmit`, `PUT /me/password {currentPassword, newPassword}`, `POST /fares/quote`,
`POST /applications`, `GET /applications`, `GET /applications/:id`, `POST /applications/:id/cancel`,
`POST /applications/:id/pay`, `GET /tickets`, `GET /tickets/:id`

**Staff** (`Bearer <staff token>`):

| Endpoint | Roles |
|---|---|
| `GET /staff/users/pending`, `GET /staff/users/:id`, `GET /staff/users/:id/docs/:type` | station staff, institution officer (own institution only), admin |
| `POST /staff/users/:id/institution-decision {decision, reason?}` | institution officer |
| `POST /staff/users/:id/verification-decision {decision, reason?}` | station staff |
| `GET /staff/applications/pending`, `POST /staff/applications/:id/decision` | institution officer |
| `POST /staff/tickets/scan {token}` | station staff, admin |

`decision` is `approved` or `rejected`. A reason is required when rejecting.

**Admin**: `GET|POST /admin/institutions`, `GET|POST /admin/staff`, `POST /admin/stations`, `POST /admin/fares`,
`POST /admin/application-windows`, `GET /admin/audit`

## Rules implemented

- Government concessionary tickets are monthly, for 1 to 3 months (fare = monthly fare x months). Private tickets can be weekly, monthly or quarterly.
- Government applications need institution approval before payment. Private applications go straight to payment.
- A passenger must be `verified` before applying. Overlapping applications for the same dates are refused.
- Fares work in both directions. A fare row for the passenger's type beats a generic row (a null `passenger_type` means "both").
- Approving a passenger deletes their NIC images and keeps the profile photo for inspectors.
- Application windows are only enforced when `ENFORCE_APPLICATION_WINDOWS=true`.

## Privacy and security choices

- The NIC is never stored. Only an HMAC hash (for duplicate checks) and the last 4 characters are kept.
- NIC images are deleted on approval, and failed registrations leave no files behind.
- Uploads are checked by file signature, not just the declared type. Staff must be logged in to view them, and every view is audit-logged.
- Tickets are ES256-signed tokens. The inspector app can verify them offline with the public key from `GET /ticket-public-key`. Tokens contain the holder's name and route, never the NIC.
- `DELETE /me` removes images, anonymises the record and revokes tickets (the row stays so payment and audit history keep working).
- OTP codes are stored hashed, expire after 5 minutes, lock after 5 wrong attempts, and the OTP, login and registration endpoints are rate-limited.
- The institution/organisation-code check returns one generic error, so it doesn't reveal which part was wrong.
- Payments store a sandbox reference only. No card data is accepted anywhere.

## Tests

```bash
npm test      # needs Node 22.13+ (uses the built-in node:sqlite)
```

25 tests cover the validators, the signed tickets (tampering, wrong key, `alg: none`, expiry) and the full API flow:
registration, both approval paths, role scoping, applications, payment, ticket scanning, resubmission and account deletion.

**Important limitation:** the development machine had no MySQL server, so the tests run the same `db/schema.sql`
(converted automatically to SQLite syntax) through a SQLite adapter. That checks the business logic, but **not MySQL
itself**. Run `npm run db:init`, `npm run db:seed` and one manual pass through the flow against real MySQL before you demo.

## Not built (good "future work" for the report)

- A real SMS gateway (the mock OTP stands in) and a real payment gateway.
- Rotating or one-time QR codes. A screenshot of a valid QR currently stays valid until the ticket expires.
- Refunds, lost-ticket replacement, renewal links, push notifications and concession categories other than government and private.
- Real railway fare tables, and any integration with Pravesha or the Railways systems.
- A separate "inspector" role. Station staff do the scanning because the schema has no inspector role.
- Migrations and an ORM. The schema is a single SQL file, and there is no `down` script.
