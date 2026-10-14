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
    textlk: {
      apiToken: env.TEXTLK_API_TOKEN,
      senderId: env.TEXTLK_SENDER_ID || 'TextLKDemo', // must be a sender ID approved on your Text.lk account
      baseUrl: env.TEXTLK_URL || 'https://app.text.lk/api/v3',
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
