// Must be required BEFORE any src/ module: config reads the environment at load time.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eseason-test-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NIC_PEPPER = 'test-nic-pepper';
process.env.OTP_PROVIDER = 'mock'; // never send real SMS from tests
process.env.OTP_COOLDOWN_SECONDS = '0';
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.TICKET_PRIVATE_KEY_PATH = path.join(tmp, 'keys', 'private.pem');
process.env.TICKET_PUBLIC_KEY_PATH = path.join(tmp, 'keys', 'public.pem');

module.exports = { tmp, uploadDir: process.env.UPLOAD_DIR };
