const config = require('../config');
const { HttpError } = require('../utils/httpError');

/** Sends one SMS through Text.lk (v3 HTTP API, Bearer token). */
async function sendTextLk(phone, message) {
  const { apiToken, senderId, baseUrl } = config.sms.textlk;
  if (!apiToken) throw new Error('TEXTLK_API_TOKEN must be set');

  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/sms/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        recipient: phone.replace(/^\+/, ''), // 947XXXXXXXX
        sender_id: senderId,
        type: 'plain',
        message,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error('[sms] Text.lk request failed:', err.message);
    throw new HttpError(502, 'Could not send the SMS. Try again shortly', 'sms_failed');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== 'success') {
    console.error('[sms] Text.lk rejected the message:', res.status, JSON.stringify(data));
    throw new HttpError(502, 'Could not send the SMS. Try again shortly', 'sms_failed');
  }
}

async function sendOtpSms(phone, code, ttlMinutes) {
  const message = `Your e_season verification code is ${code}. It expires in ${ttlMinutes} minutes. Do not share it.`;
  if (config.otp.provider === 'textlk') return sendTextLk(phone, message);
  throw new Error(`Unknown OTP_PROVIDER "${config.otp.provider}"`);
}

module.exports = { sendOtpSms };
