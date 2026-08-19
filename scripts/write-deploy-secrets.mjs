import { writeFileSync } from 'node:fs';

const names = ['APP_ENCRYPTION_KEY', 'SESSION_SECRET', 'SETUP_TOKEN'];
const secrets = {};
for (const name of names) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required deployment secret: ${name}`);
  secrets[name] = value;
}

writeFileSync('.cloudflare-secrets.json', `${JSON.stringify(secrets)}\n`, { mode: 0o600 });
console.log('Prepared encrypted Worker secret input file for Wrangler.');
