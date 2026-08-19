import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const databaseName = 'solar-edge-hue';
const sourceConfig = 'wrangler.jsonc';
const deployConfig = 'wrangler.deploy.jsonc';

for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

function wrangler(args, inherit = false) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    env: process.env,
    stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'inherit']
  });
}

function parseJsonOutput(output) {
  const startArray = output.indexOf('[');
  const startObject = output.indexOf('{');
  const candidates = [startArray, startObject].filter((index) => index >= 0);
  if (!candidates.length) throw new Error('Wrangler did not return JSON output');
  return JSON.parse(output.slice(Math.min(...candidates)));
}

function listDatabases() {
  const parsed = parseJsonOutput(wrangler(['d1', 'list', '--json']));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.result)) return parsed.result;
  if (Array.isArray(parsed.databases)) return parsed.databases;
  return [];
}

function databaseId(database) {
  return database?.uuid ?? database?.database_id ?? database?.id ?? null;
}

let database = listDatabases().find((item) => item?.name === databaseName);
if (!database) {
  console.log(`Creating D1 database '${databaseName}' in Western Europe...`);
  wrangler(['d1', 'create', databaseName, '--location', 'weur'], true);
  database = listDatabases().find((item) => item?.name === databaseName);
}

const id = databaseId(database);
if (!id || typeof id !== 'string') throw new Error(`Could not determine D1 database ID for '${databaseName}'`);

const config = JSON.parse(readFileSync(sourceConfig, 'utf8'));
if (!Array.isArray(config.d1_databases)) throw new Error('wrangler.jsonc has no d1_databases configuration');
const binding = config.d1_databases.find((item) => item?.binding === 'DB');
if (!binding) throw new Error("D1 binding 'DB' is missing from wrangler.jsonc");
binding.database_id = id;
writeFileSync(deployConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `database_id=${id}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `database_name=${databaseName}\n`);
}

console.log(`D1 ready: ${databaseName} (${id})`);
console.log(`Generated ${deployConfig} for this deployment only.`);
