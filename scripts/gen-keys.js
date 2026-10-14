// Generates the ES256 key pair used to sign season-ticket QR tokens.
const fs = require('fs');
const config = require('../src/config');
const { generateKeyFiles } = require('../src/utils/ticketToken');

const { privatePath, publicPath } = config.ticketKeys;
if (fs.existsSync(privatePath) && !process.argv.includes('--force')) {
  console.log(`Keys already exist at ${privatePath}. Use --force to replace them (this invalidates issued tickets).`);
  process.exit(0);
}
generateKeyFiles(privatePath, publicPath);
console.log(`Created ${privatePath} and ${publicPath}`);
