require('dotenv').config();
const path = require('path');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function secret(name, fallback) {
  const v = env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return fallback;
}

module.exports = {
  isProd,
  port: Number(env.PORT || 3000),
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'e_season',
  },
  jwtSecret: secret('JWT_SECRET', 'dev-only-jwt-secret'),
  nicPepper: secret('NIC_PEPPER', 'dev-only-nic-pepper'),
  otp: {
    provider: env.OTP_PROVIDER || 'mock',
    ttlMinutes: Number(env.OTP_TTL_MINUTES || 5),
    maxAttempts: 5,
  },
  sms: {
    notifylk: {
      userId: env.NOTIFYLK_USER_ID,
      apiKey: env.NOTIFYLK_API_KEY,
      senderId: env.NOTIFYLK_SENDER_ID || 'NotifyDEMO',
      baseUrl: env.NOTIFYLK_URL || 'https://app.notify.lk/api/v1',
    },
    textlk: {
      apiToken: env.TEXTLK_API_TOKEN,
      senderId: env.TEXTLK_SENDER_ID || 'TextLKDemo', // must be a sender ID approved on your Text.lk account
      baseUrl: env.TEXTLK_URL || 'https://app.text.lk/api/v3',
    },
  },
  email: {
    provider: env.EMAIL_PROVIDER || 'mock', // mock | smtp
    from: env.EMAIL_FROM || 'E-Season <no-reply@eseason.local>',
    ttlMinutes: Number(env.EMAIL_CODE_TTL_MINUTES || 10),
    maxAttempts: 5,
    // When true, /register refuses accounts whose e-mail was not verified with a code.
    requireVerification: env.REQUIRE_EMAIL_VERIFICATION === 'true',
    smtp: {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: env.SMTP_SECURE === 'true', // true for port 465, false for 587 (STARTTLS)
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  },
  ticketKeys: {
    privatePath: path.resolve(env.TICKET_PRIVATE_KEY_PATH || './keys/ticket_private.pem'),
    publicPath: path.resolve(env.TICKET_PUBLIC_KEY_PATH || './keys/ticket_public.pem'),
  },
  uploadDir: path.resolve(env.UPLOAD_DIR || './uploads'),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 5) * 1024 * 1024,
  enforceWindows: env.ENFORCE_APPLICATION_WINDOWS === 'true',
};
