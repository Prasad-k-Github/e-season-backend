const config = require('../config');
const { HttpError } = require('../utils/httpError');

let transport = null; // created on first use; tests inject a fake with setTransport()

function getTransport() {
  if (transport) return transport;
  const { host, port, secure, user, pass } = config.email.smtp;
  if (!host) throw new Error('SMTP_HOST must be set when EMAIL_PROVIDER=smtp');
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transport;
}

/** Test hook: replace the SMTP transport (pass null to reset). */
function setTransport(t) { transport = t; }

/** Sends the 6-digit e-mail verification code over SMTP. Never logs the address or the code. */
async function sendVerificationEmail(to, code, ttlMinutes) {
  if (config.email.provider !== 'smtp') {
    throw new Error(`Unknown EMAIL_PROVIDER "${config.email.provider}"`);
  }
  const text = [
    `Your E-Season e-mail verification code is ${code}.`,
    '',
    `It expires in ${ttlMinutes} minutes. If you did not ask for it, ignore this e-mail.`,
    'Never share this code with anyone.',
  ].join('\n');
  const html = `<p>Your E-Season e-mail verification code is</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p>
<p>It expires in ${ttlMinutes} minutes. If you did not ask for it, ignore this e-mail.<br>Never share this code with anyone.</p>`;

  try {
    await getTransport().sendMail({
      from: config.email.from,
      to,
      subject: 'Your E-Season verification code',
      text,
      html,
    });
  } catch (err) {
    console.error('[email] could not send verification e-mail:', err.message);
    throw new HttpError(502, 'Could not send the e-mail. Try again shortly', 'email_failed');
  }
}

module.exports = { sendVerificationEmail, setTransport };
